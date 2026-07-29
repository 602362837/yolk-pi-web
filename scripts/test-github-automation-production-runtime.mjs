/**
 * HNR-04 — Production-artifact runtime smoke for GitHub Issue Analysis.
 *
 * Proves the cold `.next` production bundle selects the real analysis handler
 * on the first retry_due job, never emits handler_not_ready /
 * default_handler_defensive_fallback, and never reaches real network or the
 * operator's agent directory.
 *
 * Prerequisites:
 *   npm run build   # must produce a fresh .next (do not use bare next build)
 *
 * Run:
 *   npm run test:github-automation-production-runtime
 *
 * This script intentionally loads only the built route under `.next/`. It does
 * not import source TypeScript via jiti, and a static bundle string search is
 * not accepted as a substitute for the assertions below.
 */

import assert from "node:assert/strict";
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

const ROUTE_REL =
  ".next/server/app/api/github-automation/jobs/[jobId]/route.js";
const ROUTE_ABS = join(root, ROUTE_REL);

const REPO_ID = 9_001_250;
const INSTALL_ID = 7_700_001;
const ISSUE_NUMBER = 25;
const JOB_ID = `job_${REPO_ID}_${ISSUE_NUMBER}_g1_hnrsmoke`;
const PROJECT_ID = "prj_hnr_smoke";

const REAL_HOME = process.env.HOME ?? null;
const REAL_USERPROFILE = process.env.USERPROFILE ?? null;
const REAL_AGENT_DIR = process.env.PI_CODING_AGENT_DIR ?? null;
const REAL_FETCH = globalThis.fetch;

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

async function main() {
  if (!(await pathExists(ROUTE_ABS))) {
    fail(
      `missing production artifact ${ROUTE_REL}. Run \`npm run build\` first (never bare next build).`,
    );
  }
  if (!(await pathExists(join(root, ".next", "BUILD_ID")))) {
    fail("missing .next/BUILD_ID — production build incomplete");
  }

  const agentDir = await mkdtemp(join(tmpdir(), "ypi-gha-prod-smoke-"));
  const repoRoot = join(agentDir, "repo-fixture");
  const automationRoot = join(agentDir, "github-automation");
  const jobsDir = join(automationRoot, "jobs");
  const jobPath = join(jobsDir, `${JOB_ID}.json`);
  const configPath = join(automationRoot, "config.json");

  // Operator-dir probes: if PI_CODING_AGENT_DIR was unset, getAgentDir would
  // resolve under HOME. Keep HOME/USERPROFILE on the temp root and assert the
  // real home never receives github-automation writes.
  const realHomeProbe = REAL_HOME
    ? join(REAL_HOME, ".pi", "agent", "github-automation", ".hnr-smoke-probe")
    : null;
  const defaultAgentProbe = REAL_HOME
    ? join(REAL_HOME, ".pi", "agent", "github-automation", "jobs", `${JOB_ID}.json`)
    : null;

  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.HOME = agentDir;
  process.env.USERPROFILE = agentDir;
  // Keep App credential env empty so no real JWT/installation path is taken.
  for (const key of [
    "YPI_GITHUB_APP_ID",
    "YPI_GITHUB_APP_PRIVATE_KEY",
    "YPI_GITHUB_APP_PRIVATE_KEY_PATH",
    "YPI_GITHUB_APP_WEBHOOK_SECRET",
    "GITHUB_APP_ID",
    "GITHUB_APP_PRIVATE_KEY",
    "GITHUB_APP_WEBHOOK_SECRET",
  ]) {
    delete process.env[key];
  }

  /** @type {number} */
  let networkAttempts = 0;
  globalThis.fetch = async () => {
    networkAttempts += 1;
    throw new Error("network_forbidden_in_production_smoke");
  };

  const nowIso = new Date().toISOString();
  const overdueRetryAt = new Date(Date.now() - 60_000).toISOString();

  await mkdir(repoRoot, { recursive: true, mode: 0o700 });
  await writeFile(join(repoRoot, "README.md"), "# smoke fixture\n", {
    encoding: "utf8",
    mode: 0o600,
  });
  await mkdir(jobsDir, { recursive: true, mode: 0o700 });
  await mkdir(join(automationRoot, "events"), { recursive: true, mode: 0o700 });

  // Enabled + unpaused so the production scheduler may lease. Repository is
  // allowlisted, but the job's repositoryFullName is intentionally malformed so
  // the real analysis handler terminates before any GitHub/model network call.
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

  const initialJob = {
    schemaVersion: 2,
    kind: "issue_analysis",
    jobId: JOB_ID,
    repositoryId: REPO_ID,
    // Malformed on purpose: real handler blocks with malformed_full_name and
    // never reaches fetchIssue / model / comment / close.
    repositoryFullName: "not-a-valid-full-name",
    issueNumber: ISSUE_NUMBER,
    installationId: INSTALL_ID,
    phase: "received",
    status: "retry_due",
    generation: 1,
    attempt: 1,
    deliveryId: "del_hnr_prod_smoke",
    issueTitlePreview: "production smoke fixture",
    issueContentHash: null,
    issueUpdatedAt: null,
    resultId: null,
    resultHash: null,
    category: null,
    verdict: null,
    confidence: null,
    completeness: null,
    budgetExceeded: null,
    traceId: "tr_hnr_prod_smoke",
    createdAt: nowIso,
    updatedAt: nowIso,
    nextRetryAt: overdueRetryAt,
    leaseOwner: null,
    leaseExpiresAt: null,
    leaseFencingToken: null,
    leaseHeartbeatAt: null,
    reasonCode: "handler_not_ready",
    retryability: "automatic",
    effects: [],
    checkpoint: "received",
    progressRevision: 0,
    noProgressRunCount: 0,
  };
  await writeFile(jobPath, `${JSON.stringify(initialJob, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });

  console.log(`• production route artifact present: ${ROUTE_REL}`);
  console.log(`• temp PI_CODING_AGENT_DIR=${agentDir}`);

  // Load the real Webpack production route module (async module graph).
  const routeModuleExport = await require(ROUTE_ABS);
  assert.equal(
    typeof routeModuleExport?.routeModule?.userland?.POST,
    "function",
    "production route userland.POST missing",
  );
  const POST = routeModuleExport.routeModule.userland.POST;

  const request = new Request(
    `http://127.0.0.1/api/github-automation/jobs/${encodeURIComponent(JOB_ID)}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ action: "retry" }),
    },
  );

  console.log("• invoking production POST retry via .next route userland");
  const response = await POST(request, {
    params: Promise.resolve({ jobId: JOB_ID }),
  });
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
  console.log(`• POST status=${status} ok=${bodyJson?.ok ?? "n/a"} code=${bodyJson?.code ?? "n/a"}`);
  assert.equal(status, 200, `expected retry 200, got ${status}: ${bodyText.slice(0, 300)}`);
  assert.equal(bodyJson?.ok, true, `retry body not ok: ${bodyText.slice(0, 300)}`);

  // Wait for the production scheduler + real analysis handler to settle.
  const deadline = Date.now() + 20_000;
  let finalJob = null;
  while (Date.now() < deadline) {
    finalJob = await readJson(jobPath);
    if (
      typeof finalJob.attempt === "number" &&
      finalJob.attempt > 1 &&
      finalJob.status !== "running" &&
      finalJob.status !== "queued"
    ) {
      break;
    }
    await sleep(100);
  }
  assert.ok(finalJob, "job file disappeared");
  console.log(
    `• settled status=${finalJob.status} phase=${finalJob.phase} attempt=${finalJob.attempt} reason=${finalJob.reasonCode}`,
  );

  assert.ok(
    finalJob.attempt > 1,
    `expected real handler lease (attempt>1), got attempt=${finalJob.attempt}`,
  );
  assert.notEqual(
    finalJob.reasonCode,
    "handler_not_ready",
    "production path still produced handler_not_ready",
  );
  assert.notEqual(
    finalJob.status,
    "retry_due",
    "job still retry_due after real handler path (possible timer/handler regression)",
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
    events.includes("job_started"),
    true,
    "expected job_started from real lease path",
  );
  assert.equal(
    events.includes(JOB_ID),
    true,
    "events missing job id",
  );

  assert.equal(
    networkAttempts,
    0,
    `production smoke must not call fetch (attempts=${networkAttempts})`,
  );

  const probes = [realHomeProbe, defaultAgentProbe].filter(Boolean);
  await assertNoUserAgentDirWrites(probes);

  // Guard: job file must live only under the temp agentDir.
  assert.equal(
    resolve(jobPath).startsWith(resolve(agentDir)),
    true,
    "job path escaped temp agentDir",
  );

  console.log("\nHNR production runtime smoke passed");
  console.log(`  artifact: ${ROUTE_REL}`);
  console.log(`  job: ${JOB_ID}`);
  console.log(`  final: status=${finalJob.status} reason=${finalJob.reasonCode} attempt=${finalJob.attempt}`);
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
    if (REAL_HOME == null) delete process.env.HOME;
    else process.env.HOME = REAL_HOME;
    if (REAL_USERPROFILE == null) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = REAL_USERPROFILE;
    if (REAL_AGENT_DIR == null) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = REAL_AGENT_DIR;
    if (typeof REAL_FETCH === "function") {
      globalThis.fetch = REAL_FETCH;
    }
  });
