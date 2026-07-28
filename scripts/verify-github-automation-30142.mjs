#!/usr/bin/env node
/**
 * verify-github-automation-30142 — operator-safe acceptance harness (GHR-04)
 *
 * Direct-port gate for GitHub automation manual-retry / Session-bootstrap recovery.
 * Default mode is READ-ONLY. Mutation (pause/retry/post-proof pause) requires an
 * explicit exact confirmation flag and never loops retries.
 *
 * Hard rules:
 * - Prefer http://localhost:30142 (or an explicit --base-url).
 * - Reject HTTP 301/302 redirects (never silently follow to another port/PID).
 * - Print only allowlisted safe evidence (no credentials, absolute paths,
 *   sessionFile, raw Issue/comment bodies, prompts, stacks, module specifiers).
 * - Success requires same-generation Session evidence; handler_not_ready,
 *   bootstrap failure, runner_no_progress, generic internal error, g2, or
 *   provenance mismatch FAIL the gate.
 *
 * This harness does NOT start ypi. Operator/GHR-06 must:
 *   npm run build
 *   # isolate other shared-agent-dir ypi schedulers
 *   node bin/pi-web.js --port 30142 --no-open
 *
 * Examples:
 *   node scripts/verify-github-automation-30142.mjs --help
 *   node scripts/verify-github-automation-30142.mjs --dry-run --job-id job_example
 *   node scripts/verify-github-automation-30142.mjs \
 *     --job-id job_1278854433_22_g1_01a6cdde --base-url http://localhost:30142
 *   node scripts/verify-github-automation-30142.mjs \
 *     --job-id job_1278854433_22_g1_01a6cdde --base-url http://localhost:30142 \
 *     --confirm-single-retry --pause-first --post-proof-pause
 */

import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_BASE_URL = "http://localhost:30142";
const DEFAULT_JOB_ID = "job_1278854433_22_g1_01a6cdde";
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_MS = 2_000;
const DEFAULT_STABLE_PAUSE_MS = 1_500;

const SUCCESS_SESSION = new Set(["active", "ended"]);
const FAIL_REASON_CODES = new Set([
  "handler_not_ready",
  "session_bootstrap_failed",
  "session_bootstrap_transient",
  "runner_no_progress",
]);
const FAIL_EVENT_KINDS = new Set([
  "github_automation_handler_not_ready",
  "unattended_session_bootstrap_failed",
  "job_no_progress_backoff",
]);
const REQUIRED_EVENT_KINDS = [
  "unattended_retry_wake",
  "job_started",
  "unattended_implementing",
  "unattended_session_created",
];

const PRIVACY_PATTERNS = [
  /-----BEGIN[ A-Z]*PRIVATE KEY-----/i,
  /gh[pousr]_[A-Za-z0-9_]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/,
  /Bearer\s+[A-Za-z0-9._\-+/=]{16,}/i,
  /\/Users\/[^\s"'`]+/,
  /\/Volumes\/[^\s"'`]+/,
  /\/home\/[^\s"'`]+/,
  /\/var\/folders\/[^\s"'`]+/,
  /sessionFile/i,
  /node_modules\/[^\s"'`]+/,
  /MODULE_NOT_FOUND/,
  /at\s+\S+\s+\([^)]+:\d+:\d+\)/,
];

const ALLOWLISTED_BOOTSTRAP_META_KEYS = new Set([
  "bootstrapCode",
  "stage",
  "retryable",
  "retryability",
  "message",
  "safeMessage",
  "diagnosticCode",
  "handlerKindExpected",
  "sessionIdShort",
  "hasSessionId",
  "hasProjectBinding",
  "hasSpaceBinding",
]);

// ─── CLI ─────────────────────────────────────────────────────────────────────

function printHelp() {
  const text = `
verify-github-automation-30142 — safe 30142 acceptance harness (GHR-04)

USAGE
  node scripts/verify-github-automation-30142.mjs [options]

MODES
  (default)            Read-only baseline: health, status provenance, job snapshot.
                       Never mutates a job.
  --dry-run            Self-test with an in-process mock server (no production job).
  --confirm-single-retry
                       Explicit mutation acknowledgement. Enables at most ONE retry
                       POST after optional pause. Never loops.

OPTIONS
  --base-url <url>     Default: ${DEFAULT_BASE_URL}
  --job-id <id>        Default: ${DEFAULT_JOB_ID}
  --timeout-ms <n>     Poll budget after retry (default ${DEFAULT_TIMEOUT_MS})
  --poll-ms <n>        Poll interval (default ${DEFAULT_POLL_MS})
  --pause-first        Before retry, POST pause once and wait for stable projection
  --post-proof-pause   After Session evidence, POST pause once (recommended)
  --require-session    Mutation mode always requires Session evidence (default on)
  --allow-observed-fail
                       Still exit non-zero, but print typed failure diagnostics
                       (handler/bootstrap) as observed-but-not-fixed
  --expected-generation <n>
                       Default: baseline generation (must stay same)
  --help, -h           Show this help

GHR-06 INVOCATION (real acceptance — NOT part of GHR-04)
  1) npm run build
  2) Isolate other shared-agent-dir ypi schedulers (lsof 30141/30142; stop old PID)
  3) PI_CODING_AGENT_DIR=... node bin/pi-web.js --port 30142 --no-open
  4) Read-only check:
       node scripts/verify-github-automation-30142.mjs \\
         --job-id job_1278854433_22_g1_01a6cdde \\
         --base-url http://localhost:30142
  5) Single retry + post-proof pause:
       node scripts/verify-github-automation-30142.mjs \\
         --job-id job_1278854433_22_g1_01a6cdde \\
         --base-url http://localhost:30142 \\
         --confirm-single-retry --pause-first --post-proof-pause

EXIT CODES
  0  PASS (read-only baseline ok, or mutation with Session evidence)
  1  FAIL gate (handler/bootstrap/no-progress/no session/provenance/g2/redirect)
  2  Usage / configuration error
  3  Transport / connectivity error
`.trim();
  console.log(text);
}

/**
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  /** @type {Record<string, any>} */
  const opts = {
    help: false,
    dryRun: false,
    confirmSingleRetry: false,
    pauseFirst: false,
    postProofPause: true,
    requireSession: true,
    allowObservedFail: false,
    baseUrl: DEFAULT_BASE_URL,
    jobId: DEFAULT_JOB_ID,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    pollMs: DEFAULT_POLL_MS,
    expectedGeneration: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v == null || v.startsWith("-")) {
        throw new Error(`Missing value for ${a}`);
      }
      return v;
    };
    switch (a) {
      case "--help":
      case "-h":
        opts.help = true;
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--confirm-single-retry":
        opts.confirmSingleRetry = true;
        break;
      case "--pause-first":
        opts.pauseFirst = true;
        break;
      case "--post-proof-pause":
        opts.postProofPause = true;
        break;
      case "--no-post-proof-pause":
        opts.postProofPause = false;
        break;
      case "--require-session":
        opts.requireSession = true;
        break;
      case "--allow-observed-fail":
        opts.allowObservedFail = true;
        break;
      case "--base-url":
        opts.baseUrl = next();
        break;
      case "--job-id":
        opts.jobId = next();
        break;
      case "--timeout-ms":
        opts.timeoutMs = Number.parseInt(next(), 10);
        break;
      case "--poll-ms":
        opts.pollMs = Number.parseInt(next(), 10);
        break;
      case "--expected-generation":
        opts.expectedGeneration = Number.parseInt(next(), 10);
        break;
      default:
        throw new Error(`Unknown argument: ${a}`);
    }
  }

  if (!Number.isFinite(opts.timeoutMs) || opts.timeoutMs < 1_000) {
    throw new Error("--timeout-ms must be >= 1000");
  }
  if (!Number.isFinite(opts.pollMs) || opts.pollMs < 200) {
    throw new Error("--poll-ms must be >= 200");
  }
  if (!opts.jobId || typeof opts.jobId !== "string") {
    throw new Error("--job-id is required");
  }
  if (opts.jobId.includes("..") || opts.jobId.includes("/") || opts.jobId.includes("\\")) {
    throw new Error("Invalid --job-id");
  }
  try {
    const u = new URL(opts.baseUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      throw new Error("base-url must be http(s)");
    }
    // Origin only by default (host:port). Optional non-root pathname kept for reverse-proxy prefixes.
    const path =
      u.pathname && u.pathname !== "/"
        ? u.pathname.replace(/\/+$/, "")
        : "";
    opts.baseUrl = `${u.protocol}//${u.host}${path}`;
  } catch (err) {
    throw new Error(`Invalid --base-url: ${(err && err.message) || err}`);
  }

  return opts;
}

// ─── Privacy / evidence helpers ──────────────────────────────────────────────

/**
 * @param {unknown} value
 * @param {string} [label]
 */
export function assertNoSensitiveLeak(value, label = "payload") {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  for (const re of PRIVACY_PATTERNS) {
    if (re.test(text)) {
      throw new Error(`Privacy sentinel hit in ${label}: ${re}`);
    }
  }
}

/**
 * Keep only allowlisted meta keys for event evidence.
 * @param {unknown} meta
 */
export function sanitizeEventMeta(meta) {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [k, v] of Object.entries(meta)) {
    if (!ALLOWLISTED_BOOTSTRAP_META_KEYS.has(k)) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v == null) {
      out[k] = v;
    } else if (typeof v === "boolean") {
      out[k] = v;
    }
  }
  return Object.keys(out).length ? out : null;
}

/**
 * @param {any} job
 */
export function pickJobEvidence(job) {
  if (!job || typeof job !== "object") return null;
  return {
    jobId: job.jobId ?? null,
    generation: job.generation ?? null,
    attempt: job.attempt ?? null,
    phase: job.phase ?? null,
    status: job.status ?? null,
    checkpoint: job.checkpoint ?? null,
    reasonCode: job.reasonCode ?? null,
    schedulerState: job.schedulerState ?? null,
    agentExecutionState: job.agentExecutionState ?? null,
    sessionAvailability: job.sessionAvailability ?? null,
    blockedAtLayer: job.blockedAtLayer ?? null,
    retryability: job.retryability ?? null,
    sessionIdShort: job.sessionIdShort ?? null,
    workspaceLabel: job.workspaceLabel ?? null,
    headBranch: job.headBranch ?? null,
    counts: job.counts
      ? {
          schedulerRuns: job.counts.schedulerRuns ?? null,
          agentRuns: job.counts.agentRuns ?? null,
          noProgressRuns: job.counts.noProgressRuns ?? null,
          meaningfulProgress: job.counts.meaningfulProgress ?? null,
        }
      : null,
    lastMeaningfulProgress: job.lastMeaningfulProgress
      ? {
          at: job.lastMeaningfulProgress.at ?? null,
          kind: job.lastMeaningfulProgress.kind ?? null,
        }
      : null,
    evaluatedProvenance: job.evaluatedProvenance
      ? {
          codeRevision: job.evaluatedProvenance.codeRevision ?? null,
          policyVersion: job.evaluatedProvenance.policyVersion ?? null,
        }
      : null,
  };
}

/**
 * @param {any} status
 */
export function pickStatusEvidence(status) {
  if (!status || typeof status !== "object") return null;
  const rp = status.runtimeProvenance || {};
  return {
    generatedAt: status.generatedAt ?? null,
    runtimeProvenance: {
      packageVersion: rp.packageVersion ?? null,
      buildId: rp.buildId ?? null,
      codeRevision: rp.codeRevision ?? null,
      processEpoch: rp.processEpoch ?? null,
      processStartedAt: rp.processStartedAt ?? null,
      policyVersion: rp.policyVersion ?? null,
    },
    config: status.config
      ? {
          enabled: status.config.enabled ?? null,
          mode: status.config.mode ?? null,
          paused: status.config.paused ?? null,
          unattendedEnabled: status.config.unattended?.enabled ?? status.config.unattendedEnabled ?? null,
        }
      : null,
    runtimeCounts: status.runtime?.counts ?? null,
  };
}

/**
 * @param {any} health
 */
export function pickHealthEvidence(health) {
  if (!health || typeof health !== "object") return null;
  return {
    ok: health.ok === true,
    app: health.app ?? null,
    version: health.version ?? null,
    pid: health.pid ?? null,
  };
}

// ─── HTTP (no redirect follow) ───────────────────────────────────────────────

/**
 * fetch without automatic redirect following.
 * @param {string} url
 * @param {RequestInit & { timeoutMs?: number }} [init]
 */
export async function fetchNoRedirect(url, init = {}) {
  const timeoutMs = init.timeoutMs ?? 15_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      redirect: "manual",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(init.headers || {}),
      },
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {Response} res
 * @param {string} label
 */
export function assertDirectResponse(res, label) {
  if (res.status === 301 || res.status === 302 || res.status === 303 || res.status === 307 || res.status === 308) {
    const loc = res.headers.get("location") || "(none)";
    throw Object.assign(
      new Error(
        `${label}: HTTP ${res.status} redirect to ${loc} — refuse port spoof / non-direct 30142 attribution`,
      ),
      { code: "redirect_refused", exitCode: 1 },
    );
  }
  if (res.type === "opaqueredirect") {
    throw Object.assign(
      new Error(`${label}: opaque redirect refused`),
      { code: "redirect_refused", exitCode: 1 },
    );
  }
}

/**
 * @param {string} baseUrl
 * @param {string} path
 * @param {RequestInit & { timeoutMs?: number }} [init]
 */
export async function apiJson(baseUrl, path, init = {}) {
  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetchNoRedirect(url, init);
  assertDirectResponse(res, path);
  const text = await res.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw Object.assign(
        new Error(`${path}: non-JSON response (status ${res.status})`),
        { code: "bad_response", exitCode: 3, status: res.status },
      );
    }
  }
  return { res, body, status: res.status, url };
}

// ─── Evaluation predicates ───────────────────────────────────────────────────

/**
 * @param {{ baseline: any, current: any, events?: any[], health?: any, status?: any }} input
 */
export function evaluateAcceptance(input) {
  /** @type {string[]} */
  const failures = [];
  /** @type {string[]} */
  const notes = [];
  const baseline = input.baseline;
  const current = input.current;
  const events = Array.isArray(input.events) ? input.events : [];

  if (!baseline || !current) {
    failures.push("missing baseline or current job projection");
    return { pass: false, failures, notes, requiredEventsSeen: [] };
  }

  if (baseline.jobId && current.jobId && baseline.jobId !== current.jobId) {
    failures.push(`jobId changed: ${baseline.jobId} → ${current.jobId}`);
  }
  if (
    Number.isFinite(baseline.generation) &&
    Number.isFinite(current.generation) &&
    current.generation !== baseline.generation
  ) {
    failures.push(`generation changed (g2 forbidden): ${baseline.generation} → ${current.generation}`);
  }
  if (
    Number.isFinite(baseline.attempt) &&
    Number.isFinite(current.attempt) &&
    current.attempt < baseline.attempt
  ) {
    failures.push(`attempt reset forbidden: ${baseline.attempt} → ${current.attempt}`);
  }
  if (
    Number.isFinite(baseline.attempt) &&
    Number.isFinite(current.attempt) &&
    current.attempt - baseline.attempt > 5
  ) {
    failures.push(
      `attempt empty-spin suspected: ${baseline.attempt} → ${current.attempt} (delta>${5})`,
    );
  }

  const reason = typeof current.reasonCode === "string" ? current.reasonCode : "";
  if (FAIL_REASON_CODES.has(reason)) {
    failures.push(`fail reasonCode=${reason}`);
  }
  if (reason === "Internal GitHub automation error" || /Internal GitHub automation error/i.test(String(current.reasonCode || ""))) {
    failures.push("generic Internal GitHub automation error");
  }

  for (const ev of events) {
    if (ev && FAIL_EVENT_KINDS.has(ev.kind)) {
      failures.push(`fail event kind=${ev.kind}${ev.reasonCode ? ` reason=${ev.reasonCode}` : ""}`);
    }
    if (ev?.meta?.message && /Internal GitHub automation error/i.test(String(ev.meta.message))) {
      failures.push("event meta still only generic Internal GitHub automation error");
    }
  }

  const kindsSeen = events.map((e) => e?.kind).filter(Boolean);
  const requiredEventsSeen = REQUIRED_EVENT_KINDS.filter((k) => kindsSeen.includes(k));
  for (const k of REQUIRED_EVENT_KINDS) {
    if (!kindsSeen.includes(k)) {
      // only hard-require session_created for final pass; others are strong signals
      if (k === "unattended_session_created") {
        notes.push(`missing event ${k}`);
      } else {
        notes.push(`event not observed yet: ${k}`);
      }
    }
  }

  const sessionOk = SUCCESS_SESSION.has(String(current.sessionAvailability || ""));
  const agentRuns = current.counts?.agentRuns ?? 0;
  const hasSessionId = typeof current.sessionIdShort === "string" && current.sessionIdShort.length > 0;
  const meaningful =
    (current.counts?.meaningfulProgress ?? 0) > (baseline.counts?.meaningfulProgress ?? 0) ||
    current.lastMeaningfulProgress?.kind === "session_created";

  if (!sessionOk) {
    failures.push(
      `sessionAvailability=${current.sessionAvailability ?? "null"} (need active|ended)`,
    );
  }
  if (!(agentRuns >= 1) && !hasSessionId) {
    failures.push(`no Session evidence (agentRuns=${agentRuns}, sessionIdShort missing)`);
  }
  if (!kindsSeen.includes("unattended_session_created") && !sessionOk) {
    failures.push("no unattended_session_created event and no sessionAvailability proof");
  }
  if (sessionOk && !meaningful && agentRuns < 1) {
    notes.push("session present but meaningful progress / agentRuns not advanced");
  }

  // Empty-spin pattern: only job_started + no_progress without implementing
  if (
    kindsSeen.includes("job_started") &&
    kindsSeen.includes("job_no_progress_backoff") &&
    !kindsSeen.includes("unattended_implementing") &&
    !sessionOk
  ) {
    failures.push("empty-spin pattern: job_started → job_no_progress_backoff without unattended_implementing");
  }

  return {
    pass: failures.length === 0 && sessionOk && (agentRuns >= 1 || hasSessionId),
    failures,
    notes,
    requiredEventsSeen,
    sessionOk,
    agentRuns,
    hasSessionId,
  };
}

// ─── Mock server for --dry-run ───────────────────────────────────────────────

/**
 * @param {{ mode?: "baseline" | "success" | "redirect" | "bootstrap_fail" }} [options]
 */
export async function startMockServer(options = {}) {
  const mode = options.mode || "baseline";
  const jobId = DEFAULT_JOB_ID;
  let mutationPosts = 0;
  let phase = "planning";
  let status = "paused";
  let attempt = 900;
  let sessionAvailability = "none";
  let agentRuns = 0;
  let sessionIdShort = null;
  let reasonCode = "runner_no_progress";
  let meaningfulProgress = 0;
  /** @type {any[]} */
  let events = [];

  const server = createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const send = (code, body, headers = {}) => {
      const payload = JSON.stringify(body);
      res.writeHead(code, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        ...headers,
      });
      res.end(payload);
    };

    if (mode === "redirect" && url.pathname === "/api/cli/health") {
      res.writeHead(302, { Location: "http://localhost:30141/api/cli/health" });
      res.end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/cli/health") {
      send(200, {
        ok: true,
        app: "yolk-pi-web",
        version: "0.8.4-dry-run",
        pid: process.pid,
        capabilities: { agentApi: true, studio: true },
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/github-automation/status") {
      send(200, {
        ok: true,
        status: {
          revision: "dry",
          generatedAt: new Date().toISOString(),
          runtimeProvenance: {
            packageVersion: "0.8.4-dry-run",
            buildId: "dry-build",
            codeRevision: "dry-code",
            processEpoch: "dry-epoch",
            processStartedAt: new Date().toISOString(),
            policyVersion: "dry-policy",
          },
          config: {
            enabled: true,
            mode: "full",
            paused: false,
            unattended: { enabled: true },
          },
          runtime: { counts: { queued: 0, running: 0, retry: 0, blocked: 0, paused: 1, prOpen: 0, completed: 0 } },
          jobs: [],
        },
      });
      return;
    }

    if (req.method === "GET" && url.pathname === `/api/github-automation/jobs/${jobId}`) {
      send(200, {
        ok: true,
        job: {
          jobId,
          repositoryId: 1278854433,
          repositoryFullName: "602362837/yolk-pi-web",
          issueNumber: 22,
          issueTitlePreview: "dry-run title",
          phase,
          status,
          attempt,
          generation: 1,
          traceId: "dry-trace",
          reasonCode,
          nextRetryAt: null,
          createdAt: "2026-07-27T00:00:00.000Z",
          updatedAt: new Date().toISOString(),
          checkpoint: "studio_task_ready",
          claimStatus: "complete",
          prNumber: null,
          headBranch: "ypi/issue-22-g1",
          hasPullRequest: false,
          actions: [],
          schedulerState: status === "paused" ? "paused" : "idle",
          agentExecutionState: agentRuns > 0 ? "implementing" : "not_started",
          sessionAvailability,
          blockedAtLayer: sessionAvailability === "none" ? "scheduler" : null,
          retryability: "automatic",
          lastMeaningfulProgress:
            meaningfulProgress > 0
              ? { at: new Date().toISOString(), kind: "session_created" }
              : { at: null, kind: null },
          counts: {
            schedulerRuns: attempt,
            agentRuns,
            noProgressRuns: 2,
            meaningfulProgress,
          },
          workspaceLabel: "wt_dry",
          sessionIdShort,
          evaluatedProvenance: null,
        },
      });
      return;
    }

    if (req.method === "POST" && url.pathname === `/api/github-automation/jobs/${jobId}`) {
      let body = "";
      req.on("data", (c) => {
        body += c;
      });
      req.on("end", () => {
        /** @type {any} */
        let parsed = {};
        try {
          parsed = JSON.parse(body || "{}");
        } catch {
          send(400, { ok: false, code: "invalid_config", message: "bad json" });
          return;
        }
        const action = parsed.action;
        if (action === "pause") {
          status = "paused";
          phase = "paused";
          send(200, { ok: true, action: "pause", job: { jobId, status, generation: 1 } });
          return;
        }
        if (action === "retry") {
          mutationPosts += 1;
          if (mutationPosts > 1) {
            send(429, { ok: false, code: "too_many", message: "mock only allows one retry" });
            return;
          }
          if (mode === "bootstrap_fail") {
            status = "blocked";
            phase = "implementing";
            reasonCode = "session_bootstrap_failed";
            sessionAvailability = "failed";
            events = [
              { kind: "unattended_retry_wake", at: new Date().toISOString() },
              { kind: "job_started", at: new Date().toISOString() },
              { kind: "unattended_implementing", at: new Date().toISOString() },
              {
                kind: "unattended_session_bootstrap_failed",
                reasonCode: "session_bootstrap_failed",
                meta: {
                  bootstrapCode: "session_runtime_module_missing",
                  stage: "runtime_load",
                  retryable: false,
                  message: "Session runtime module missing",
                },
                at: new Date().toISOString(),
              },
            ];
            attempt += 1;
            send(200, { ok: true, action: "retry", job: { jobId, status, generation: 1 } });
            return;
          }
          // success path
          status = "running";
          phase = "implementing";
          reasonCode = null;
          attempt += 1;
          sessionAvailability = "active";
          agentRuns = 1;
          sessionIdShort = "sess_dry_abc";
          meaningfulProgress = 1;
          events = [
            { kind: "unattended_retry_wake", at: new Date().toISOString() },
            { kind: "job_started", at: new Date().toISOString() },
            { kind: "unattended_implementing", at: new Date().toISOString() },
            {
              kind: "unattended_session_created",
              meta: { sessionIdShort: "sess_dry_abc", hasProjectBinding: true, hasSpaceBinding: true },
              at: new Date().toISOString(),
            },
          ];
          send(200, { ok: true, action: "retry", job: { jobId, status, generation: 1, sessionIdShort } });
          return;
        }
        send(400, { ok: false, code: "invalid_config", message: `unknown action ${action}` });
      });
      return;
    }

    // Optional events endpoint for dry-run polling (not a real product API)
    if (req.method === "GET" && url.pathname === `/api/github-automation/jobs/${jobId}/events`) {
      send(200, { ok: true, events });
      return;
    }

    send(404, { ok: false, code: "not_found", message: "mock route missing" });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("mock server failed to bind");
  }
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    jobId,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
    getMutationPosts: () => mutationPosts,
    getEvents: () => events.slice(),
  };
}

// ─── Core flows ──────────────────────────────────────────────────────────────

/**
 * @param {ReturnType<typeof parseArgs>} opts
 * @param {{ fetchEvents?: (baseUrl: string, jobId: string) => Promise<any[]> }} [hooks]
 */
export async function runReadOnlyBaseline(opts, hooks = {}) {
  const healthRes = await apiJson(opts.baseUrl, "/api/cli/health");
  if (healthRes.status !== 200 || !healthRes.body?.ok) {
    throw Object.assign(new Error(`health not ok (status ${healthRes.status})`), {
      code: "health_failed",
      exitCode: 3,
    });
  }
  const health = pickHealthEvidence(healthRes.body);
  assertNoSensitiveLeak(health, "health");

  const statusRes = await apiJson(opts.baseUrl, "/api/github-automation/status");
  if (statusRes.status !== 200 || !statusRes.body?.ok) {
    throw Object.assign(new Error(`status not ok (status ${statusRes.status})`), {
      code: "status_failed",
      exitCode: 3,
    });
  }
  const status = pickStatusEvidence(statusRes.body.status);
  assertNoSensitiveLeak(status, "status");

  const jobRes = await apiJson(opts.baseUrl, `/api/github-automation/jobs/${encodeURIComponent(opts.jobId)}`);
  if (jobRes.status === 404) {
    throw Object.assign(new Error(`job not found: ${opts.jobId}`), {
      code: "job_not_found",
      exitCode: 1,
    });
  }
  if (jobRes.status !== 200 || !jobRes.body?.ok) {
    throw Object.assign(new Error(`job GET failed (status ${jobRes.status})`), {
      code: "job_failed",
      exitCode: 3,
    });
  }
  const job = pickJobEvidence(jobRes.body.job);
  assertNoSensitiveLeak(job, "job");

  /** @type {any[]} */
  let events = [];
  if (hooks.fetchEvents) {
    events = await hooks.fetchEvents(opts.baseUrl, opts.jobId);
  }

  const evidence = {
    mode: "read_only",
    baseUrl: opts.baseUrl,
    checkedAt: new Date().toISOString(),
    health,
    status,
    job,
    isolationReminder: [
      "Ensure no other ypi scheduler shares the same PI_CODING_AGENT_DIR.",
      "lsof -nP -iTCP:30141 -sTCP:LISTEN",
      "lsof -nP -iTCP:30142 -sTCP:LISTEN",
      "health.pid must match the 30142 LISTEN pid.",
      "Reject HTTP 301/302; this harness already refuses redirects.",
    ],
    startReminder: [
      "npm run build",
      `PI_CODING_AGENT_DIR="\${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}" node bin/pi-web.js --port 30142 --no-open`,
    ],
    eventsSample: events.slice(-10).map((e) => ({
      kind: e.kind ?? null,
      reasonCode: e.reasonCode ?? null,
      at: e.at ?? null,
      meta: sanitizeEventMeta(e.meta),
    })),
  };

  // Port attribution soft checks
  try {
    const u = new URL(opts.baseUrl);
    if (u.port && u.port !== "30142" && !opts.dryRun) {
      evidence.portNote = `base-url port is ${u.port}, not 30142 — ensure this is intentional for same-shape jobs`;
    }
  } catch {
    // ignore
  }

  return evidence;
}

/**
 * @param {string} baseUrl
 * @param {string} jobId
 * @param {"pause"|"retry"|"resume"} action
 */
function isJobPausedProjection(job) {
  if (!job || typeof job !== "object") return false;
  if (job.status === "paused") return true;
  if (job.phase === "paused") return true;
  if (job.schedulerState === "paused") return true;
  if (job.pauseRequested === true) return true;
  return false;
}

function isAlreadyPausedActionError(body) {
  if (!body || typeof body !== "object") return false;
  const message = String(body.message ?? "");
  const code = String(body.code ?? "");
  return (
    /already_paused/i.test(message) ||
    /already_paused/i.test(code) ||
    (code === "not_allowed" && /already.?paused/i.test(message))
  );
}

async function postJobAction(baseUrl, jobId, action) {
  const res = await apiJson(baseUrl, `/api/github-automation/jobs/${encodeURIComponent(jobId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  if (res.status >= 400 || res.body?.ok === false) {
    // Idempotent pause: already paused is success for stop-bleed / pre-retry gates.
    if (action === "pause" && isAlreadyPausedActionError(res.body)) {
      return {
        ok: true,
        action: "pause",
        code: "already_paused",
        job: res.body?.job ?? null,
      };
    }
    throw Object.assign(
      new Error(
        `${action} failed status=${res.status} code=${res.body?.code ?? "?"} message=${res.body?.message ?? "?"}`,
      ),
      { code: "action_failed", exitCode: 1, body: res.body },
    );
  }
  return res.body;
}

/**
 * @param {ReturnType<typeof parseArgs>} opts
 * @param {{ fetchEvents?: (baseUrl: string, jobId: string) => Promise<any[]> }} [hooks]
 */
export async function runMutationAcceptance(opts, hooks = {}) {
  if (!opts.confirmSingleRetry) {
    throw Object.assign(
      new Error("Mutation requires exact flag --confirm-single-retry"),
      { code: "mutation_not_confirmed", exitCode: 2 },
    );
  }

  const baselineEvidence = await runReadOnlyBaseline(opts, hooks);
  const baseline = baselineEvidence.job;
  const expectedGeneration =
    opts.expectedGeneration != null ? opts.expectedGeneration : baseline?.generation;

  /** @type {number} */
  let retryPosts = 0;
  /** @type {any[]} */
  const actionLog = [];

  // Job may be paused via phase/schedulerState while status remains retry_due
  // (e.g. handler_not_ready after stop-bleed). Treat all as already paused.
  if (opts.pauseFirst || !isJobPausedProjection(baseline)) {
    if (!isJobPausedProjection(baseline)) {
      const pauseResult = await postJobAction(opts.baseUrl, opts.jobId, "pause");
      actionLog.push({
        action: "pause",
        ok: true,
        at: new Date().toISOString(),
        code: pauseResult?.code ?? null,
      });
      assertNoSensitiveLeak(
        { action: "pause", jobId: opts.jobId, generation: pauseResult?.job?.generation ?? null },
        "pause-result",
      );
      await sleep(DEFAULT_STABLE_PAUSE_MS);
    }
  }

  // Exactly one retry
  retryPosts += 1;
  if (retryPosts !== 1) {
    throw new Error("internal: retryPosts invariant");
  }
  const retryResult = await postJobAction(opts.baseUrl, opts.jobId, "retry");
  actionLog.push({
    action: "retry",
    ok: true,
    at: new Date().toISOString(),
    generation: retryResult?.job?.generation ?? null,
  });
  assertNoSensitiveLeak(
    { action: "retry", jobId: opts.jobId, generation: retryResult?.job?.generation ?? null },
    "retry-result",
  );

  const deadline = Date.now() + opts.timeoutMs;
  /** @type {any} */
  let current = null;
  /** @type {any[]} */
  let events = [];
  /** @type {ReturnType<typeof evaluateAcceptance> | null} */
  let evaluation = null;

  while (Date.now() < deadline) {
    const jobRes = await apiJson(
      opts.baseUrl,
      `/api/github-automation/jobs/${encodeURIComponent(opts.jobId)}`,
    );
    if (jobRes.status === 200 && jobRes.body?.ok) {
      current = pickJobEvidence(jobRes.body.job);
      assertNoSensitiveLeak(current, "job-poll");
    }
    if (hooks.fetchEvents) {
      events = await hooks.fetchEvents(opts.baseUrl, opts.jobId);
    }
    evaluation = evaluateAcceptance({
      baseline,
      current,
      events,
      health: baselineEvidence.health,
      status: baselineEvidence.status,
    });
    if (evaluation.pass) break;

    // Fail-fast on hard typed failures once observed after retry
    const hard = evaluation.failures.some(
      (f) =>
        f.includes("handler_not_ready") ||
        f.includes("session_bootstrap") ||
        f.includes("runner_no_progress") ||
        f.includes("empty-spin") ||
        f.includes("generation changed") ||
        f.includes("attempt reset"),
    );
    if (hard && Date.now() > deadline - opts.timeoutMs + Math.min(10_000, opts.timeoutMs / 3)) {
      // allow a short observation window, then stop
      if (Date.now() > deadline - opts.timeoutMs + 12_000) break;
    }
    await sleep(opts.pollMs);
  }

  if (!evaluation) {
    evaluation = evaluateAcceptance({ baseline, current, events });
  }

  let postProofPause = null;
  if (evaluation.pass && opts.postProofPause) {
    try {
      await postJobAction(opts.baseUrl, opts.jobId, "pause");
      postProofPause = { ok: true, at: new Date().toISOString() };
      actionLog.push({ action: "post_proof_pause", ok: true, at: postProofPause.at });
    } catch (err) {
      postProofPause = {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        at: new Date().toISOString(),
      };
      actionLog.push({ action: "post_proof_pause", ok: false, at: postProofPause.at });
    }
  }

  // Final status re-check for provenance
  const statusRes = await apiJson(opts.baseUrl, "/api/github-automation/status");
  const status = statusRes.body?.ok ? pickStatusEvidence(statusRes.body.status) : null;

  if (
    expectedGeneration != null &&
    current &&
    Number.isFinite(current.generation) &&
    current.generation !== expectedGeneration
  ) {
    evaluation.pass = false;
    evaluation.failures.push(
      `generation mismatch vs expected ${expectedGeneration}: got ${current.generation}`,
    );
  }

  const report = {
    mode: "mutation_single_retry",
    baseUrl: opts.baseUrl,
    checkedAt: new Date().toISOString(),
    health: baselineEvidence.health,
    status,
    baseline,
    final: current,
    retryPosts,
    actionLog,
    postProofPause,
    events: events.slice(-30).map((e) => ({
      kind: e.kind ?? null,
      reasonCode: e.reasonCode ?? null,
      at: e.at ?? null,
      meta: sanitizeEventMeta(e.meta),
    })),
    evaluation: {
      pass: evaluation.pass,
      failures: evaluation.failures,
      notes: evaluation.notes,
      requiredEventsSeen: evaluation.requiredEventsSeen,
      sessionOk: evaluation.sessionOk,
      agentRuns: evaluation.agentRuns,
      hasSessionId: evaluation.hasSessionId,
    },
    checkerTemplate: {
      "30142": evaluation.pass ? "PASS" : "FAIL",
      "PID/processEpoch/codeRevision": `${baselineEvidence.health?.pid ?? "?"}/${status?.runtimeProvenance?.processEpoch ?? "?"}/${status?.runtimeProvenance?.codeRevision ?? "?"}`,
      "Job/generation": `${opts.jobId} / g${current?.generation ?? "?"}`,
      "Attempt baseline → final": `${baseline?.attempt ?? "?"} → ${current?.attempt ?? "?"}`,
      Events: evaluation.requiredEventsSeen.join(" → ") || "(none)",
      "Session availability / agentRuns": `${current?.sessionAvailability ?? "?"} / ${current?.counts?.agentRuns ?? "?"}`,
      "Same WT/branch/task/history":
        baseline?.headBranch && current?.headBranch && baseline.headBranch === current.headBranch
          ? "PASS (branch)"
          : "CHECK MANUALLY",
      "Post-proof pause": postProofPause?.ok ? "PASS" : postProofPause ? "FAIL" : "SKIPPED",
      Blockers: evaluation.failures.join("; ") || "none",
    },
  };

  assertNoSensitiveLeak(report, "final-report");
  return report;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Dry-run self tests: redirect refuse, read-only no mutation, success path, bootstrap fail.
 */
export async function runDryRunSuite() {
  /** @type {{ name: string, ok: boolean, detail?: string }[]} */
  const results = [];

  // 1) redirect refuse
  {
    const mock = await startMockServer({ mode: "redirect" });
    try {
      await runReadOnlyBaseline({
        ...parseArgs(["--job-id", mock.jobId, "--base-url", mock.baseUrl, "--dry-run"]),
        dryRun: true,
        baseUrl: mock.baseUrl,
        jobId: mock.jobId,
      });
      results.push({ name: "redirect_refuse", ok: false, detail: "expected throw" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({
        name: "redirect_refuse",
        ok: /redirect/i.test(msg),
        detail: msg,
      });
    } finally {
      await mock.close();
    }
  }

  // 2) read-only does not POST
  {
    const mock = await startMockServer({ mode: "baseline" });
    try {
      const evidence = await runReadOnlyBaseline({
        help: false,
        dryRun: true,
        confirmSingleRetry: false,
        pauseFirst: false,
        postProofPause: true,
        requireSession: true,
        allowObservedFail: false,
        baseUrl: mock.baseUrl,
        jobId: mock.jobId,
        timeoutMs: 5_000,
        pollMs: 200,
        expectedGeneration: null,
      });
      results.push({
        name: "read_only_baseline",
        ok: evidence.job?.attempt === 900 && mock.getMutationPosts() === 0,
        detail: `attempt=${evidence.job?.attempt} mutations=${mock.getMutationPosts()}`,
      });
    } finally {
      await mock.close();
    }
  }

  // 3) mutation without confirm rejected
  {
    try {
      await runMutationAcceptance({
        help: false,
        dryRun: true,
        confirmSingleRetry: false,
        pauseFirst: false,
        postProofPause: true,
        requireSession: true,
        allowObservedFail: false,
        baseUrl: "http://127.0.0.1:9",
        jobId: "job_x",
        timeoutMs: 1000,
        pollMs: 200,
        expectedGeneration: null,
      });
      results.push({ name: "mutation_requires_confirm", ok: false, detail: "expected throw" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({
        name: "mutation_requires_confirm",
        ok: /confirm-single-retry/i.test(msg),
        detail: msg,
      });
    }
  }

  // 4) success single retry + post proof pause
  {
    const mock = await startMockServer({ mode: "success" });
    try {
      const fetchEvents = async (baseUrl, jobId) => {
        const res = await apiJson(baseUrl, `/api/github-automation/jobs/${jobId}/events`);
        return res.body?.events || [];
      };
      const report = await runMutationAcceptance(
        {
          help: false,
          dryRun: true,
          confirmSingleRetry: true,
          pauseFirst: true,
          postProofPause: true,
          requireSession: true,
          allowObservedFail: false,
          baseUrl: mock.baseUrl,
          jobId: mock.jobId,
          timeoutMs: 5_000,
          pollMs: 100,
          expectedGeneration: 1,
        },
        { fetchEvents },
      );
      results.push({
        name: "mutation_success_session",
        ok:
          report.evaluation.pass === true &&
          mock.getMutationPosts() === 1 &&
          report.retryPosts === 1 &&
          report.final?.sessionAvailability === "active",
        detail: JSON.stringify(report.checkerTemplate),
      });
    } finally {
      await mock.close();
    }
  }

  // 5) bootstrap fail is FAIL
  {
    const mock = await startMockServer({ mode: "bootstrap_fail" });
    try {
      const fetchEvents = async (baseUrl, jobId) => {
        const res = await apiJson(baseUrl, `/api/github-automation/jobs/${jobId}/events`);
        return res.body?.events || [];
      };
      const report = await runMutationAcceptance(
        {
          help: false,
          dryRun: true,
          confirmSingleRetry: true,
          pauseFirst: true,
          postProofPause: false,
          requireSession: true,
          allowObservedFail: true,
          baseUrl: mock.baseUrl,
          jobId: mock.jobId,
          timeoutMs: 3_000,
          pollMs: 100,
          expectedGeneration: 1,
        },
        { fetchEvents },
      );
      results.push({
        name: "bootstrap_fail_is_fail",
        ok: report.evaluation.pass === false && mock.getMutationPosts() === 1,
        detail: report.evaluation.failures.join("; "),
      });
    } finally {
      await mock.close();
    }
  }

  // 6) evaluateAcceptance unit checks
  {
    const spin = evaluateAcceptance({
      baseline: {
        jobId: "j",
        generation: 1,
        attempt: 900,
        sessionAvailability: "none",
        counts: { agentRuns: 0, meaningfulProgress: 0 },
      },
      current: {
        jobId: "j",
        generation: 1,
        attempt: 901,
        sessionAvailability: "none",
        reasonCode: "runner_no_progress",
        counts: { agentRuns: 0, meaningfulProgress: 0 },
      },
      events: [
        { kind: "unattended_retry_wake" },
        { kind: "job_started" },
        { kind: "job_no_progress_backoff" },
      ],
    });
    results.push({
      name: "unit_empty_spin_fail",
      ok: spin.pass === false && spin.failures.some((f) => /no_progress|empty-spin|runner_no_progress/.test(f)),
      detail: spin.failures.join("; "),
    });

    const ok = evaluateAcceptance({
      baseline: {
        jobId: "j",
        generation: 1,
        attempt: 900,
        sessionAvailability: "none",
        counts: { agentRuns: 0, meaningfulProgress: 0 },
        headBranch: "b",
      },
      current: {
        jobId: "j",
        generation: 1,
        attempt: 901,
        sessionAvailability: "active",
        reasonCode: null,
        sessionIdShort: "s1",
        counts: { agentRuns: 1, meaningfulProgress: 1 },
        lastMeaningfulProgress: { kind: "session_created", at: "t" },
        headBranch: "b",
      },
      events: [
        { kind: "unattended_retry_wake" },
        { kind: "job_started" },
        { kind: "unattended_implementing" },
        { kind: "unattended_session_created", meta: { sessionIdShort: "s1" } },
      ],
    });
    results.push({
      name: "unit_session_pass",
      ok: ok.pass === true,
      detail: ok.failures.join("; ") || "pass",
    });
  }

  const failed = results.filter((r) => !r.ok);
  return { ok: failed.length === 0, results };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    console.error(`Usage error: ${err instanceof Error ? err.message : err}`);
    printHelp();
    process.exitCode = 2;
    return;
  }

  if (opts.help) {
    printHelp();
    return;
  }

  if (opts.dryRun) {
    console.log("=== dry-run self-test (no production job, no real 30142) ===");
    const suite = await runDryRunSuite();
    for (const r of suite.results) {
      console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
    }
    if (!suite.ok) {
      console.error("\nDry-run suite FAILED");
      process.exitCode = 1;
      return;
    }
    console.log("\nDry-run suite PASSED");
    console.log(
      "Default mode remains read-only. Real mutation needs --confirm-single-retry on a live 30142.",
    );
    return;
  }

  try {
    if (!opts.confirmSingleRetry) {
      const evidence = await runReadOnlyBaseline(opts);
      console.log(JSON.stringify(evidence, null, 2));
      console.log("\n# READ-ONLY complete. No job mutation performed.");
      console.log("# To run the single-retry gate (GHR-06 only):");
      console.log(
        `#   node scripts/verify-github-automation-30142.mjs --job-id ${opts.jobId} --base-url ${opts.baseUrl} --confirm-single-retry --pause-first --post-proof-pause`,
      );
      return;
    }

    // Live mutation path: events are not exposed via a public list API.
    // Operator should also inspect safe events via checks.md tail of events jsonl.
    // Harness judges primarily from job projection + optional event hook (none by default).
    const report = await runMutationAcceptance(opts, {
      fetchEvents: async () => {
        // No public events API — leave empty so projection-based Session evidence is required.
        return [];
      },
    });
    console.log(JSON.stringify(report, null, 2));
    if (!report.evaluation.pass) {
      console.error("\n30142 acceptance FAIL");
      console.error(report.evaluation.failures.join("\n"));
      process.exitCode = 1;
      return;
    }
    if (report.postProofPause && report.postProofPause.ok === false) {
      console.error("\nSession proof PASS but post-proof pause FAILED — stop-bleed manually");
      process.exitCode = 1;
      return;
    }
    console.log("\n30142 acceptance PASS (Session evidence + same generation)");
  } catch (err) {
    const exitCode = /** @type {any} */ (err)?.exitCode ?? 3;
    console.error(`ERROR: ${err instanceof Error ? err.message : err}`);
    process.exitCode = exitCode;
  }
}

const isDirect =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirect) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 3;
  });
}
