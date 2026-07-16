import { NextRequest, NextResponse } from "next/server";
import { completeSimple, type AssistantMessage } from "@earendil-works/pi-ai/compat";
import { createAgentSessionServices, getAgentDir } from "@earendil-works/pi-coding-agent";
import { webExtensionFactories } from "@/lib/pi-provider-extensions";
import { getAllowedRoots, isPathAllowed } from "@/lib/allowed-roots";
import { readPiWebConfig } from "@/lib/pi-web-config";
import type { PiWebSubagentRunPolicy } from "@/lib/pi-web-config";
import type { TrellisWorkflowAssistRequest, TrellisWorkflowAssistResponse } from "@/lib/trellis-workflow-types";

export const dynamic = "force-dynamic";

const BODY_MAX_CHARS = 30_000;
const STRUCTURED_ASSIST_TIMEOUT_MS = 15_000;
const PLAIN_ASSIST_TIMEOUT_MS = 60_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textFromAssistant(message: AssistantMessage): string {
  return message.content.filter((block) => block.type === "text").map((block) => block.text).join("");
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
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

function fallbackAssistResult(raw: string, reason: string): Omit<TrellisWorkflowAssistResponse, "model"> {
  const text = raw.trim();
  return {
    summary: text ? "已生成中文辅助阅读内容。" : "模型没有返回可读取内容。",
    translation: text || "模型返回为空，请重试或在 Settings → Trellis 中更换流程辅助阅读模型。",
    keyActions: [],
    cautions: text ? [`结构化解析失败：${reason}；已展示模型原始中文解释。`, "结果未写入 workflow.md。"] : [`结构化解析失败：${reason}`, "结果未写入 workflow.md；可以重试辅助阅读。"],
  };
}

function parsePlainAssist(raw: string): Omit<TrellisWorkflowAssistResponse, "model"> {
  const text = raw.trim();
  const summaryMatch = text.match(/(?:一句话总结|总结)\s*[:：]?\s*([^\n]+)/i);
  return {
    summary: summaryMatch?.[1]?.replace(/^[-*#\s]+/, "").trim() || "已生成中文辅助阅读内容。",
    translation: text || "模型返回为空，请重试或在 Settings → Trellis 中更换流程辅助阅读模型。",
    keyActions: [],
    cautions: ["模型未返回结构化 JSON，已自动重试并展示非结构化中文解释。", "结果未写入 workflow.md。"],
  };
}

function parseAssistJson(raw: string): Omit<TrellisWorkflowAssistResponse, "model"> {
  const jsonText = findJsonObject(raw);
  if (!jsonText) return fallbackAssistResult(raw, "未找到 JSON 对象");
  try {
    const parsed = JSON.parse(jsonText) as unknown;
    if (!isRecord(parsed)) return fallbackAssistResult(raw, "JSON 根节点不是对象");
    const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
    const translation = typeof parsed.translation === "string" ? parsed.translation.trim() : "";
    if (!summary || !translation) return fallbackAssistResult(raw, "缺少 summary 或 translation 字段");
    return {
      summary,
      translation,
      keyActions: parseStringArray(parsed.keyActions),
      cautions: parseStringArray(parsed.cautions),
    };
  } catch (error) {
    return fallbackAssistResult(raw, error instanceof Error ? error.message : String(error));
  }
}

function buildJsonPrompt(input: TrellisWorkflowAssistRequest): string {
  return `你是 Trellis workflow 阅读助手。只解释输入节点，不要改写 workflow，不要生成保存或执行文件修改的指令。请用中文输出严格 JSON，不要包含 Markdown 代码围栏。\n\n节点类型: ${input.node.kind}\n节点标题: ${input.node.title}\n源码范围: L${input.node.lineStart}-L${input.node.lineEnd}\n\n原文:\n${input.node.body}\n\n返回 JSON 结构：{"summary":"一句话总结","translation":"忠实中文翻译，保留命令、路径、代码标记","keyActions":["关键动作"],"cautions":["注意事项"]}`;
}

function buildPlainPrompt(input: TrellisWorkflowAssistRequest): string {
  return `请用中文解释下面这个 Trellis workflow 节点。不要改写文件，不要给出保存操作。请直接给出：1）一句话总结；2）忠实中文翻译；3）关键动作；4）注意事项。\n\n节点类型: ${input.node.kind}\n节点标题: ${input.node.title}\n源码范围: L${input.node.lineStart}-L${input.node.lineEnd}\n\n原文:\n${input.node.body}`;
}

function validateRequest(value: unknown): TrellisWorkflowAssistRequest {
  if (!isRecord(value)) throw new Error("Request body must be an object");
  const cwd = typeof value.cwd === "string" ? value.cwd.trim() : "";
  if (!cwd) throw new Error("cwd is required");
  const node = isRecord(value.node) ? value.node : null;
  if (!node) throw new Error("node is required");
  const kind = node.kind;
  if (kind !== "workflow" && kind !== "phase" && kind !== "step" && kind !== "state") throw new Error("node.kind is invalid");
  const id = typeof node.id === "string" ? node.id.trim() : "";
  const title = typeof node.title === "string" ? node.title.trim() : "";
  const body = typeof node.body === "string" ? node.body.trim() : "";
  const lineStart = typeof node.lineStart === "number" && Number.isInteger(node.lineStart) ? node.lineStart : 0;
  const lineEnd = typeof node.lineEnd === "number" && Number.isInteger(node.lineEnd) ? node.lineEnd : 0;
  if (!id || !title || !body) throw new Error("node id, title, and body are required");
  if (lineStart <= 0 || lineEnd < lineStart) throw new Error("node line range is invalid");
  if (body.length > BODY_MAX_CHARS) throw new Error(`node body must be at most ${BODY_MAX_CHARS} characters`);
  return { cwd, node: { id, kind, title, body, lineStart, lineEnd } };
}

interface AssistCandidate {
  provider: string;
  modelId: string;
  thinking: PiWebSubagentRunPolicy["thinking"];
}

function chooseModelRef(policy: PiWebSubagentRunPolicy, defaultModel: { provider: string; modelId: string } | null): AssistCandidate | null {
  if (policy.model.mode === "specific" && policy.model.provider && policy.model.modelId) return { provider: policy.model.provider, modelId: policy.model.modelId, thinking: policy.thinking };
  if (!defaultModel) return null;
  return { ...defaultModel, thinking: policy.thinking };
}

function reasoningForCandidate(candidate: AssistCandidate) {
  return candidate.thinking === "inherit" || candidate.thinking === "off" ? undefined : candidate.thinking;
}

export async function POST(request: NextRequest) {
  try {
    const input = validateRequest(await request.json());
    const allowedRoots = await getAllowedRoots();
    if (!isPathAllowed(input.cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const services = await createAgentSessionServices({ cwd: input.cwd, agentDir: getAgentDir(), resourceLoaderOptions: { extensionFactories: webExtensionFactories() } });
    const config = readPiWebConfig();
    const defaultProvider = services.settingsManager.getDefaultProvider();
    const defaultModelId = services.settingsManager.getDefaultModel();
    const defaultCandidate = defaultProvider && defaultModelId ? { provider: defaultProvider, modelId: defaultModelId } : null;
    const selected = chooseModelRef(config.trellis.workflowAssistant, defaultCandidate);
    const fallback = chooseModelRef(config.trellis.workflowAssistantFallback, defaultCandidate);
    if (!selected) return NextResponse.json({ error: "No workflow assistant model configured and no Pi default model found" }, { status: 400 });

    const candidates = [selected];
    const pushCandidate = (candidate: AssistCandidate | null) => {
      if (!candidate) return;
      if (candidates.some((item) => item.provider === candidate.provider && item.modelId === candidate.modelId && item.thinking === candidate.thinking)) return;
      candidates.push(candidate);
    };
    pushCandidate(fallback);
    pushCandidate(defaultCandidate ? { ...defaultCandidate, thinking: config.trellis.workflowAssistantFallback.thinking } : null);

    async function runCandidateCompletion(candidate: AssistCandidate, prompt: string, timeoutMs: number): Promise<string> {
      const model = services.modelRegistry.find(candidate.provider, candidate.modelId);
      if (!model) return "";
      const auth = await services.modelRegistry.getApiKeyAndHeaders(model);
      if (!auth.ok || !auth.apiKey) return "";
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const message = await completeSimple(model, {
          messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
        }, {
          apiKey: auth.apiKey,
          headers: auth.headers,
          maxTokens: 4000,
          reasoning: reasoningForCandidate(candidate),
          timeoutMs,
          maxRetries: 1,
          cacheRetention: "none",
          signal: controller.signal,
        });
        if (message.stopReason === "error" || message.stopReason === "aborted") return "";
        return textFromAssistant(message).trim();
      } catch {
        return "";
      } finally {
        clearTimeout(timeout);
      }
    }

    for (const candidate of candidates) {
      const structuredRaw = await runCandidateCompletion(candidate, buildJsonPrompt(input), STRUCTURED_ASSIST_TIMEOUT_MS);
      if (structuredRaw) return NextResponse.json({ ...parseAssistJson(structuredRaw), model: candidate });
    }

    const plainCandidates = candidates.length > 1 ? [...candidates.slice(1), candidates[0]] : candidates;
    for (const candidate of plainCandidates) {
      const plainRaw = await runCandidateCompletion(candidate, buildPlainPrompt(input), PLAIN_ASSIST_TIMEOUT_MS);
      if (plainRaw) return NextResponse.json({ ...parsePlainAssist(plainRaw), model: candidate });
    }

    return NextResponse.json({ error: `Workflow assistant models returned empty text: ${candidates.map((item) => `${item.provider}/${item.modelId}`).join(", ")}. 请在 Settings → Trellis 更换“流程辅助阅读模型”后重试。` }, { status: 502 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
