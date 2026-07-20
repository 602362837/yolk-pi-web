/**
 * Pure helpers for chat model pin/display (IMP-002 MODEL-PIN-1/2/3/4 · MODEL-PIN-CS).
 *
 * UI selection must match the live agent model before prompt/steer.
 * After a turn, the selector must prefer live/explicit selection over
 * path context.model (which can follow the last assistant message).
 * These helpers stay free of React/fetch so scripts can unit-test rules.
 *
 * Key invariants:
 * - lastPinned / confirmed must NOT come from path context.model alone.
 * - Server cold-start default priority: session recoverable > yolk specific > settings/SDK.
 * - Chat set_model is session-scoped (MODEL-PIN-3); yolk cold-start apply must also
 *   use withSessionScopedSettingsDefaults.
 */

export type SessionModelRef = {
  provider: string;
  modelId: string;
};

/**
 * Normalize model refs from path context ({ provider, modelId }) or
 * live get_state ({ provider, id }).
 */
export function normalizeSessionModelRef(
  input:
    | { provider?: string | null; modelId?: string | null; id?: string | null }
    | null
    | undefined,
): SessionModelRef | null {
  if (!input?.provider) return null;
  const modelId = input.modelId ?? input.id ?? null;
  if (!modelId) return null;
  return { provider: input.provider, modelId };
}

export function sessionModelsEqual(
  a: SessionModelRef | null | undefined,
  b: SessionModelRef | null | undefined,
): boolean {
  if (!a || !b) return false;
  return a.provider === b.provider && a.modelId === b.modelId;
}

/**
 * Desired model for pin: explicit UI override / new-session selection first,
 * then pending create selection, then live agent model, then path context.model.
 */
export function resolveDesiredSessionModel(sources: {
  override?: SessionModelRef | null;
  newSession?: SessionModelRef | null;
  pending?: SessionModelRef | null;
  live?: SessionModelRef | null;
  context?: SessionModelRef | null;
}): SessionModelRef | null {
  return (
    sources.override
    ?? sources.newSession
    ?? sources.pending
    ?? sources.live
    ?? sources.context
    ?? null
  );
}

/**
 * Chat selector display priority (existing session):
 * explicit override → pending UI → live get_state.model → path context.model.
 * Never let assistant history alone clobber a live/explicit selection.
 */
export function resolveChatDisplayModel(sources: {
  override?: SessionModelRef | null;
  pending?: SessionModelRef | null;
  live?: SessionModelRef | null;
  context?: SessionModelRef | null;
}): SessionModelRef | null {
  return (
    sources.override
    ?? sources.pending
    ?? sources.live
    ?? sources.context
    ?? null
  );
}

/**
 * Call set_model when UI has a desired model that is not yet confirmed pinned.
 * If desired is null, there is nothing to pin (agent keeps its current model).
 *
 * When `options.liveConfirmed === false` the live agent has not confirmed any model
 * (cold start, idle destroy, etc.).  In that case any valid desired model must be
 * pinned, even if lastPinned happens to equal it (e.g. stale from a previous live
 * session).  This prevents cold-start sends from falling through to the SDK/settings
 * default without a set_model.
 *
 * Omitting `options` keeps the pre-CS equal-comparison behaviour for callers that
 * have not yet adopted liveConfirmed tracking.
 */
export function shouldPinSessionModel(
  desired: SessionModelRef | null | undefined,
  lastPinned: SessionModelRef | null | undefined,
  options?: { liveConfirmed?: boolean },
): desired is SessionModelRef {
  if (!desired?.provider || !desired?.modelId) return false;
  if (options && options.liveConfirmed === false) return true;
  return !sessionModelsEqual(desired, lastPinned);
}

const THINKING_LEVEL_ORDER = ["auto", "off", "minimal", "low", "medium", "high", "xhigh"] as const;

/**
 * Clamp a thinking level to the levels supported by the selected model.
 * Preference: keep current when supported → medium → auto → first supported.
 * When supported is empty/unknown, keep current unchanged.
 */
export function clampThinkingLevelToSupported<
  T extends string = string,
>(current: T, supported: readonly string[] | null | undefined): T {
  if (!supported || supported.length === 0) return current;
  if (supported.includes(current)) return current;
  for (const preferred of ["medium", "auto"] as const) {
    if (supported.includes(preferred)) return preferred as T;
  }
  // Prefer the closest lower known level still in the supported set.
  const currentIdx = THINKING_LEVEL_ORDER.indexOf(current as (typeof THINKING_LEVEL_ORDER)[number]);
  if (currentIdx >= 0) {
    for (let i = currentIdx - 1; i >= 0; i -= 1) {
      const candidate = THINKING_LEVEL_ORDER[i];
      if (supported.includes(candidate)) return candidate as T;
    }
    for (let i = currentIdx + 1; i < THINKING_LEVEL_ORDER.length; i += 1) {
      const candidate = THINKING_LEVEL_ORDER[i];
      if (supported.includes(candidate)) return candidate as T;
    }
  }
  return supported[0] as T;
}

/**
 * Result of resolveYolkColdStartModel: the yolk-specific model + thinking
 * to use as the server cold-start fallback, or null when the user has chosen
 * "follow Pi default" (mode !== "specific") or the config is incomplete.
 */
export type YolkColdStartModel = {
  provider: string;
  modelId: string;
  thinking?: string;
} | null;

/**
 * Parse yolk.defaultModel into a cold-start fallback model.
 *
 * Returns null when:
 * - yolkConfig is missing / defaultModel is missing
 * - defaultModel.mode is not "specific" (i.e. "piDefault" → caller should fall through to SDK/settings)
 * - provider or modelId are empty
 *
 * thinking is taken from defaultModel.thinking first, falling back to
 * defaultThinkingLevel (the legacy top-level field).
 */
export function resolveYolkColdStartModel(yolkConfig: {
  defaultModel?: { mode?: string; provider?: string; modelId?: string; thinking?: string } | null;
  defaultThinkingLevel?: string;
} | null | undefined): YolkColdStartModel {
  const dm = yolkConfig?.defaultModel;
  if (!dm || dm.mode !== "specific") return null;
  const provider = dm.provider?.trim();
  const modelId = dm.modelId?.trim();
  if (!provider || !modelId) return null;
  return {
    provider,
    modelId,
    thinking: dm.thinking ?? yolkConfig?.defaultThinkingLevel,
  };
}

export type ColdStartModelPreference = "recoverable" | "yolk" | "sdk";

/**
 * Pure priority rule for server cold-start model selection.
 *
 *   1. session recoverable model (path/JSONL with valid auth) → "recoverable"
 *   2. yolk specific model (resolveYolkColdStartModel returned non-null) → "yolk"
 *   3. SDK / settings default → "sdk"
 *
 * This is a pure function so it can be unit-tested without touching
 * SDK runtime, SettingsManager, or model auth lookups.
 */
export function resolveColdStartModelPreference(params: {
  recoverable: boolean;
  yolk: boolean;
}): ColdStartModelPreference {
  if (params.recoverable) return "recoverable";
  if (params.yolk) return "yolk";
  return "sdk";
}

/**
 * SettingsManager surface used by Chat set_model isolation (IMP-002 MODEL-PIN-3).
 * Keep the thinking setter param as `any` so SDK `ThinkingLevel` methods are assignable
 * under strictFunctionTypes without importing pi-coding-agent types into this pure helper.
 */
export type SessionScopedSettingsManager = {
  setDefaultModelAndProvider: (provider: string, modelId: string) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK ThinkingLevel union
  setDefaultThinkingLevel?: (level: any) => void;
};

type SettingsDefaultPatch = {
  depth: number;
  setDefaultModelAndProvider: SessionScopedSettingsManager["setDefaultModelAndProvider"];
  setDefaultThinkingLevel?: SessionScopedSettingsManager["setDefaultThinkingLevel"];
};

/** Refcount patches for shared SettingsManager instances across concurrent set_model. */
const settingsDefaultPatches = new WeakMap<object, SettingsDefaultPatch>();

/**
 * Run an action without writing global settings.json model/thinking defaults.
 *
 * Pi SDK AgentSession.setModel() always calls setDefaultModelAndProvider and may
 * re-clamp thinking via setDefaultThinkingLevel. Chat model switches are
 * session-scoped (plan A): keep runtime model + JSONL model_change, but do not
 * pollute ~/.pi/agent/settings.json. Nested/concurrent callers on the same
 * manager are refcounted so originals are restored only when the outer scope exits.
 */
export async function withSessionScopedSettingsDefaults<T>(
  settingsManager: SessionScopedSettingsManager,
  action: () => Promise<T>,
): Promise<T> {
  const key = settingsManager as object;
  let patch = settingsDefaultPatches.get(key);
  if (!patch) {
    patch = {
      depth: 0,
      setDefaultModelAndProvider: settingsManager.setDefaultModelAndProvider.bind(settingsManager),
      setDefaultThinkingLevel:
        typeof settingsManager.setDefaultThinkingLevel === "function"
          ? settingsManager.setDefaultThinkingLevel.bind(settingsManager)
          : undefined,
    };
    settingsManager.setDefaultModelAndProvider = () => {
      /* session-scoped: skip global defaultProvider/defaultModel write */
    };
    if (patch.setDefaultThinkingLevel) {
      settingsManager.setDefaultThinkingLevel = () => {
        /* session-scoped: skip incidental defaultThinkingLevel write from setModel re-clamp */
      };
    }
    settingsDefaultPatches.set(key, patch);
  }
  patch.depth += 1;
  try {
    return await action();
  } finally {
    patch.depth -= 1;
    if (patch.depth <= 0) {
      settingsManager.setDefaultModelAndProvider = patch.setDefaultModelAndProvider;
      if (patch.setDefaultThinkingLevel) {
        settingsManager.setDefaultThinkingLevel = patch.setDefaultThinkingLevel;
      }
      settingsDefaultPatches.delete(key);
    }
  }
}
