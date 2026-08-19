/**
 * Models.json runtime helpers for candidate semantic verification.
 *
 * Direct PUT must prove a normalized candidate can be composed by Pi before any
 * durable write. Verification uses a private temporary modelsPath and never
 * requires auth availability (loaded-but-unavailable is a valid save).
 *
 * Security contract:
 * - Temp dir/file are private (0700/0600) and always cleaned up.
 * - Failures throw a fixed public error; never leak SDK text, paths, keys,
 *   baseUrl, headers, or config bodies.
 * - Initial ModelRuntime load stays offline (no model endpoint calls).
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTemporaryWebModelRuntimeServices } from "@/lib/web-model-runtime";

export {
  notifyModelsConfigCommitted,
  type ModelsConfigCommitLiveSummary,
  type ModelsConfigCommitNotification,
  type ModelsConfigCommitReason,
} from "@/lib/models-config-commit";

const TEMP_DIR_MODE = 0o700;
const TEMP_FILE_MODE = 0o600;

export class ModelsConfigCandidateInvalidError extends Error {
  readonly code = "models_config_invalid" as const;

  constructor() {
    super("Model configuration is invalid");
    this.name = "ModelsConfigCandidateInvalidError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectExpectedModels(
  candidate: Record<string, unknown>,
): Array<{ providerId: string; modelId: string }> {
  const providers = candidate.providers;
  if (!isRecord(providers)) return [];

  const expected: Array<{ providerId: string; modelId: string }> = [];
  for (const [providerId, providerValue] of Object.entries(providers)) {
    if (!isRecord(providerValue) || !Array.isArray(providerValue.models)) continue;
    for (const model of providerValue.models) {
      if (!isRecord(model)) continue;
      const modelId = typeof model.id === "string" ? model.id.trim() : "";
      // Empty / whitespace ids are schema failures (runtime.getError). Skip the
      // presence walk so we do not invent availability requirements.
      if (!modelId) continue;
      expected.push({ providerId, modelId });
    }
  }
  return expected;
}

/**
 * Offline Pi composition check for a normalized models.json candidate.
 * Throws ModelsConfigCandidateInvalidError on any semantic failure.
 */
export async function verifyWebModelsConfigCandidate(options: {
  candidate: Record<string, unknown>;
  /** Optional agentDir for credential/fixed-provider context. Defaults to the private temp dir. */
  agentDir?: string;
}): Promise<void> {
  let tempDir: string | undefined;
  try {
    tempDir = await mkdtemp(join(tmpdir(), "ypi-models-candidate-"));
    // mkdtemp is already private on most platforms; reinforce for shared temp roots.
    try {
      const { chmod } = await import("node:fs/promises");
      await chmod(tempDir, TEMP_DIR_MODE);
    } catch {
      // Best-effort only; verification must still proceed.
    }

    const modelsPath = join(tempDir, "models.json");
    await writeFile(modelsPath, `${JSON.stringify(options.candidate)}\n`, {
      mode: TEMP_FILE_MODE,
      encoding: "utf8",
    });

    const agentDir = options.agentDir && options.agentDir.length > 0 ? options.agentDir : tempDir;
    let runtime;
    try {
      const services = await createTemporaryWebModelRuntimeServices({
        cwd: tempDir,
        agentDir,
        modelsPath,
      });
      runtime = services.modelRuntime;
    } catch {
      throw new ModelsConfigCandidateInvalidError();
    }

    const loadError = runtime.getError();
    if (typeof loadError === "string" && loadError.length > 0) {
      throw new ModelsConfigCandidateInvalidError();
    }

    for (const { providerId, modelId } of collectExpectedModels(options.candidate)) {
      let model: unknown;
      try {
        model = runtime.getModel(providerId, modelId);
      } catch {
        throw new ModelsConfigCandidateInvalidError();
      }
      if (!model) {
        throw new ModelsConfigCandidateInvalidError();
      }
    }
  } catch (error) {
    if (error instanceof ModelsConfigCandidateInvalidError) throw error;
    throw new ModelsConfigCandidateInvalidError();
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
