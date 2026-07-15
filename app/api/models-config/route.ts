import { NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const dynamic = "force-dynamic";

function getModelsPath(): string {
  return join(getAgentDir(), "models.json");
}

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

function readModelsJson(): Record<string, unknown> {
  const path = getModelsPath();
  if (!existsSync(path)) return { providers: {} };
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return { providers: {} };
  }
}

function writeModelsJson(data: Record<string, unknown>): void {
  const path = getModelsPath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
}

export async function GET() {
  return NextResponse.json(readModelsJson());
}

export async function PUT(req: Request) {
  try {
    const body = await req.json() as Record<string, unknown>;
    writeModelsJson(normalizeModelsJsonForWrite(body));
    // Model registry refreshes on each /api/models request (no local cache to invalidate)
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
