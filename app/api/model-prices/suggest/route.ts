/**
 * Model price suggestion API — intelligent pricing lookup with audit trail.
 *
 * POST — Accepts a list of target models and returns pricing suggestions
 *         with evidence, confidence scores, and warnings. Suggestions are
 *         never written to models.json automatically; the user must
 *         explicitly confirm and save via PATCH /api/model-prices.
 *
 * Security contract:
 * - Only fixed HTTPS allowlist URLs are contacted (see model-price-sources.ts).
 * - Request body cannot inject arbitrary URLs, paths, prompts, or credentials.
 * - AI receives only bounded, pre-fetched evidence excerpts.
 * - AI has no network, file, or tool access.
 * - Responses never include secrets, absolute paths, or raw fetched pages.
 * - Cache-Control: no-store; rate-limited and single-flighted.
 * - Logs never contain credentials, raw page bodies, or user config.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAgentSessionServices, getAgentDir } from "@earendil-works/pi-coding-agent";
import { getAllowedRoots, isPathAllowed } from "@/lib/allowed-roots";
import { readPiWebConfig } from "@/lib/pi-web-config";
import {
  tryDeterministicMatch,
  fetchRelevantEntries,
  extractModelExcerpt,
  fetchOpenRouterCatalog,
} from "@/lib/model-price-sources";
import type { OpenRouterModelEntry } from "@/lib/model-price-sources";
import { runBatchPricingAssistant } from "@/lib/model-price-assistant";
import type {
  ModelPriceSuggestRequest,
  ModelPriceSuggestResponse,
  ModelPriceSuggestion,
  ModelPriceSuggestionTarget,
  ModelPriceSuggestionEvidence,
} from "@/lib/model-price-types";
import { MODEL_PRICE_SUGGEST_TARGETS_MAX } from "@/lib/model-price-types";
import { stat } from "fs/promises";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

// ── Helpers ──────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorResponse(
  status: number,
  message: string,
  extra?: Record<string, unknown>,
): NextResponse {
  const body: Record<string, unknown> = { error: message };
  if (extra) Object.assign(body, extra);
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/**
 * Validate the suggest request body.
 * Rejects: non-object, targets not array, empty targets, too many targets,
 * invalid provider/model strings, extra fields (URL, prompt, path, etc.).
 */
function validateRequest(body: unknown): ModelPriceSuggestRequest {
  if (!isRecord(body)) {
    throw new ValidationError("Request body must be an object");
  }

  // Explicitly reject injection fields
  const forbiddenFields = ["url", "prompt", "path", "file", "source", "apiKey", "api_key", "key", "token", "secret"];
  for (const field of forbiddenFields) {
    if (field in body) {
      throw new ValidationError(`Field "${field}" is not allowed in suggest requests`);
    }
  }

  const targets = body.targets;
  if (!Array.isArray(targets)) {
    throw new ValidationError("targets must be an array");
  }
  if (targets.length === 0) {
    throw new ValidationError("targets must not be empty");
  }
  if (targets.length > MODEL_PRICE_SUGGEST_TARGETS_MAX) {
    throw new ValidationError(
      `Maximum ${MODEL_PRICE_SUGGEST_TARGETS_MAX} targets per request, got ${targets.length}`,
    );
  }

  const parsed: ModelPriceSuggestionTarget[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < targets.length; i++) {
    const item = targets[i];
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new ValidationError(`targets[${i}] must be an object`);
    }
    const obj = item as Record<string, unknown>;

    const provider = typeof obj.provider === "string" ? obj.provider.trim() : "";
    const model = typeof obj.model === "string" ? obj.model.trim() : "";
    if (!provider || !model) {
      throw new ValidationError(
        `targets[${i}]: provider and model must be non-empty strings`,
      );
    }

    const key = `${provider}:${model}`;
    if (seen.has(key)) {
      throw new ValidationError(`Duplicate target: ${key}`);
    }
    seen.add(key);

    parsed.push({ provider, model });
  }

  const cwd = typeof body.cwd === "string" ? body.cwd.trim() : undefined;

  return { targets: parsed, cwd };
}

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

// ── POST /api/model-prices/suggest ────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    // 1. Parse and validate request body
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return errorResponse(400, "Request body must be valid JSON");
    }

    let request: ModelPriceSuggestRequest;
    try {
      request = validateRequest(body);
    } catch (err) {
      if (err instanceof ValidationError) {
        return errorResponse(400, err.message);
      }
      throw err;
    }

    // 2. Validate cwd (if provided) against allowed roots
    const cwd = request.cwd ?? process.cwd();
    try {
      const cwdStat = await stat(cwd);
      if (!cwdStat.isDirectory()) {
        return errorResponse(400, "cwd must be a directory");
      }
    } catch {
      return errorResponse(400, "cwd directory does not exist");
    }

    const allowedRoots = await getAllowedRoots();
    if (!isPathAllowed(cwd, allowedRoots)) {
      return errorResponse(403, "Access denied");
    }

    // 3. Create services and read config
    const agentDir = getAgentDir();
    const services = await createAgentSessionServices({ cwd, agentDir });
    const config = readPiWebConfig();
    const defaultProvider = services.settingsManager.getDefaultProvider();
    const defaultModelId = services.settingsManager.getDefaultModel();

    // 4. Fetch OpenRouter catalog once for deterministic matching
    let catalog: Map<string, OpenRouterModelEntry> | undefined;
    let catalogError: string | undefined;
    try {
      catalog = await fetchOpenRouterCatalog();
    } catch (err) {
      catalogError = err instanceof Error ? err.message : String(err);
    }

    const suggestions: ModelPriceSuggestion[] = [];
    const unresolved: ModelPriceSuggestionTarget[] = [];
    const warnings: string[] = [];

    if (catalogError) {
      warnings.push(`Price source unavailable: ${catalogError}. Only AI-assisted matching will be attempted.`);
    }

    // 5. Phase 1: Try deterministic matching for each target
    const aiTargets: Array<{
      provider: string;
      model: string;
      excerpts: string[];
      evidenceUrls: ModelPriceSuggestionEvidence[];
    }> = [];

    for (const target of request.targets) {
      const matchResult = catalog
        ? await tryDeterministicMatch(target.provider, target.model, catalog)
        : null;

      if (matchResult && Object.keys(matchResult.prices).length > 0) {
        // Deterministic match found
        const suggestion: ModelPriceSuggestion = {
          provider: target.provider,
          model: target.model,
          prices: matchResult.prices,
          currency: "USD",
          unit: "per_1m_tokens",
          confidence: matchResult.confidence,
          matchMethod: matchResult.matchMethod,
          evidence: matchResult.evidence,
          warnings: matchResult.warnings,
          matchedId: matchResult.matchedId,
          normalizedLabel: matchResult.normalizedLabel,
        };

        // Low-confidence alias matches should still be offered, but with warnings
        suggestions.push(suggestion);
        continue;
      }

      // No deterministic match — queue for AI-assisted extraction
      const excerpts: string[] = [];
      let evidenceUrls: ModelPriceSuggestionEvidence[] = [];

      if (catalog) {
        // Find relevant entries for this target for AI context (identity-aware).
        const relevantEntries = await fetchRelevantEntries([target], catalog);
        for (const [entryId, entry] of relevantEntries) {
          excerpts.push(extractModelExcerpt(entry, entryId));
        }
      }

      if (excerpts.length > 0) {
        evidenceUrls = [{
          url: "https://openrouter.ai/api/v1/models",
          title: "OpenRouter Model Catalog",
          fetchedAt: new Date().toISOString(),
          excerptHash: `${excerpts.length} excerpts`,
        }];
        aiTargets.push({
          provider: target.provider,
          model: target.model,
          excerpts,
          evidenceUrls,
        });
      } else {
        // No evidence at all — cannot suggest
        unresolved.push(target);
      }
    }

    // 6. Phase 2: AI-assisted extraction for remaining targets
    let effectiveDefaultProvider: string;
    let effectiveDefaultModelId: string;
    if (defaultProvider && defaultModelId) {
      effectiveDefaultProvider = defaultProvider;
      effectiveDefaultModelId = defaultModelId;
    } else {
      // If no default model is configured, AI-assisted extraction is unavailable
      if (aiTargets.length > 0) {
        warnings.push(
          "No default model configured in Pi settings. AI-assisted price extraction is unavailable. " +
          "Only deterministic matches are returned.",
        );
        for (const target of aiTargets) {
          unresolved.push({ provider: target.provider, model: target.model });
        }
      }
      // Build response directly — skip AI phase
      const response: ModelPriceSuggestResponse = {
        schemaVersion: 1,
        suggestions,
        unresolved,
        warnings,
        generatedAt: new Date().toISOString(),
      };
      return NextResponse.json(response, { headers: NO_STORE });
    }

    if (aiTargets.length > 0) {
      try {
        const aiResults = await runBatchPricingAssistant(
          aiTargets.map((t) => ({
            provider: t.provider,
            model: t.model,
            excerpts: t.excerpts,
            evidenceUrls: t.evidenceUrls,
          })),
          {
            registry: services.modelRegistry,
            defaultProvider: effectiveDefaultProvider,
            defaultModelId: effectiveDefaultModelId,
            primaryPolicy: config.usage.pricingAssistant,
            fallbackPolicy: config.usage.pricingAssistantFallback,
            timeoutMs: 20_000,
          },
        );

        for (const target of aiTargets) {
          const key = `${target.provider}:${target.model}`;
          const suggestion = aiResults.get(key);
          if (suggestion) {
            suggestions.push(suggestion);
          } else {
            unresolved.push({ provider: target.provider, model: target.model });
          }
        }
      } catch (err) {
        // AI failed entirely — all AI targets are unresolved
        warnings.push(
          `AI pricing assistant failed: ${err instanceof Error ? err.message : String(err)}. ` +
          `Only deterministic matches are returned.`,
        );
        for (const target of aiTargets) {
          unresolved.push({ provider: target.provider, model: target.model });
        }
      }
    }

    // 7. Build response
    const response: ModelPriceSuggestResponse = {
      schemaVersion: 1,
      suggestions,
      unresolved,
      warnings,
      generatedAt: new Date().toISOString(),
    };

    return NextResponse.json(response, { headers: NO_STORE });
  } catch (err) {
    // Log without sensitive details
    const message = err instanceof Error ? err.message : String(err);
    console.error("[model-prices/suggest] Unexpected error:", message);
    return errorResponse(500, "Internal server error");
  }
}
