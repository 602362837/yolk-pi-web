/**
 * Model price assistant — AI-powered structured extraction from bounded evidence.
 *
 * Design contract (from design.md):
 * - AI only receives bounded evidence (pre-fetched, trimmed excerpts). It never
 *   has network access, file access, tool access, or access to raw web pages.
 * - AI output is validated against a strict JSON schema. Malformed or
 *   hallucinated output is rejected and triggers fallback.
 * - "No evidence" is a hard constraint: if there is no source data for a model,
 *   the assistant returns null (never fabricates prices from "common knowledge").
 * - The assistant uses the configured pricing assistant policy from pi-web.json
 *   (usage.pricingAssistant / usage.pricingAssistantFallback).
 * - The assistant does NOT write to models.json or any file.
 */

import { completeSimple } from "@earendil-works/pi-ai/compat";
import type { Model, Api } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import type {
  ModelPriceSuggestion,
  ModelPriceSuggestionEvidence,
  PriceRates,
} from "./model-price-types";
import type { PiWebSubagentRunPolicy } from "./pi-web-config";

// ── JSON output schema (as a prompt instruction, not runtime validation) ─────

const EXTRACTION_SYSTEM_PROMPT = `You are a pricing data extraction assistant for model price configuration.
Your ONLY job is to extract pricing information from the provided evidence.

RULES:
1. ONLY use the evidence provided below. Do NOT use your own knowledge of model pricing.
2. If the evidence does not contain clear pricing data for the requested model, respond with {"found": false, "reason": "..."} instead of guessing.
3. Prices are in USD per 1 million tokens (USD/1M).
4. Output MUST be valid JSON with exactly this structure:
   {"found": true, "input": <number>, "output": <number>, "cacheRead": <number|null>, "confidence": "medium"|"low", "notes": "<string>"}
5. Confidence: "medium" if evidence directly states the price. "low" if prices are inferred or from a different routing.
6. The "notes" field must describe the source of each price field.
7. Do NOT include markdown fences, code blocks, or any text outside the JSON object.
8. Do NOT invent prices if they are not in the evidence.`;

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildExtractionPrompt(
  provider: string,
  model: string,
  excerpts: string[],
): string {
  const evidenceBlock = excerpts.length > 0
    ? excerpts.map((e, i) => `[Evidence ${i + 1}]\n${e}`).join("\n\n")
    : "NO EVIDENCE AVAILABLE. You MUST respond with {\"found\": false}.";

  return `Extract pricing for this model:
Provider: ${provider}
Model ID: ${model}

Evidence:
${evidenceBlock}

If you can determine pricing from the evidence above, return the JSON.
If the evidence does NOT contain pricing for this specific model, return {"found": false, "reason": "no pricing data found in evidence"}.`;
}

// ── JSON parsing helpers ─────────────────────────────────────────────────────

interface ExtractionResult {
  found: boolean;
  input?: number;
  output?: number;
  cacheRead?: number | null;
  confidence?: "medium" | "low";
  notes?: string;
  reason?: string;
}

function stripJsonFence(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function findJsonObject(raw: string): string | null {
  const stripped = stripJsonFence(raw);
  if (stripped.startsWith("{") && stripped.endsWith("}")) return stripped;
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start !== -1 && end > start) return stripped.slice(start, end + 1);
  return null;
}

function parseExtractionResult(raw: string): ExtractionResult | null {
  const jsonText = findJsonObject(raw);
  if (!jsonText) return null;

  try {
    const parsed = JSON.parse(jsonText) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    const obj = parsed as Record<string, unknown>;
    const found = obj.found === true;

    if (!found) {
      return {
        found: false,
        reason: typeof obj.reason === "string" ? obj.reason : "Unknown reason",
      };
    }

    const input = typeof obj.input === "number" && Number.isFinite(obj.input) && obj.input >= 0
      ? obj.input : undefined;
    const output = typeof obj.output === "number" && Number.isFinite(obj.output) && obj.output >= 0
      ? obj.output : undefined;
    const cacheRead = obj.cacheRead === null
      ? null
      : typeof obj.cacheRead === "number" && Number.isFinite(obj.cacheRead) && obj.cacheRead >= 0
        ? obj.cacheRead : undefined;

    if (input === undefined && output === undefined) {
      return { found: false, reason: "No valid price values extracted" };
    }

    const confidence = obj.confidence === "medium" || obj.confidence === "low"
      ? obj.confidence : "medium";

    return {
      found: true,
      input,
      output,
      cacheRead,
      confidence,
      notes: typeof obj.notes === "string" ? obj.notes : undefined,
    };
  } catch {
    return null;
  }
}

// ── Text extraction from AssistantMessage ─────────────────────────────────────

function textFromAssistant(
  message: Awaited<ReturnType<typeof completeSimple>>,
): string {
  return message.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("");
}

// ── Pricing assistant execution ───────────────────────────────────────────────

interface AssistantCandidate {
  provider: string;
  modelId: string;
  thinking: PiWebSubagentRunPolicy["thinking"];
}

function chooseModelRef(
  policy: PiWebSubagentRunPolicy,
  defaultModel: { provider: string; modelId: string } | null,
): AssistantCandidate | null {
  if (
    policy.model.mode === "specific" &&
    policy.model.provider &&
    policy.model.modelId
  ) {
    return {
      provider: policy.model.provider,
      modelId: policy.model.modelId,
      thinking: policy.thinking,
    };
  }
  if (!defaultModel) return null;
  return { ...defaultModel, thinking: policy.thinking };
}

function reasoningForCandidate(candidate: AssistantCandidate) {
  return candidate.thinking === "inherit" || candidate.thinking === "off"
    ? undefined
    : candidate.thinking;
}

interface RunAssistantOptions {
  registry: ModelRegistry;
  defaultProvider: string;
  defaultModelId: string;
  primaryPolicy: PiWebSubagentRunPolicy;
  fallbackPolicy: PiWebSubagentRunPolicy;
  timeoutMs?: number;
}

/**
 * Run the pricing assistant to extract a suggestion from bounded evidence.
 *
 * @param provider - The target provider
 * @param model - The target model id
 * @param excerpts - Bounded evidence excerpts (NEVER raw URLs or full pages)
 * @param evidenceUrls - Source evidence metadata for audit trail
 * @param options - Model registry and policy configuration
 *
 * @returns A structured suggestion, or null if extraction failed.
 *   Never writes to any file.
 */
export async function runPricingAssistant(
  provider: string,
  model: string,
  excerpts: string[],
  evidenceUrls: ModelPriceSuggestionEvidence[],
  options: RunAssistantOptions,
): Promise<ModelPriceSuggestion | null> {
  // Hard guard: no evidence = no AI call
  if (excerpts.length === 0) return null;

  const defaultCandidate = options.defaultProvider && options.defaultModelId
    ? { provider: options.defaultProvider, modelId: options.defaultModelId }
    : null;

  const selected = chooseModelRef(options.primaryPolicy, defaultCandidate);
  const fallback = chooseModelRef(options.fallbackPolicy, defaultCandidate);

  const candidates: AssistantCandidate[] = [];
  if (selected) candidates.push(selected);
  if (fallback && !candidates.some(
    (c) => c.provider === fallback.provider && c.modelId === fallback.modelId,
  )) {
    candidates.push(fallback);
  }
  if (defaultCandidate && !candidates.some(
    (c) => c.provider === defaultCandidate.provider && c.modelId === defaultCandidate.modelId,
  )) {
    candidates.push({
      ...defaultCandidate,
      thinking: options.fallbackPolicy.thinking,
    });
  }

  if (candidates.length === 0) return null;

  const prompt = buildExtractionPrompt(provider, model, excerpts);
  const timeoutMs = options.timeoutMs ?? 20_000;

  for (const candidate of candidates) {
    try {
      const foundModel = options.registry.find(candidate.provider, candidate.modelId);
      if (!foundModel) continue;

      const auth = await options.registry.getApiKeyAndHeaders(foundModel);
      if (!auth.ok || !auth.apiKey) continue;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const message = await completeSimple(foundModel as Model<Api>, {
          systemPrompt: EXTRACTION_SYSTEM_PROMPT,
          messages: [
            { role: "user", content: prompt, timestamp: Date.now() },
          ],
        }, {
          apiKey: auth.apiKey,
          headers: auth.headers,
          maxTokens: 1000,
          reasoning: reasoningForCandidate(candidate),
          timeoutMs,
          maxRetries: 1,
          cacheRetention: "none",
          signal: controller.signal,
        });

        if (
          message.stopReason === "error" ||
          message.stopReason === "aborted"
        ) {
          continue;
        }

        const text = textFromAssistant(message).trim();
        if (!text) continue;

        const result = parseExtractionResult(text);
        if (!result) continue;

        if (!result.found) {
          // AI explicitly said it can't find pricing
          return null;
        }

        const prices: Partial<PriceRates> = {};
        if (result.input !== undefined && result.input > 0) prices.input = result.input;
        if (result.output !== undefined && result.output > 0) prices.output = result.output;
        if (result.cacheRead !== undefined && result.cacheRead !== null && result.cacheRead > 0) {
          prices.cacheRead = result.cacheRead;
        }

        if (Object.keys(prices).length === 0) return null;

        return {
          provider,
          model,
          prices,
          currency: "USD",
          unit: "per_1m_tokens",
          confidence: result.confidence ?? "medium",
          matchMethod: "ai_assisted",
          evidence: evidenceUrls,
          warnings: result.notes ? [result.notes] : [],
        };
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      // Try next candidate
      continue;
    }
  }

  return null;
}

// ── Batch suggestion builder ──────────────────────────────────────────────────

export interface BatchSuggestionInput {
  provider: string;
  model: string;
  excerpts: string[];
  evidenceUrls: ModelPriceSuggestionEvidence[];
}

/**
 * Run AI-assisted extraction for multiple targets in sequence.
 *
 * Partial failures are allowed: some targets may succeed while others fail.
 * The caller should merge AI results with deterministic match results.
 */
export async function runBatchPricingAssistant(
  targets: BatchSuggestionInput[],
  options: RunAssistantOptions,
): Promise<Map<string, ModelPriceSuggestion>> {
  const results = new Map<string, ModelPriceSuggestion>();

  for (const target of targets) {
    const key = `${target.provider}:${target.model}`;
    try {
      const suggestion = await runPricingAssistant(
        target.provider,
        target.model,
        target.excerpts,
        target.evidenceUrls,
        options,
      );
      if (suggestion) {
        results.set(key, suggestion);
      }
    } catch {
      // Individual target failure is non-fatal
    }
  }

  return results;
}
