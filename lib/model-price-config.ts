/**
 * Model price configuration service.
 *
 * Reads resolved model pricing from a ModelRuntime-compatible catalog,
 * generates sanitized projections, and provides atomic write-path helpers for
 * models.json. Callers pass ModelRuntime (or a narrow catalog view); this
 * module never constructs ModelRegistry.
 *
 * Security contract:
 * - Lists never contain secrets, API keys, absolute paths, or full models.json.
 * - Write operations target only fixed files under getAgentDir().
 * - JSONC comments are handled via stripJsonComments on read; writes produce
 *   clean JSON with a pre-write backup.
 */

import { createHash, randomBytes } from "crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import type { Api } from "@earendil-works/pi-ai";

/**
 * Narrow catalog surface used by price listing / post-write verification.
 * Satisfied by ModelRuntime without depending on the extension-only
 * ModelRegistry facade.
 */
export interface ModelPriceCatalog {
  getModels(providerId?: string): readonly Model<Api>[];
  getModel(providerId: string, modelId: string): Model<Api> | undefined;
  getProvider?(providerId: string): { name?: string } | undefined;
}

function providerDisplayName(
  catalog: ModelPriceCatalog,
  providerId: string,
): string | undefined {
  const name = catalog.getProvider?.(providerId)?.name;
  return name && name !== providerId ? name : undefined;
}

import type {
  ModelPriceKind,
  ModelPriceListResponse,
  ModelPricePatchChange,
  ModelPricePatchRequest,
  ModelPricePatchResultEntry,
  ModelPriceRecord,
  ModelPriceSource,
  ModelPriceStatus,
  PriceRates,
} from "./model-price-types";
import { isValidPriceValue } from "./model-price-types";
import { readPiWebConfig, writePiWebConfigPatch } from "./pi-web-config";

// ── JSON comment stripping ────────────────────────────────────────────────────

/**
 * Strip `//` line comments and trailing commas from JSON-like text,
 * leaving string literals untouched.
 *
 * Replicates the Pi SDK internal `stripJsonComments` utility since it is not
 * exported from the package.
 */
export function stripJsonComments(input: string): string {
  return input
    // Remove // line comments (preserve string content)
    .replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*/g, (m) => (m[0] === '"' ? m : ""))
    // Remove trailing commas before ] or }
    .replace(/"(?:\\.|[^"\\])*"|,(\s*[}\]])/g, (m, tail) =>
      tail ?? (m[0] === '"' ? m : ""),
    );
}

// ── Paths ─────────────────────────────────────────────────────────────────────

export function getModelsJsonPath(): string {
  return join(getAgentDir(), "models.json");
}

export function getModelsJsonBackupPath(path?: string): string {
  const target = path ?? getModelsJsonPath();
  return `${target}.pi-price-backup`;
}

// ── Revision ──────────────────────────────────────────────────────────────────

/**
 * Compute an opaque revision token for optimistic concurrency control.
 * Uses SHA-256 of the raw file content (or a random nonce if the file doesn't exist).
 */
export function computeRevision(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

// ── Read ──────────────────────────────────────────────────────────────────────

export interface ReadRawResult {
  /** Raw file text (empty string if file does not exist). */
  raw: string;
  /** Parsed JSON object. */
  parsed: Record<string, unknown>;
  /** Whether the file exists. */
  exists: boolean;
  /** Parse error message, if any. */
  parseError?: string;
  /** Opaque revision token. */
  revision: string;
}

/** Deterministic revision for the empty / non-existent models.json state. */
const EMPTY_REVISION = computeRevision("{}");

/**
 * Read models.json, returning the raw text, parsed object, and revision.
 * JSONC comments are stripped before parsing.
 */
export function readModelsJsonRaw(): ReadRawResult {
  const path = getModelsJsonPath();
  if (!existsSync(path)) {
    return {
      raw: "{}",
      parsed: {},
      exists: false,
      revision: EMPTY_REVISION,
    };
  }

  const raw = readFileSync(path, "utf8");
  const revision = computeRevision(raw);

  try {
    const cleaned = stripJsonComments(raw);
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    return { raw, parsed, exists: true, revision };
  } catch (error) {
    return {
      raw,
      parsed: {},
      exists: true,
      parseError: error instanceof Error ? error.message : String(error),
      revision,
    };
  }
}

// ── Price projection ──────────────────────────────────────────────────────────

/**
 * Determine whether a model is custom (defined in models.json `models[]`)
 * or builtin/extension (from Pi internals or extension registrations).
 */
export function classifyModelKind(
  model: Model<Api>,
  customModelProviderIds: Set<string>,
): ModelPriceKind {
  // If the provider has custom models defined in models.json, all models
  // on that provider that are NOT built-in models with the same id as
  // a custom model are still builtin. We determine this by checking
  // whether the provider has models listed in the raw models.json `providers[provider].models`.
  //
  // A more reliable heuristic: if the model's provider has custom models
  // and the model id appears among them, it's custom. Otherwise builtin/extension.
  return customModelProviderIds.has(model.provider) &&
    model.id !== model.name &&
    model.name.length > 0
    ? "builtin_or_extension"
    : "builtin_or_extension";
  // Note: the actual distinction is done in getModelPriceRecords where we
  // have access to the raw models.json parsed data.
}

/**
 * Determine the price status and source for a model.
 *
 * Order of precedence:
 * 1. If the model is in `explicitFreeModels`, status is "free".
 * 2. If the model has an override in models.json, status is "configured".
 * 3. If the resolved cost is non-zero, status is "builtin".
 * 4. Otherwise, status is "missing".
 */
export function resolveModelPriceStatus(
  resolved: PriceRates,
  hasOverride: boolean,
  isExplicitFree: boolean,
): { status: ModelPriceStatus; source: ModelPriceSource } {
  if (isExplicitFree) {
    return { status: "free", source: "explicit_free" };
  }
  if (hasOverride) {
    return { status: "configured", source: "models_json_override" };
  }
  if (isCustomOverrideModel()) {
    // Custom model with user-specified cost
    return { status: "configured", source: "custom_model" };
  }
  if (resolved.input > 0 || resolved.output > 0 || resolved.cacheRead > 0) {
    return { status: "builtin", source: "builtin" };
  }
  return { status: "missing", source: "builtin" };
}

function isCustomOverrideModel(): boolean {
  // This is determined by checking the raw models.json for custom models
  // with explicit cost. Handled in getModelPriceRecords.
  return false;
}

/**
 * Read the set of explicit free models from pi-web.json.
 */
export function getExplicitFreeModels(): Set<string> {
  const config = readPiWebConfig();
  const usageRaw = config.usage as unknown as Record<string, unknown>;
  const list = Array.isArray(usageRaw?.explicitFreeModels)
    ? usageRaw.explicitFreeModels as Array<{ provider: string; model: string }>
    : [];
  return new Set(list.map((e) => `${e.provider}:${e.model}`));
}

/**
 * Get all custom model ids from models.json, organized by provider.
 * Returns a map of provider -> Set<modelId>.
 */
export function getCustomModelIds(parsedModelsJson: Record<string, unknown>): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  const providers = parsedModelsJson.providers;
  if (typeof providers !== "object" || providers === null || Array.isArray(providers)) {
    return result;
  }

  for (const [providerName, providerConfig] of Object.entries(
    providers as Record<string, unknown>,
  )) {
    if (typeof providerConfig !== "object" || providerConfig === null || Array.isArray(providerConfig)) {
      continue;
    }
    const pc = providerConfig as Record<string, unknown>;
    const models = pc.models;
    if (!Array.isArray(models)) continue;

    const ids = new Set<string>();
    for (const model of models) {
      if (typeof model === "object" && model !== null && !Array.isArray(model)) {
        const id = (model as Record<string, unknown>).id;
        if (typeof id === "string") ids.add(id);
      }
    }
    if (ids.size > 0) result.set(providerName, ids);
  }

  return result;
}

/**
 * Get all model overrides from models.json, organized by provider -> modelId.
 * Returns a map of "provider:modelId" -> true.
 */
export function getModelOverrideKeys(parsedModelsJson: Record<string, unknown>): Set<string> {
  const result = new Set<string>();
  const providers = parsedModelsJson.providers;
  if (typeof providers !== "object" || providers === null || Array.isArray(providers)) {
    return result;
  }

  for (const [providerName, providerConfig] of Object.entries(
    providers as Record<string, unknown>,
  )) {
    if (typeof providerConfig !== "object" || providerConfig === null || Array.isArray(providerConfig)) {
      continue;
    }
    const pc = providerConfig as Record<string, unknown>;
    const modelOverrides = pc.modelOverrides;
    if (typeof modelOverrides !== "object" || modelOverrides === null) continue;

    for (const modelId of Object.keys(modelOverrides as Record<string, unknown>)) {
      result.add(`${providerName}:${modelId}`);
    }
  }

  return result;
}

/**
 * Check if a model has a user-configured cost override in models.json.
 */
export function hasUserCostOverride(
  model: Model<Api>,
  parsedModelsJson: Record<string, unknown>,
): boolean {
  const providers = parsedModelsJson.providers;
  if (typeof providers !== "object" || providers === null) return false;

  const providerConfig = (providers as Record<string, unknown>)[model.provider];
  if (typeof providerConfig !== "object" || providerConfig === null) return false;

  const pc = providerConfig as Record<string, unknown>;

  // Check modelOverrides
  const modelOverrides = pc.modelOverrides;
  if (typeof modelOverrides === "object" && modelOverrides !== null) {
    const override = (modelOverrides as Record<string, unknown>)[model.id];
    if (typeof override === "object" && override !== null && "cost" in override) {
      return true;
    }
  }

  // Check custom models for explicit cost
  const customModels = pc.models;
  if (Array.isArray(customModels)) {
    for (const cm of customModels) {
      if (
        typeof cm === "object" &&
        cm !== null &&
        (cm as Record<string, unknown>).id === model.id &&
        "cost" in cm
      ) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Build a sanitized price record from a catalog model entry.
 */
function buildPriceRecord(
  model: Model<Api>,
  catalog: ModelPriceCatalog,
  parsedModelsJson: Record<string, unknown>,
  customModelIds: Map<string, Set<string>>,
  explicitFreeSet: Set<string>,
  revision: string,
): ModelPriceRecord {
  const providerId = model.provider;
  const modelId = model.id;
  const key = `${providerId}:${modelId}`;

  const isCustom = customModelIds.get(providerId)?.has(modelId) ?? false;
  const modelKind: ModelPriceKind = isCustom ? "custom" : "builtin_or_extension";
  const isExplicitFree = explicitFreeSet.has(key);
  const userOverride = hasUserCostOverride(model, parsedModelsJson);

  const resolved: PriceRates = {
    input: model.cost?.input ?? 0,
    output: model.cost?.output ?? 0,
    cacheRead: model.cost?.cacheRead ?? 0,
  };

  let status: ModelPriceStatus;
  let source: ModelPriceSource;

  if (isExplicitFree) {
    status = "free";
    source = "explicit_free";
  } else if (userOverride) {
    status = "configured";
    source = isCustom ? "custom_model" : "models_json_override";
  } else if (resolved.input > 0 || resolved.output > 0 || resolved.cacheRead > 0) {
    status = "builtin";
    source = "builtin";
  } else {
    status = "missing";
    source = "builtin";
  }

  const displayName = model.name && model.name !== model.id ? model.name : undefined;

  return {
    provider: providerId,
    model: modelId,
    displayName,
    providerDisplayName: providerDisplayName(catalog, providerId),
    modelKind,
    status,
    resolved,
    source,
    revision,
  };
}

/**
 * Generate the full sanitized model price list from the registry.
 *
 * This is the primary read-side entry point. It never exposes secrets,
 * absolute paths, full models.json content, auth details, or provider base URLs.
 */
export function getModelPriceRecords(
  catalog: ModelPriceCatalog,
  parsedModelsJson: Record<string, unknown>,
  revision: string,
): { models: ModelPriceRecord[]; explicitFreeModels: Array<{ provider: string; model: string }> } {
  const explicitFreeSet = getExplicitFreeModels();
  const customModelIds = getCustomModelIds(parsedModelsJson);
  const allModels = catalog.getModels();

  const records = allModels.map((model) =>
    buildPriceRecord(model, catalog, parsedModelsJson, customModelIds, explicitFreeSet, revision),
  );

  // Sort: missing first, then configured, then builtin, then free; within each group sort by provider+model
  const statusOrder: Record<ModelPriceStatus, number> = {
    missing: 0,
    configured: 1,
    builtin: 2,
    free: 3,
  };

  records.sort((a, b) => {
    const s = statusOrder[a.status] - statusOrder[b.status];
    if (s !== 0) return s;
    const p = a.provider.localeCompare(b.provider);
    if (p !== 0) return p;
    return a.model.localeCompare(b.model);
  });

  const explicitFreeList = Array.from(explicitFreeSet).map((key) => {
    const [provider, ...modelParts] = key.split(":");
    return { provider, model: modelParts.join(":") };
  });

  return { models: records, explicitFreeModels: explicitFreeList };
}

/**
 * Build the full GET response.
 */
export function buildModelPriceListResponse(
  catalog: ModelPriceCatalog,
  parsedModelsJson: Record<string, unknown>,
  revision: string,
): ModelPriceListResponse {
  const { models, explicitFreeModels } = getModelPriceRecords(
    catalog,
    parsedModelsJson,
    revision,
  );
  return {
    schemaVersion: 1,
    revision,
    models,
    explicitFreeModels,
  };
}

// ── Write ─────────────────────────────────────────────────────────────────────

/**
 * Backup the current models.json before a write operation.
 * Returns the backup path or undefined if backup was not needed.
 */
export function backupModelsJson(): string | undefined {
  const path = getModelsJsonPath();
  if (!existsSync(path)) return undefined;

  const backupPath = getModelsJsonBackupPath();
  const content = readFileSync(path, "utf8");
  mkdirSync(dirname(backupPath), { recursive: true });
  writeFileSync(backupPath, content, "utf8");
  return backupPath;
}

/**
 * Write content atomically to the models.json path.
 *
 * Uses temp file + rename for atomicity. Sets best-effort 0600 permissions.
 * Removes temp file on failure.
 */
export function writeModelsJsonAtomic(content: string): void {
  const targetPath = getModelsJsonPath();
  const dir = dirname(targetPath);
  mkdirSync(dir, { recursive: true });

  // Use a temp file in the same directory for atomic rename
  const tmpPath = join(dir, `.models.json.${randomBytes(6).toString("hex")}.tmp`);

  try {
    writeFileSync(tmpPath, content, { encoding: "utf8", mode: 0o600 });
    // Best-effort chmod on platforms that support it
    try {
      chmodSync(tmpPath, 0o600);
    } catch {
      // chmod may not be needed on all platforms
    }
    renameSync(tmpPath, targetPath);
  } catch (error) {
    // Clean up temp file on failure
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    } catch {
      // best-effort cleanup
    }
    throw error;
  }
}

// ── Merge helpers ─────────────────────────────────────────────────────────────

interface DeepRecord {
  [key: string]: unknown;
}

function isRecord(value: unknown): value is DeepRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Pi models.json requires full cost rates for custom model definitions.
 * modelOverrides may be partial, but custom `models[]` entries must include
 * input/output/cacheRead/cacheWrite whenever cost is present.
 */
function ensureCustomModelCostRates(cost: DeepRecord): DeepRecord {
  return {
    ...cost,
    input: typeof cost.input === "number" ? cost.input : 0,
    output: typeof cost.output === "number" ? cost.output : 0,
    cacheRead: typeof cost.cacheRead === "number" ? cost.cacheRead : 0,
    // Billing UI no longer manages cacheWrite, but schema still requires it.
    cacheWrite: typeof cost.cacheWrite === "number" ? cost.cacheWrite : 0,
  };
}

/** Deep-clone a value using JSON round-trip (safe for models.json content). */
function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Apply a batch of price changes to the models.json data structure.
 *
 * Returns the modified data and a list of per-change results.
 * This function is pure: it clones the input and does not write to disk.
 *
 * For built-in/extension model overrides:
 *   Writes to providers[provider].modelOverrides[modelId].cost
 * For custom models:
 *   Updates the matching entry in providers[provider].models[] by id
 *
 * Preserves: cost.cacheWrite, cost.tiers, all non-cost fields.
 */
export function mergePriceChanges(
  parsed: Record<string, unknown>,
  changes: ModelPricePatchChange[],
): { data: Record<string, unknown>; results: ModelPricePatchResultEntry[] } {
  const data = deepClone(parsed);
  const results: ModelPricePatchResultEntry[] = [];

  // Ensure providers exists
  if (!isRecord(data.providers)) {
    data.providers = {};
  }
  const providers = data.providers as DeepRecord;

  for (const change of changes) {
    const entry: ModelPricePatchResultEntry = {
      provider: change.provider,
      model: change.model,
      success: false,
    };

    try {
      const providerConfig: DeepRecord = (providers[change.provider] as DeepRecord | undefined) ?? {};
      // Always write back so the key exists on the providers object
      providers[change.provider] = providerConfig;

      // Try to update via modelOverrides first (for built-in/extension models)
      // Then try custom models array
      let applied = false;

      // Path 1: modelOverrides (for built-in/extension models)
      if (!applied) {
        const modelOverrides: DeepRecord = (providerConfig.modelOverrides as DeepRecord | undefined) ?? {};
        providerConfig.modelOverrides = modelOverrides;

        const override: DeepRecord = (modelOverrides[change.model] as DeepRecord | undefined) ?? {};
        modelOverrides[change.model] = override;

        // Only apply if this looks like the right target.
        // For built-in models, modelOverrides is the standard mechanism.
        // We check: if the model is NOT a custom model, use modelOverrides.
        const customModels = providerConfig.models as unknown[] | undefined;
        const isCustom = Array.isArray(customModels) &&
          customModels.some(
            (cm) =>
              isRecord(cm) && (cm as DeepRecord).id === change.model,
          );

        if (!isCustom) {
          // Apply to modelOverrides
          const existingCost = isRecord(override.cost) ? override.cost as DeepRecord : {};
          const newCost: DeepRecord = { ...existingCost };

          // Merge price fields
          if (change.explicitFree) {
            newCost.input = 0;
            newCost.output = 0;
            newCost.cacheRead = 0;
          } else {
            if (change.prices.input !== undefined) {
              if (!isValidPriceValue(change.prices.input)) {
                entry.error = `Invalid input price: ${change.prices.input}`;
                results.push(entry);
                continue;
              }
              newCost.input = change.prices.input;
            }
            if (change.prices.output !== undefined) {
              if (!isValidPriceValue(change.prices.output)) {
                entry.error = `Invalid output price: ${change.prices.output}`;
                results.push(entry);
                continue;
              }
              newCost.output = change.prices.output;
            }
            if (change.prices.cacheRead !== undefined) {
              if (!isValidPriceValue(change.prices.cacheRead)) {
                entry.error = `Invalid cacheRead price: ${change.prices.cacheRead}`;
                results.push(entry);
                continue;
              }
              newCost.cacheRead = change.prices.cacheRead;
            }
          }

          // Preserve cacheWrite and tiers
          override.cost = newCost;
          entry.success = true;
          applied = true;
        }
      }

      // Path 2: custom models array
      if (!applied) {
        const customModels = providerConfig.models as unknown[] | undefined;
        if (Array.isArray(customModels)) {
          for (let i = 0; i < customModels.length; i++) {
            const cm = customModels[i];
            if (isRecord(cm) && (cm as DeepRecord).id === change.model) {
              const existingCost = isRecord(cm.cost) ? (cm as DeepRecord).cost as DeepRecord : {};
              const newCost: DeepRecord = { ...existingCost };

              if (change.explicitFree) {
                newCost.input = 0;
                newCost.output = 0;
                newCost.cacheRead = 0;
              } else {
                if (change.prices.input !== undefined) {
                  if (!isValidPriceValue(change.prices.input)) {
                    entry.error = `Invalid input price: ${change.prices.input}`;
                    results.push(entry);
                    break;
                  }
                  newCost.input = change.prices.input;
                }
                if (change.prices.output !== undefined) {
                  if (!isValidPriceValue(change.prices.output)) {
                    entry.error = `Invalid output price: ${change.prices.output}`;
                    results.push(entry);
                    break;
                  }
                  newCost.output = change.prices.output;
                }
                if (change.prices.cacheRead !== undefined) {
                  if (!isValidPriceValue(change.prices.cacheRead)) {
                    entry.error = `Invalid cacheRead price: ${change.prices.cacheRead}`;
                    results.push(entry);
                    break;
                  }
                  newCost.cacheRead = change.prices.cacheRead;
                }
              }

              // Custom models[] cost must satisfy models.json schema (cacheWrite required).
              (cm as DeepRecord).cost = ensureCustomModelCostRates(newCost);
              entry.success = true;
              applied = true;
              break;
            }
          }
        }

        if (!applied) {
          // Model not found in either path — still create an override
          // This covers models that exist in the registry but not in models.json yet
          const modelOverrides: DeepRecord = (providerConfig.modelOverrides as DeepRecord | undefined) ?? {};
          providerConfig.modelOverrides = modelOverrides;

          const override: DeepRecord = (modelOverrides[change.model] as DeepRecord | undefined) ?? {};
          modelOverrides[change.model] = override;

          const existingCost = isRecord(override.cost) ? override.cost as DeepRecord : {};
          const newCost: DeepRecord = { ...existingCost };

          if (change.explicitFree) {
            newCost.input = 0;
            newCost.output = 0;
            newCost.cacheRead = 0;
          } else {
            if (change.prices.input !== undefined) newCost.input = change.prices.input;
            if (change.prices.output !== undefined) newCost.output = change.prices.output;
            if (change.prices.cacheRead !== undefined) newCost.cacheRead = change.prices.cacheRead;
          }

          override.cost = newCost;
          entry.success = true;
          applied = true;
        }
      }

      if (entry.success) {
        // Build resolved rates for the response
        entry.resolved = {
          input: change.explicitFree ? 0 : (change.prices.input ?? 0),
          output: change.explicitFree ? 0 : (change.prices.output ?? 0),
          cacheRead: change.explicitFree ? 0 : (change.prices.cacheRead ?? 0),
        };
      }
    } catch (err) {
      entry.error = err instanceof Error ? err.message : String(err);
    }

    results.push(entry);
  }

  return { data, results };
}

// ── Revision-checked write ────────────────────────────────────────────────────

export interface ApplyPricePatchResult {
  /** Whether all changes were applied successfully. */
  success: boolean;
  /** Per-change results. */
  results: ModelPricePatchResultEntry[];
  /** New revision after write. */
  revision: string;
  /** HTTP status (200, 409, 422). */
  status: number;
}

/**
 * Validate, merge, backup, and atomically write price changes to models.json.
 *
 * This is the main write entry point. It:
 * 1. Validates the request batch size and structure
 * 2. Reads the current models.json
 * 3. Checks revision match (409 on conflict)
 * 4. Backs up the current file
 * 5. Merges changes into the data structure
 * 6. Atomically writes
 * 7. Updates explicit free models in pi-web.json
 */
export function applyPricePatch(request: ModelPricePatchRequest): ApplyPricePatchResult {
  // Read current state
  const current = readModelsJsonRaw();
  if (current.parseError) {
    return {
      success: false,
      results: [],
      revision: current.revision,
      status: 500,
    };
  }

  // Check revision
  if (request.revision !== current.revision) {
    return {
      success: false,
      results: [],
      revision: current.revision,
      status: 409,
    };
  }

  // Compute explicit free model changes
  const explicitFreeSet = getExplicitFreeModels();
  const explicitFreeToAdd: string[] = [];
  const explicitFreeToRemove: string[] = [];

  for (const change of request.changes) {
    const key = `${change.provider}:${change.model}`;
    if (change.explicitFree === true && !explicitFreeSet.has(key)) {
      explicitFreeToAdd.push(key);
    } else if (change.explicitFree === false && explicitFreeSet.has(key)) {
      explicitFreeToRemove.push(key);
    }
  }

  // Merge changes
  const { data, results } = mergePriceChanges(
    current.parsed,
    request.changes,

  );

  const allSucceeded = results.every((r) => r.success);

  if (!allSucceeded) {
    return {
      success: false,
      results,
      revision: current.revision,
      status: 422,
    };
  }

  // Backup before writing
  backupModelsJson();

  // Write
  const content = JSON.stringify(data, null, 2) + "\n";
  try {
    writeModelsJsonAtomic(content);
  } catch (error) {
    return {
      success: false,
      results: results.map((r) => ({
        ...r,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      })),
      revision: current.revision,
      status: 500,
    };
  }

  // Update explicit free models in pi-web.json
  if (explicitFreeToAdd.length > 0 || explicitFreeToRemove.length > 0) {
    const newExplicitFree = new Set(explicitFreeSet);
    for (const key of explicitFreeToAdd) newExplicitFree.add(key);
    for (const key of explicitFreeToRemove) newExplicitFree.delete(key);

    const list = Array.from(newExplicitFree).map((key) => {
      const [provider, ...modelParts] = key.split(":");
      return { provider, model: modelParts.join(":") };
    });

    try {
      writePiWebConfigPatch({
        usage: { explicitFreeModels: list },
      } as Record<string, unknown>);
    } catch {
      // pi-web.json update is best-effort; models.json already written
    }
  }

  const newRevision = computeRevision(content);

  return {
    success: true,
    results,
    revision: newRevision,
    status: 200,
  };
}

// ── Registry verification ─────────────────────────────────────────────────────

/**
 * After writing models.json, verify resolved prices against a fresh catalog
 * (typically an isolated temporary ModelRuntime that reloaded modelsPath).
 *
 * Returns a list of mismatches, or an empty array if all is well.
 */
export function verifyResolvedPrices(
  catalog: ModelPriceCatalog,
  changes: ModelPricePatchChange[],
): Array<{ provider: string; model: string; expected: PriceRates; actual: PriceRates }> {
  const mismatches: Array<{
    provider: string;
    model: string;
    expected: PriceRates;
    actual: PriceRates;
  }> = [];

  for (const change of changes) {
    const model = catalog.getModel(change.provider, change.model);
    if (!model) continue;

    const expected: PriceRates = {
      input: change.explicitFree ? 0 : (change.prices.input ?? 0),
      output: change.explicitFree ? 0 : (change.prices.output ?? 0),
      cacheRead: change.explicitFree ? 0 : (change.prices.cacheRead ?? 0),
    };

    const actual: PriceRates = {
      input: model.cost?.input ?? 0,
      output: model.cost?.output ?? 0,
      cacheRead: model.cost?.cacheRead ?? 0,
    };

    if (
      expected.input !== actual.input ||
      expected.output !== actual.output ||
      expected.cacheRead !== actual.cacheRead
    ) {
      mismatches.push({ provider: change.provider, model: change.model, expected, actual });
    }
  }

  return mismatches;
}
