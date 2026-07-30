/**
 * Production-artifact runtime smoke for GitHub Issue Analysis.
 *
 * Proves the real cold `.next` multi-entry path:
 *   built instrumentation.register() → built webhook route POST
 * leases a freshly enqueued human issues.opened job, runs the real analysis
 * handler, never emits analysis_handler_initialization_failed /
 * handler_not_ready / default_handler_defensive_fallback, and never reaches
 * real network or the operator's agent directory.
 *
 * Prerequisites:
 *   npm run build   # must produce a fresh .next (do not use bare next build)
 *
 * Run:
 *   npm run test:github-automation-production-runtime
 *
 * Loads only stable built entry paths under `.next/server/`. Does not import
 * source TypeScript via jiti, does not hard-code generated chunk filenames or
 * Webpack module ids, and does not accept a static bundle string search as a
 * substitute for the assertions below.
 */

import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync } from "node:crypto";
import { createRequire } from "node:module";
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "package.json"));

const INSTRUMENTATION_REL = ".next/server/instrumentation.js";
const WEBHOOK_ROUTE_REL =
  ".next/server/app/api/github-automation/webhook/route.js";
const INSTRUMENTATION_ABS = join(root, INSTRUMENTATION_REL);
const WEBHOOK_ROUTE_ABS = join(root, WEBHOOK_ROUTE_REL);

const REPO_ID = 9_001_250;
const INSTALL_ID = 7_700_001;
const ISSUE_NUMBER = 26;
const PROJECT_ID = "prj_hnr_smoke";
const WEBHOOK_SECRET = "ypi-hnr-prod-smoke-webhook-secret";
const APP_ID = "9001250";

const REAL_HOME = process.env.HOME ?? null;
const REAL_USERPROFILE = process.env.USERPROFILE ?? null;
const REAL_AGENT_DIR = process.env.PI_CODING_AGENT_DIR ?? null;
const REAL_FETCH = globalThis.fetch;
const REAL_NEXT_RUNTIME = process.env.NEXT_RUNTIME;
const REAL_APP_ID = process.env.YPI_GITHUB_APP_ID ?? null;
const REAL_APP_KEY_FILE = process.env.YPI_GITHUB_APP_PRIVATE_KEY_FILE ?? null;
const REAL_APP_WEBHOOK = process.env.YPI_GITHUB_APP_WEBHOOK_SECRET ?? null;
const REAL_APP_SLUG = process.env.YPI_GITHUB_APP_SLUG ?? null;
const REAL_LEGACY_APP_ID = process.env.GITHUB_APP_ID ?? null;
const REAL_LEGACY_APP_KEY = process.env.GITHUB_APP_PRIVATE_KEY ?? null;
const REAL_LEGACY_WEBHOOK = process.env.GITHUB_APP_WEBHOOK_SECRET ?? null;
const REAL_YPI_APP_KEY = process.env.YPI_GITHUB_APP_PRIVATE_KEY ?? null;
const REAL_YPI_APP_KEY_PATH = process.env.YPI_GITHUB_APP_PRIVATE_KEY_PATH ?? null;

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function sleep(ms) {
  await new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function collectEventBlob(agentDir) {
  const eventsRoot = join(agentDir, "github-automation", "events");
  let blob = "";
  try {
    const days = await readdir(eventsRoot);
    for (const day of days) {
      if (!day.endsWith(".jsonl")) continue;
      blob += await readFile(join(eventsRoot, day), "utf8");
    }
  } catch {
    blob = "";
  }
  return blob;
}

async function assertNoUserAgentDirWrites(userAgentProbePaths) {
  for (const path of userAgentProbePaths) {
    if (await pathExists(path)) {
      fail(`unexpected write outside temp agentDir: ${path}`);
    }
  }
}

function signBody(body, secret) {
  const raw = Buffer.from(body, "utf8");
  const sig =
    "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  return { raw, sig };
}

function disarmSharedSchedulerTimers() {
  const state = globalThis.__piGithubAutomationScheduler;
  if (!state || typeof state !== "object") return;
  try {
    state.autoSchedule = false;
  } catch {
    // ignore
  }
  if (state.timer != null) {
    try {
      clearTimeout(state.timer);
    } catch {
      // ignore
    }
    state.timer = null;
  }
  state.nextWakeAtMs = null;
}

function readSchedulerSnapshot() {
  const state = globalThis.__piGithubAutomationScheduler;
  if (!state || typeof state !== "object") {
    return {
      present: false,
      started: false,
      running: false,
      lastError: null,
      lastTickAt: null,
      wakeGeneration: 0,
      timerArmed: false,
    };
  }
  return {
    present: true,
    started: state.started === true,
    running: state.running === true,
    lastError:
      typeof state.lastError === "string" || state.lastError === null
        ? state.lastError
        : String(state.lastError),
    lastTickAt:
      typeof state.lastTickAt === "string" || state.lastTickAt === null
        ? state.lastTickAt
        : String(state.lastTickAt),
    wakeGeneration:
      typeof state.wakeGeneration === "number" ? state.wakeGeneration : 0,
    timerArmed: state.timer != null,
  };
}

function issueOpenedPayload() {
  return {
    action: "opened",
    installation: { id: INSTALL_ID },
    repository: {
      id: REPO_ID,
      // Malformed on purpose: passes webhook ingress (allowlist is by
      // repositoryId) but the real analysis handler blocks with
      // malformed_full_name before any GitHub/model network call.
      full_name: "not-a-valid-full-name",
      name: "hnr-smoke",
      owner: { login: "acme", id: 1, type: "Organization" },
    },
    issue: {
      number: ISSUE_NUMBER,
      title: "production smoke fixture",
      body: "deterministic pre-network analysis fixture",
      state: "open",
      updated_at: "2026-07-30T00:00:00.000Z",
      user: { login: "alice", id: 42, type: "User" },
      labels: [],
    },
    sender: { login: "alice", id: 42, type: "User" },
  };
}

async function main() {
  if (!(await pathExists(INSTRUMENTATION_ABS))) {
    fail(
      `missing production artifact ${INSTRUMENTATION_REL}. Run \`npm run build\` first (never bare next build).`,
    );
  }
  if (!(await pathExists(WEBHOOK_ROUTE_ABS))) {
    fail(
      `missing production artifact ${WEBHOOK_ROUTE_REL}. Run \`npm run build\` first (never bare next build).`,
    );
  }
  if (!(await pathExists(join(root, ".next", "BUILD_ID")))) {
    fail("missing .next/BUILD_ID — production build incomplete");
  }

  const agentDir = await mkdtemp(join(tmpdir(), "ypi-gha-prod-smoke-"));
  const repoRoot = join(agentDir, "repo-fixture");
  const automationRoot = join(agentDir, "github-automation");
  const jobsDir = join(automationRoot, "jobs");
  const configPath = join(automationRoot, "config.json");
  const privateKeyPath = join(agentDir, "smoke-app.pem");

  // Operator-dir probes: if PI_CODING_AGENT_DIR was unset, getAgentDir would
  // resolve under HOME. Keep HOME/USERPROFILE on the temp root and assert only
  // smoke-unique paths (never pre-existing operator config/jobs).
  const realHomeProbe = REAL_HOME
    ? join(REAL_HOME, ".pi", "agent", "github-automation", ".hnr-smoke-probe")
    : null;
  const defaultAgentJobsDir = REAL_HOME
    ? join(REAL_HOME, ".pi", "agent", "github-automation", "jobs")
    : null;

  // Isolate env BEFORE loading any built production modules.
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.HOME = agentDir;
  process.env.USERPROFILE = agentDir;
  process.env.NEXT_RUNTIME = "nodejs";

  for (const key of [
    "YPI_GITHUB_APP_ID",
    "YPI_GITHUB_APP_PRIVATE_KEY",
    "YPI_GITHUB_APP_PRIVATE_KEY_PATH",
    "YPI_GITHUB_APP_PRIVATE_KEY_FILE",
    "YPI_GITHUB_APP_WEBHOOK_SECRET",
    "YPI_GITHUB_APP_SLUG",
    "GITHUB_APP_ID",
    "GITHUB_APP_PRIVATE_KEY",
    "GITHUB_APP_WEBHOOK_SECRET",
  ]) {
    delete process.env[key];
  }

  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  await writeFile(privateKeyPath, privateKey, { encoding: "utf8", mode: 0o600 });
  process.env.YPI_GITHUB_APP_ID = APP_ID;
  process.env.YPI_GITHUB_APP_PRIVATE_KEY_FILE = privateKeyPath;
  process.env.YPI_GITHUB_APP_WEBHOOK_SECRET = WEBHOOK_SECRET;

  /** @type {number} */
  let networkAttempts = 0;
  globalThis.fetch = async () => {
    networkAttempts += 1;
    throw new Error("network_forbidden_in_production_smoke");
  };

  const nowIso = new Date().toISOString();

  await mkdir(repoRoot, { recursive: true, mode: 0o700 });
  await writeFile(join(repoRoot, "README.md"), "# smoke fixture\n", {
    encoding: "utf8",
    mode: 0o600,
  });
  await mkdir(jobsDir, { recursive: true, mode: 0o700 });
  await mkdir(join(automationRoot, "events"), { recursive: true, mode: 0o700 });

  // Enabled + unpaused so the production scheduler may lease. Config fullName
  // stays valid for allowlist parsing; the webhook payload full_name is the
  // malformed sentinel that terminates the real handler pre-network.
  const config = {
    schemaVersion: 2,
    enabled: true,
    paused: false,
    repositories: [
      {
        repositoryId: REPO_ID,
        fullName: "acme/hnr-smoke",
        installationId: INSTALL_ID,
        projectId: PROJECT_ID,
        projectRoot: repoRoot,
      },
    ],
    analysis: { maxConcurrency: 1 },
    revision: "rev_hnr_prod_smoke",
    updatedAt: nowIso,
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });

  console.log(`• production instrumentation: ${INSTRUMENTATION_REL}`);
  console.log(`• production webhook route: ${WEBHOOK_ROUTE_REL}`);
  console.log(`• temp PI_CODING_AGENT_DIR=${agentDir}`);

  // 1) Load and register the real built instrumentation entry first so the
  //    startup bundle seeds the shared global registry/scheduler.
  const instrumentationExport = await require(INSTRUMENTATION_ABS);
  const register =
    typeof instrumentationExport?.register === "function"
      ? instrumentationExport.register
      : typeof instrumentationExport?.default?.register === "function"
        ? instrumentationExport.default.register
        : null;
  assert.equal(
    typeof register,
    "function",
    "built instrumentation register() missing",
  );

  console.log("• invoking built instrumentation register()");
  await register();

  // Wait until the startup ensure has observed the durable queue (started
  // flag and/or first tick). Do not depend on generated chunk/module ids.
  const startupDeadline = Date.now() + 8_000;
  let startupSnap = readSchedulerSnapshot();
  while (Date.now() < startupDeadline) {
    startupSnap = readSchedulerSnapshot();
    if (startupSnap.present && (startupSnap.started || startupSnap.lastTickAt)) {
      break;
    }
    // Also accept timer-armed state once global scheduler exists.
    if (startupSnap.present && startupSnap.timerArmed) break;
    await sleep(50);
  }
  startupSnap = readSchedulerSnapshot();
  assert.equal(
    startupSnap.present,
    true,
    "instrumentation register did not create shared scheduler state",
  );
  console.log(
    `• after instrumentation: started=${startupSnap.started} timerArmed=${startupSnap.timerArmed} lastError=${startupSnap.lastError ?? "null"}`,
  );

  // 2) Load the real Webpack production webhook route only after instrumentation.
  const routeModuleExport = await require(WEBHOOK_ROUTE_ABS);
  assert.equal(
    typeof routeModuleExport?.routeModule?.userland?.POST,
    "function",
    "production webhook route userland.POST missing",
  );
  const POST = routeModuleExport.routeModule.userland.POST;

  const deliveryId = `del_hnr_prod_smoke_${Date.now().toString(36)}`;
  const body = JSON.stringify(issueOpenedPayload());
  const { raw, sig } = signBody(body, WEBHOOK_SECRET);
  const request = new Request(
    "http://127.0.0.1/api/github-automation/webhook",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "x-github-event": "issues",
        "x-github-delivery": deliveryId,
        "x-hub-signature-256": sig,
      },
      body: raw,
    },
  );

  console.log("• invoking production webhook POST (signed human issues.opened)");
  const response = await POST(request);
  assert.ok(response, "POST returned no response");
  const status = response.status ?? 0;
  let bodyText = "";
  try {
    bodyText = await response.text();
  } catch {
    bodyText = "";
  }
  let bodyJson = null;
  try {
    bodyJson = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    bodyJson = null;
  }
  console.log(
    `• POST status=${status} ok=${bodyJson?.ok ?? "n/a"} code=${bodyJson?.code ?? "n/a"} jobId=${bodyJson?.jobId ?? "n/a"}`,
  );
  assert.equal(
    status,
    202,
    `expected webhook 202, got ${status}: ${bodyText.slice(0, 300)}`,
  );
  assert.equal(bodyJson?.ok, true, `webhook body not ok: ${bodyText.slice(0, 300)}`);
  assert.equal(
    bodyJson?.code,
    "enqueued",
    `expected enqueued, got ${bodyJson?.code}: ${bodyText.slice(0, 300)}`,
  );
  assert.equal(
    typeof bodyJson?.jobId,
    "string",
    `missing jobId in 202 response: ${bodyText.slice(0, 300)}`,
  );
  const jobId = bodyJson.jobId;
  const jobPath = join(jobsDir, `${jobId}.json`);
  assert.equal(
    resolve(jobPath).startsWith(resolve(agentDir) + "/") ||
      resolve(jobPath) === resolve(agentDir),
    true,
    "job path escaped temp agentDir",
  );

  // Wait for the webhook-bundle scheduler + real analysis handler to settle.
  const deadline = Date.now() + 20_000;
  let finalJob = null;
  while (Date.now() < deadline) {
    if (await pathExists(jobPath)) {
      finalJob = await readJson(jobPath);
      if (
        typeof finalJob.attempt === "number" &&
        finalJob.attempt >= 1 &&
        finalJob.status !== "running" &&
        finalJob.status !== "queued" &&
        finalJob.status !== "retry_due"
      ) {
        break;
      }
    }
    await sleep(100);
  }
  assert.ok(finalJob, `job file missing under temp agentDir: ${jobId}`);
  console.log(
    `• settled status=${finalJob.status} phase=${finalJob.phase} attempt=${finalJob.attempt} reason=${finalJob.reasonCode}`,
  );

  const schedulerSnap = readSchedulerSnapshot();
  console.log(
    `• scheduler lastError=${schedulerSnap.lastError ?? "null"} wakeGeneration=${schedulerSnap.wakeGeneration}`,
  );

  assert.ok(
    finalJob.attempt >= 1,
    `expected real handler lease (attempt>=1), got attempt=${finalJob.attempt}`,
  );
  assert.notEqual(
    finalJob.reasonCode,
    "handler_not_ready",
    "production path still produced handler_not_ready",
  );
  assert.notEqual(
    finalJob.reasonCode,
    "analysis_handler_initialization_failed",
    "production path still produced analysis_handler_initialization_failed on job",
  );
  assert.notEqual(
    schedulerSnap.lastError,
    "analysis_handler_initialization_failed",
    "shared scheduler lastError is analysis_handler_initialization_failed (cross-bundle readiness regression)",
  );
  // Deterministic pre-network terminal from the real analysis handler.
  assert.equal(
    finalJob.reasonCode,
    "malformed_full_name",
    `expected malformed_full_name from real handler, got ${finalJob.reasonCode}`,
  );
  assert.equal(finalJob.status, "blocked");

  const events = await collectEventBlob(agentDir);
  assert.equal(
    events.includes("handler_not_ready"),
    false,
    "events still contain handler_not_ready",
  );
  assert.equal(
    events.includes("default_handler_defensive_fallback"),
    false,
    "events still contain default_handler_defensive_fallback",
  );
  assert.equal(
    events.includes("analysis_handler_initialization_failed"),
    false,
    "events still contain analysis_handler_initialization_failed",
  );
  assert.equal(
    events.includes("job_started"),
    true,
    "expected job_started from real lease path",
  );
  assert.equal(
    events.includes("delivery_enqueued"),
    true,
    "expected delivery_enqueued from webhook enqueue path",
  );
  assert.equal(events.includes(jobId), true, "events missing job id");

  assert.equal(
    networkAttempts,
    0,
    `production smoke must not call fetch (attempts=${networkAttempts})`,
  );

  const probes = [
    realHomeProbe,
    defaultAgentJobsDir
      ? join(defaultAgentJobsDir, `${jobId}.json`)
      : null,
  ].filter(Boolean);
  await assertNoUserAgentDirWrites(probes);

  console.log("\nHNR production runtime smoke passed");
  console.log(`  entries: ${INSTRUMENTATION_REL} → ${WEBHOOK_ROUTE_REL}`);
  console.log(`  job: ${jobId}`);
  console.log(
    `  final: status=${finalJob.status} reason=${finalJob.reasonCode} attempt=${finalJob.attempt}`,
  );
  console.log(`  networkAttempts=${networkAttempts}`);
  console.log(`  temp agentDir cleaned best-effort`);

  // Best-effort cleanup; leave dir if rm fails so operators can inspect.
  try {
    await rm(agentDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.stack || err.message : err);
    process.exitCode = 1;
  })
  .finally(() => {
    disarmSharedSchedulerTimers();
    if (REAL_HOME == null) delete process.env.HOME;
    else process.env.HOME = REAL_HOME;
    if (REAL_USERPROFILE == null) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = REAL_USERPROFILE;
    if (REAL_AGENT_DIR == null) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = REAL_AGENT_DIR;
    if (REAL_NEXT_RUNTIME == null) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = REAL_NEXT_RUNTIME;

    const restoreEnv = (key, value) => {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    };
    restoreEnv("YPI_GITHUB_APP_ID", REAL_APP_ID);
    restoreEnv("YPI_GITHUB_APP_PRIVATE_KEY_FILE", REAL_APP_KEY_FILE);
    restoreEnv("YPI_GITHUB_APP_WEBHOOK_SECRET", REAL_APP_WEBHOOK);
    restoreEnv("YPI_GITHUB_APP_SLUG", REAL_APP_SLUG);
    restoreEnv("YPI_GITHUB_APP_PRIVATE_KEY", REAL_YPI_APP_KEY);
    restoreEnv("YPI_GITHUB_APP_PRIVATE_KEY_PATH", REAL_YPI_APP_KEY_PATH);
    restoreEnv("GITHUB_APP_ID", REAL_LEGACY_APP_ID);
    restoreEnv("GITHUB_APP_PRIVATE_KEY", REAL_LEGACY_APP_KEY);
    restoreEnv("GITHUB_APP_WEBHOOK_SECRET", REAL_LEGACY_WEBHOOK);

    if (typeof REAL_FETCH === "function") {
      globalThis.fetch = REAL_FETCH;
    }
  });
