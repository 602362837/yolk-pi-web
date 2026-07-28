/**
 * github-automation-handler-runtime — single process-global readiness boundary
 * for the durable GitHub automation job handler (GHR-01).
 *
 * Authority:
 * - Scheduler registry kind + generation is the live truth.
 * - Module-private booleans (webhook runtime) are NOT trusted after HMR/reset.
 *
 * Entry points that process business jobs must call
 * `ensureGithubAutomationJobHandlerReady()` before lease/attempt:
 * webhook accept, Settings retry/resume, ensure/wake, and tick itself.
 *
 * Failure is always `handler_not_ready` with allowlisted stage/retryability.
 * Never returns module specifier, absolute path, stack, or secret material.
 */

import {
  getGithubAutomationJobHandlerRegistration,
  setGithubAutomationJobHandler,
  type GithubAutomationHandlerKind,
  type GithubAutomationHandlerRegistration,
  type GithubAutomationJobHandler,
} from "./github-automation-scheduler";
import { getGithubAutomationProcessEpoch } from "./github-automation-store";

export type GithubAutomationHandlerReadyStage =
  | "load"
  | "register"
  | "verify";

export type GithubAutomationHandlerRuntimeState =
  | {
      kind: "ready";
      handlerKind: "github_issue_triage";
      generation: number;
    }
  | {
      kind: "not_ready";
      reasonCode: "handler_not_ready";
      stage: GithubAutomationHandlerReadyStage;
      retryability: "automatic" | "operator";
      diagnosticCode: string;
    };

/** Resolved triage-runner surface used by the readiness loader. */
export interface GithubAutomationTriageRunnerModuleExports {
  githubIssueTriageJobHandler?: GithubAutomationJobHandler;
  registerGithubIssueTriageHandler?: () => void;
  default?: unknown;
  [key: string]: unknown;
}

export type GithubAutomationTriageRunnerModuleLoader =
  () => Promise<GithubAutomationTriageRunnerModuleExports | null | undefined>;

export interface EnsureGithubAutomationJobHandlerReadyOptions {
  /**
   * Test-only: skip dynamic import of triage runner and register whatever is
   * already present (or leave not_ready). Production always loads the full
   * triage/unattended handler.
   */
  skipAutoRegister?: boolean;
  /**
   * Test-only fault injection stage. Production never sets this.
   */
  _testForceStageFailure?: GithubAutomationHandlerReadyStage | null;
  /**
   * Test-only module loader override. Production never sets this.
   * Used to simulate webpack async-module / register-only export shapes.
   */
  _testModuleLoader?: GithubAutomationTriageRunnerModuleLoader | null;
}

const EXPECTED_HANDLER_KIND: GithubAutomationHandlerKind = "github_issue_triage";

/** Bounded backoff after a failed ensure so we do not spin timers/events. */
const READY_FAILURE_BACKOFF_MS = 5_000;
const READY_EVENT_DEDUPE_MS = 30_000;

interface HandlerRuntimeControlState {
  inFlight: Promise<GithubAutomationHandlerRuntimeState> | null;
  lastFailureAtMs: number;
  lastFailureState: Extract<
    GithubAutomationHandlerRuntimeState,
    { kind: "not_ready" }
  > | null;
  lastEventKey: string | null;
  lastEventAtMs: number;
  /** When true, production auto-load is disabled (GHA-02 isolation tests). */
  autoRegisterDisabled: boolean;
  /** Test fault injection. */
  forceStageFailure: GithubAutomationHandlerReadyStage | null;
  /** Test-only loader override for async-module / interop regression. */
  testModuleLoader: GithubAutomationTriageRunnerModuleLoader | null;
}

declare global {
  var __piGithubAutomationHandlerRuntime: HandlerRuntimeControlState | undefined;
}

function getControlState(): HandlerRuntimeControlState {
  if (!globalThis.__piGithubAutomationHandlerRuntime) {
    globalThis.__piGithubAutomationHandlerRuntime = {
      inFlight: null,
      lastFailureAtMs: 0,
      lastFailureState: null,
      lastEventKey: null,
      lastEventAtMs: 0,
      autoRegisterDisabled: false,
      forceStageFailure: null,
      testModuleLoader: null,
    };
  }
  return globalThis.__piGithubAutomationHandlerRuntime;
}

function isThenable<T = unknown>(value: unknown): value is PromiseLike<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as PromiseLike<T>).then === "function"
  );
}

async function awaitIfThenable<T>(value: T | PromiseLike<T>): Promise<T> {
  if (isThenable<T>(value)) {
    return await value;
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

/**
 * Resolve a named export from a CJS/ESM/webpack namespace, including default
 * interop and thenable export values. Never throws; returns null when the
 * export is not a function after settlement.
 */
async function resolveNamedFunctionExport(
  mod: unknown,
  exportName: string,
): Promise<((...args: never[]) => unknown) | null> {
  const root = asRecord(mod);
  if (!root) return null;

  const candidates: unknown[] = [];

  try {
    candidates.push(root[exportName]);
  } catch {
    // ignore getter failures
  }

  // Some interop shapes expose functions only via getters after namespace settle.
  try {
    const desc = Object.getOwnPropertyDescriptor(root, exportName);
    if (desc) {
      candidates.push(
        typeof desc.get === "function" ? desc.get.call(root) : desc.value,
      );
    }
  } catch {
    // ignore getter failures; fall through to default interop
  }

  try {
    const defaultNs = asRecord(root.default);
    if (defaultNs) {
      candidates.push(defaultNs[exportName]);
      // default itself may be the handler in rare interop shapes
      if (exportName === "githubIssueTriageJobHandler") {
        candidates.push(root.default);
      }
    }
  } catch {
    // ignore
  }

  for (const candidate of candidates) {
    try {
      const settled = await awaitIfThenable(candidate);
      if (typeof settled === "function") {
        return settled as (...args: never[]) => unknown;
      }
    } catch {
      // ignore individual export settlement failures
    }
  }

  return null;
}

/**
 * Load the triage runner module in a way that fully settles webpack async
 * modules (Next server chunks use `c.a(...)` factories). Prefer dynamic
 * import, and always await thenables returned by require/import.
 *
 * Never includes module specifier/path/stack in thrown errors consumed by
 * callers — callers map any failure to allowlisted diagnostic codes only.
 */
async function loadGithubIssueTriageRunnerModule(
  loaderOverride?: GithubAutomationTriageRunnerModuleLoader | null,
): Promise<GithubAutomationTriageRunnerModuleExports> {
  if (typeof loaderOverride === "function") {
    const loaded = await loaderOverride();
    if (!loaded || typeof loaded !== "object") {
      throw new Error("handler_module_export_missing");
    }
    return (await awaitIfThenable(loaded)) as GithubAutomationTriageRunnerModuleExports;
  }

  let lastError: unknown = null;

  // 1) Dynamic import first — native path for webpack async modules / ESM.
  try {
    const imported = await import("./github-issue-triage-runner");
    const settled = await awaitIfThenable(imported);
    if (settled && typeof settled === "object") {
      return settled as GithubAutomationTriageRunnerModuleExports;
    }
  } catch (err) {
    lastError = err;
  }

  // 2) require + await-thenable — jiti/CJS and some Next interop shapes.
  //    Important: webpack async modules often do NOT throw on require; they
  //    return a thenable namespace that must be awaited before exports exist.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const required = require("./github-issue-triage-runner") as unknown;
    const settled = await awaitIfThenable(required);
    if (settled && typeof settled === "object") {
      return settled as GithubAutomationTriageRunnerModuleExports;
    }
  } catch (err) {
    lastError = err;
  }

  if (lastError) {
    throw lastError;
  }
  throw new Error("handler_module_export_missing");
}

/**
 * From a settled module namespace, obtain the full triage job handler.
 * Prefers the direct handler export; falls back to calling
 * `registerGithubIssueTriageHandler()` and reading the live registry.
 *
 * Returns:
 * - `{ handler, registeredViaModule }` when a callable handler is available
 * - `{ handler: null, registeredViaModule: true }` when register() already
 *   stamped the live registry with kind=`github_issue_triage` (caller skips re-set)
 * - null when neither path works
 */
async function resolveTriageJobHandlerFromModule(
  mod: GithubAutomationTriageRunnerModuleExports,
): Promise<{
  handler: GithubAutomationJobHandler | null;
  registeredViaModule: boolean;
} | null> {
  const direct = await resolveNamedFunctionExport(
    mod,
    "githubIssueTriageJobHandler",
  );
  if (direct) {
    return {
      handler: direct as GithubAutomationJobHandler,
      registeredViaModule: false,
    };
  }

  const register = await resolveNamedFunctionExport(
    mod,
    "registerGithubIssueTriageHandler",
  );
  if (!register) {
    return null;
  }

  try {
    (register as () => void)();
  } catch {
    return null;
  }

  const reg = getGithubAutomationJobHandlerRegistration();
  if (!isFullTriageRegistration(reg)) {
    return null;
  }

  // Prefer the live registry handler (authoritative after register()).
  // Fall back to re-resolving the export in case getters became live.
  const liveHandler = reg.handler;
  if (typeof liveHandler === "function") {
    return { handler: liveHandler, registeredViaModule: true };
  }

  const after = await resolveNamedFunctionExport(
    mod,
    "githubIssueTriageJobHandler",
  );
  if (after) {
    return {
      handler: after as GithubAutomationJobHandler,
      registeredViaModule: true,
    };
  }

  // Registry kind is correct even if we cannot re-materialize a local ref;
  // ensure path will treat registeredViaModule as success after verify.
  return { handler: null, registeredViaModule: true };
}

function isFullTriageRegistration(
  reg: GithubAutomationHandlerRegistration,
): reg is Extract<GithubAutomationHandlerRegistration, { kind: "github_issue_triage" }> {
  return reg.kind === "github_issue_triage" && typeof reg.generation === "number";
}

function notReady(
  stage: GithubAutomationHandlerReadyStage,
  retryability: "automatic" | "operator",
  diagnosticCode: string,
): Extract<GithubAutomationHandlerRuntimeState, { kind: "not_ready" }> {
  return {
    kind: "not_ready",
    reasonCode: "handler_not_ready",
    stage,
    retryability,
    diagnosticCode,
  };
}

function readyFromRegistration(
  reg: Extract<GithubAutomationHandlerRegistration, { kind: "github_issue_triage" }>,
): Extract<GithubAutomationHandlerRuntimeState, { kind: "ready" }> {
  return {
    kind: "ready",
    handlerKind: "github_issue_triage",
    generation: reg.generation,
  };
}

/**
 * Synchronous registry snapshot. Does not load modules.
 * Prefer `ensureGithubAutomationJobHandlerReady()` for execution paths.
 */
export function getGithubAutomationHandlerRuntimeState(): GithubAutomationHandlerRuntimeState {
  const reg = getGithubAutomationJobHandlerRegistration();
  if (isFullTriageRegistration(reg)) {
    return readyFromRegistration(reg);
  }
  return notReady("verify", "automatic", "handler_registry_not_triage");
}

/**
 * Whether the live scheduler registry currently holds the full triage handler.
 * Does not attempt registration.
 */
export function isGithubAutomationJobHandlerReady(): boolean {
  return getGithubAutomationHandlerRuntimeState().kind === "ready";
}

/**
 * Process-global single-flight readiness ensure.
 * - Verifies live registry kind/generation (survives HMR when registry is reset).
 * - Dynamically imports triage runner only when needed (cycle-safe).
 * - Failed ensures are not permanently cached; capped backoff applies.
 */
export async function ensureGithubAutomationJobHandlerReady(
  options: EnsureGithubAutomationJobHandlerReadyOptions = {},
): Promise<GithubAutomationHandlerRuntimeState> {
  const control = getControlState();
  if (options.skipAutoRegister === true) {
    control.autoRegisterDisabled = true;
  }
  if (options._testForceStageFailure !== undefined) {
    control.forceStageFailure = options._testForceStageFailure;
  }
  if (options._testModuleLoader !== undefined) {
    control.testModuleLoader = options._testModuleLoader;
  }

  // Fast path: live registry already has full triage handler.
  const current = getGithubAutomationJobHandlerRegistration();
  if (isFullTriageRegistration(current) && !control.forceStageFailure) {
    control.lastFailureState = null;
    control.lastFailureAtMs = 0;
    return readyFromRegistration(current);
  }

  // Explicit isolation mode: do not load full handler (default-handler tests).
  if (control.autoRegisterDisabled || options.skipAutoRegister) {
    if (control.forceStageFailure) {
      return rememberFailure(
        notReady(control.forceStageFailure, "automatic", `test_force_${control.forceStageFailure}`),
      );
    }
    return rememberFailure(
      notReady("register", "operator", "handler_auto_register_disabled"),
    );
  }

  // Capped backoff after recent failure (same process).
  if (
    control.lastFailureState &&
    control.lastFailureAtMs > 0 &&
    Date.now() - control.lastFailureAtMs < READY_FAILURE_BACKOFF_MS &&
    !control.forceStageFailure
  ) {
    return control.lastFailureState;
  }

  if (control.inFlight) {
    return control.inFlight;
  }

  control.inFlight = (async () => {
    try {
      if (control.forceStageFailure === "load") {
        return rememberFailure(
          notReady("load", "automatic", "handler_load_forced_failure"),
        );
      }

      // Load triage handler without a static import cycle.
      // Production Next server chunks compile the triage runner as a webpack
      // *async module* (`c.a(...)`). A plain require() does not throw and may
      // return a thenable/incomplete namespace where exports are not yet
      // functions — that previously became handler_module_export_missing.
      // Always settle thenables and accept register()-then-verify as a path.
      let triageHandler: GithubAutomationJobHandler | null = null;
      let alreadyRegisteredViaModule = false;
      try {
        const mod = await loadGithubIssueTriageRunnerModule(
          control.testModuleLoader,
        );
        const resolved = await resolveTriageJobHandlerFromModule(mod);
        if (!resolved) {
          return rememberFailure(
            notReady("load", "operator", "handler_module_export_missing"),
          );
        }
        triageHandler = resolved.handler;
        alreadyRegisteredViaModule = resolved.registeredViaModule;
        if (!triageHandler && !alreadyRegisteredViaModule) {
          return rememberFailure(
            notReady("load", "operator", "handler_module_export_missing"),
          );
        }
      } catch {
        // Never surface specifier/path/stack.
        return rememberFailure(
          notReady("load", "operator", "handler_module_load_failed"),
        );
      }

      if (control.forceStageFailure === "register") {
        return rememberFailure(
          notReady("register", "automatic", "handler_register_forced_failure"),
        );
      }

      if (!alreadyRegisteredViaModule) {
        if (!triageHandler) {
          return rememberFailure(
            notReady("load", "operator", "handler_module_export_missing"),
          );
        }
        try {
          // Single authority: register with explicit production kind on the live registry.
          setGithubAutomationJobHandler(triageHandler, {
            kind: "github_issue_triage",
          });
        } catch {
          return rememberFailure(
            notReady("register", "automatic", "handler_register_failed"),
          );
        }
      }

      if (control.forceStageFailure === "verify") {
        return rememberFailure(
          notReady("verify", "automatic", "handler_verify_forced_failure"),
        );
      }

      const verified = getGithubAutomationJobHandlerRegistration();
      if (!isFullTriageRegistration(verified)) {
        return rememberFailure(
          notReady("verify", "automatic", "handler_verify_kind_mismatch"),
        );
      }

      control.lastFailureState = null;
      control.lastFailureAtMs = 0;
      return readyFromRegistration(verified);
    } finally {
      control.inFlight = null;
    }
  })();

  return control.inFlight;
}

function rememberFailure(
  state: Extract<GithubAutomationHandlerRuntimeState, { kind: "not_ready" }>,
): Extract<GithubAutomationHandlerRuntimeState, { kind: "not_ready" }> {
  const control = getControlState();
  control.lastFailureState = state;
  control.lastFailureAtMs = Date.now();
  return state;
}

/**
 * Build allowlisted safe event meta for handler_not_ready.
 * Never includes paths, module names, stacks, or secrets.
 */
export function buildGithubAutomationHandlerNotReadyEventMeta(
  state: Extract<GithubAutomationHandlerRuntimeState, { kind: "not_ready" }>,
): Record<string, string | number | boolean | null> {
  return {
    stage: state.stage,
    retryability: state.retryability,
    handlerKindExpected: EXPECTED_HANDLER_KIND,
    diagnosticCode: state.diagnosticCode,
    processEpoch: getGithubAutomationProcessEpoch(),
  };
}

/**
 * Event dedupe key for handler_not_ready emissions (processEpoch+stage+code).
 * Returns true when a new event should be appended.
 */
export function shouldEmitGithubAutomationHandlerNotReadyEvent(
  state: Extract<GithubAutomationHandlerRuntimeState, { kind: "not_ready" }>,
): boolean {
  const control = getControlState();
  const key = `${getGithubAutomationProcessEpoch()}|${state.stage}|${state.diagnosticCode}`;
  const now = Date.now();
  if (
    control.lastEventKey === key &&
    now - control.lastEventAtMs < READY_EVENT_DEDUPE_MS
  ) {
    return false;
  }
  control.lastEventKey = key;
  control.lastEventAtMs = now;
  return true;
}

/** Bounded delay suggestion after readiness failure (ms). */
export function getGithubAutomationHandlerNotReadyBackoffMs(
  state: Extract<GithubAutomationHandlerRuntimeState, { kind: "not_ready" }>,
): number {
  if (state.retryability === "operator") {
    // Operator fixes require process/bundle change; do not thrash.
    return Math.max(READY_FAILURE_BACKOFF_MS * 6, 30_000);
  }
  return READY_FAILURE_BACKOFF_MS;
}

// ─── Test helpers ────────────────────────────────────────────────────────────

/** Reset process-global readiness control (tests). Does not clear scheduler registry. */
export function _testResetGithubAutomationHandlerRuntime(): void {
  const control = getControlState();
  control.inFlight = null;
  control.lastFailureAtMs = 0;
  control.lastFailureState = null;
  control.lastEventKey = null;
  control.lastEventAtMs = 0;
  control.autoRegisterDisabled = false;
  control.forceStageFailure = null;
  control.testModuleLoader = null;
  globalThis.__piGithubAutomationHandlerRuntime = undefined;
}

/**
 * Test-only: override the triage-runner module loader (async-module interop).
 * Pass null to clear. Production never calls this.
 */
export function _testSetGithubAutomationHandlerModuleLoader(
  loader: GithubAutomationTriageRunnerModuleLoader | null,
): void {
  const control = getControlState();
  control.testModuleLoader = loader;
  control.inFlight = null;
  control.lastFailureState = null;
  control.lastFailureAtMs = 0;
}

/**
 * Disable production auto-load so GHA-02 default-handler tests stay isolated.
 * When disabled, ensure returns not_ready unless a full triage handler is
 * already registered in the scheduler registry.
 */
export function _testSetGithubAutomationHandlerAutoRegisterDisabled(
  disabled: boolean,
): void {
  const control = getControlState();
  control.autoRegisterDisabled = disabled;
  if (disabled) {
    control.inFlight = null;
    control.lastFailureState = null;
    control.lastFailureAtMs = 0;
  }
}

/** Inject a stage failure for the next ensure attempt(s). */
export function _testSetGithubAutomationHandlerForceStageFailure(
  stage: GithubAutomationHandlerReadyStage | null,
): void {
  const control = getControlState();
  control.forceStageFailure = stage;
  control.lastFailureState = null;
  control.lastFailureAtMs = 0;
  control.inFlight = null;
}
