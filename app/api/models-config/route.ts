/**
 * Models configuration API — read/write ~/.pi/agent/models.json.
 *
 * GET  — returns the models.json object body (legacy shape) plus
 *        Cache-Control: no-store and ETag / X-Models-Config-Revision headers.
 * PUT  — atomic write under the shared models.json write lock; optional
 *        If-Match revision (409 on stale); always returns additive revision.
 *
 * Malformed on-disk models.json fails closed on PUT (does not overwrite with
 * empty providers). Cost-rate normalization for custom models is preserved.
 */

import { NextResponse } from "next/server";
import {
  mutateModelsJsonUnderLock,
  readModelsJsonRaw,
} from "@/lib/models-config-store";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const REVISION_HEADER = "X-Models-Config-Revision";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Pi ModelRegistry rejects the entire models.json when any custom model cost
 * object is missing required rates (input/output/cacheRead/cacheWrite).
 * Keep partial UI edits valid by filling missing rates with 0.
 */
function ensureCustomModelCostRates(cost: Record<string, unknown>): Record<string, unknown> {
  return {
    ...cost,
    input: typeof cost.input === "number" ? cost.input : 0,
    output: typeof cost.output === "number" ? cost.output : 0,
    cacheRead: typeof cost.cacheRead === "number" ? cost.cacheRead : 0,
    cacheWrite: typeof cost.cacheWrite === "number" ? cost.cacheWrite : 0,
  };
}

function normalizeModelsJsonForWrite(data: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(data.providers)) return data;
  const providers: Record<string, unknown> = {};
  for (const [providerName, providerValue] of Object.entries(data.providers)) {
    if (!isRecord(providerValue)) {
      providers[providerName] = providerValue;
      continue;
    }
    const models = providerValue.models;
    if (!Array.isArray(models)) {
      providers[providerName] = providerValue;
      continue;
    }
    providers[providerName] = {
      ...providerValue,
      models: models.map((model) => {
        if (!isRecord(model) || !isRecord(model.cost)) return model;
        return { ...model, cost: ensureCustomModelCostRates(model.cost) };
      }),
    };
  }
  return { ...data, providers };
}

function revisionHeaders(revision: string): Record<string, string> {
  return {
    ...NO_STORE,
    ETag: `"${revision}"`,
    [REVISION_HEADER]: revision,
  };
}

function parseIfMatchRevision(header: string | null): string | undefined {
  if (!header) return undefined;
  const raw = header.trim();
  if (!raw || raw === "*") return undefined;
  // Support weak/strong ETag forms: W/"rev" or "rev" or bare rev.
  const m = raw.match(/^(?:W\/)?"?([a-f0-9]{16})"?$/i);
  if (m) return m[1].toLowerCase();
  // Also accept bare opaque revision without quotes.
  if (/^[a-f0-9]{16}$/i.test(raw)) return raw.toLowerCase();
  return raw.replace(/^W\//i, "").replace(/^"|"$/g, "").trim() || undefined;
}

export async function GET() {
  const current = readModelsJsonRaw();
  if (current.parseError) {
    return NextResponse.json(
      {
        error: "models.json is invalid and cannot be loaded",
        code: "models_config_invalid",
      },
      { status: 500, headers: revisionHeaders(current.revision) },
    );
  }

  // Legacy body shape: raw config object. Missing file → empty providers.
  const body = current.exists ? current.parsed : { providers: {} };
  return NextResponse.json(body, { headers: revisionHeaders(current.revision) });
}

export async function PUT(req: Request) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Request body must be valid JSON" },
        { status: 400, headers: NO_STORE },
      );
    }

    if (!isRecord(body)) {
      return NextResponse.json(
        { error: "Request body must be a JSON object" },
        { status: 400, headers: NO_STORE },
      );
    }

    const expectedRevision = parseIfMatchRevision(req.headers.get("if-match"));
    const normalized = normalizeModelsJsonForWrite(body);

    const outcome = await mutateModelsJsonUnderLock({
      expectedRevision,
      backup: true,
      failClosedOnParseError: true,
      mutate: () => ({
        data: normalized,
        result: true as const,
      }),
    });

    if (!outcome.ok) {
      if (outcome.status === "stale_revision") {
        return NextResponse.json(
          {
            error:
              "Revision conflict: models.json was modified by another request. " +
              "Please reload and retry.",
            code: "stale_revision",
            currentRevision: outcome.revision,
          },
          { status: 409, headers: revisionHeaders(outcome.revision) },
        );
      }
      if (outcome.status === "parse_error") {
        return NextResponse.json(
          {
            error:
              "models.json is invalid and cannot be overwritten. " +
              "Fix or restore the file, then retry.",
            code: "models_config_invalid",
          },
          { status: 500, headers: revisionHeaders(outcome.revision) },
        );
      }
      return NextResponse.json(
        {
          error: "Failed to save models.json",
          code: "write_failed",
        },
        { status: 500, headers: revisionHeaders(outcome.revision) },
      );
    }

    // Additive revision field; success remains true for legacy clients.
    return NextResponse.json(
      { success: true, revision: outcome.revision },
      { headers: revisionHeaders(outcome.revision) },
    );
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500, headers: NO_STORE },
    );
  }
}
