import { NextRequest, NextResponse } from "next/server";
import { completeSimple, type AssistantMessage } from "@earendil-works/pi-ai/compat";
import { createAgentSessionServices, getAgentDir } from "@earendil-works/pi-coding-agent";
import { getAllowedRoots, isPathAllowed } from "@/lib/allowed-roots";
import { readPiWebConfig, type PiWebSubagentRunPolicy } from "@/lib/pi-web-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RAW_MAX_CHARS = 20_000;
const ASSIST_TIMEOUT_MS = 20_000;

interface AssistCandidate {
  provider: string;
  modelId: string;
  thinking: PiWebSubagentRunPolicy["thinking"];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textFromAssistant(message: AssistantMessage): string {
  return message.content.filter((block) => block.type === "text").map((block) => block.text).join("");
}

function stripCodeFence(raw: string): string {
  return raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function findJsonObject(raw: string): string | null {
  const stripped = stripCodeFence(raw);
  if (stripped.startsWith("{") && stripped.endsWith("}")) return stripped;
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start !== -1 && end > start) return stripped.slice(start, end + 1);
  return null;
}

function chooseModelRef(policy: PiWebSubagentRunPolicy, defaultModel: { provider: string; modelId: string } | null): AssistCandidate | null {
  if (policy.model.mode === "specific" && policy.model.provider && policy.model.modelId) return { provider: policy.model.provider, modelId: policy.model.modelId, thinking: policy.thinking };
  if (!defaultModel) return null;
  return { ...defaultModel, thinking: policy.thinking };
}

function reasoningForCandidate(candidate: AssistCandidate) {
  return candidate.thinking === "inherit" || candidate.thinking === "off" ? undefined : candidate.thinking;
}

function parseAssistJson(raw: string): Record<string, string> {
  const jsonText = findJsonObject(raw);
  if (!jsonText) throw new Error("模型没有返回 JSON 对象");
  const parsed = JSON.parse(jsonText) as unknown;
  if (!isRecord(parsed)) throw new Error("模型返回 JSON 根节点不是对象");
  const envRaw = isRecord(parsed.env) ? parsed.env : parsed;
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(envRaw)) {
    const cleanKey = key.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(cleanKey)) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") env[cleanKey] = String(value);
  }
  if (Object.keys(env).length === 0) throw new Error("模型没有解析出有效环境变量");
  return env;
}

function buildPrompt(raw: string): string {
  return `你是 shell 环境变量解析器。请从用户粘贴的终端命令/环境变量文本中提取最终要设置的环境变量。\n\n规则：\n- 只返回严格 JSON，不要 Markdown 代码围栏。\n- JSON 结构必须是 {"env":{"KEY":"VALUE"}}。\n- 支持 export a=b c=d、KEY=VALUE、换行、引号、代理变量大小写。\n- 不要执行命令，不要解释文本。\n- 如果同一个 key 多次出现，保留最后一次。\n- value 保留为字符串，去掉包裹引号。\n- 只输出合法变量名：^[A-Za-z_][A-Za-z0-9_]*$。\n\n输入：\n${raw}`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as { cwd?: unknown; raw?: unknown };
    const cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";
    const raw = typeof body.raw === "string" ? body.raw.trim() : "";
    if (!cwd) return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    if (!raw) return NextResponse.json({ error: "raw env text is required" }, { status: 400 });
    if (raw.length > RAW_MAX_CHARS) return NextResponse.json({ error: `raw env text must be at most ${RAW_MAX_CHARS} characters` }, { status: 400 });

    const allowedRoots = await getAllowedRoots();
    if (!isPathAllowed(cwd, allowedRoots)) return NextResponse.json({ error: "Access denied" }, { status: 403 });

    const services = await createAgentSessionServices({ cwd, agentDir: getAgentDir() });
    const config = readPiWebConfig();
    const defaultProvider = services.settingsManager.getDefaultProvider();
    const defaultModelId = services.settingsManager.getDefaultModel();
    const defaultCandidate = defaultProvider && defaultModelId ? { provider: defaultProvider, modelId: defaultModelId } : null;
    const selected = chooseModelRef(config.terminal.envAssistant, defaultCandidate);
    const fallback = chooseModelRef(config.terminal.envAssistantFallback, defaultCandidate);
    if (!selected) return NextResponse.json({ error: "No terminal env assistant model configured and no Pi default model found" }, { status: 400 });

    const candidates = [selected];
    if (fallback && !candidates.some((item) => item.provider === fallback.provider && item.modelId === fallback.modelId && item.thinking === fallback.thinking)) candidates.push(fallback);

    for (const candidate of candidates) {
      const model = services.modelRegistry.find(candidate.provider, candidate.modelId);
      if (!model) continue;
      const auth = await services.modelRegistry.getApiKeyAndHeaders(model);
      if (!auth.ok || !auth.apiKey) continue;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), ASSIST_TIMEOUT_MS);
      try {
        const message = await completeSimple(model, {
          messages: [{ role: "user", content: buildPrompt(raw), timestamp: Date.now() }],
        }, {
          apiKey: auth.apiKey,
          headers: auth.headers,
          maxTokens: 2000,
          reasoning: reasoningForCandidate(candidate),
          timeoutMs: ASSIST_TIMEOUT_MS,
          maxRetries: 1,
          cacheRetention: "none",
          signal: controller.signal,
        });
        if (message.stopReason === "error" || message.stopReason === "aborted") continue;
        const env = parseAssistJson(textFromAssistant(message));
        return NextResponse.json({ env, model: candidate });
      } catch {
        // Try fallback candidate.
      } finally {
        clearTimeout(timeout);
      }
    }

    return NextResponse.json({ error: "Terminal env assistant models failed to parse the input" }, { status: 502 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
