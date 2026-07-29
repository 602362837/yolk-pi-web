/**
 * GIA-01 focused contracts: v2 config, migration, legacy job retirement, scheduler hard skip.
 *
 * Run:
 *   node --loader ./scripts/ts-extension-loader.mjs --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *     scripts/test-github-automation-gia01.mjs
 */

import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(join(root, "package.json"), { interopDefault: true });
const agentDir = await mkdtemp(join(tmpdir(), "ypi-gia01-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

const types = jiti(join(root, "lib/github-automation-types.ts"));
const config = jiti(join(root, "lib/github-automation-config.ts"));
const migration = jiti(join(root, "lib/github-automation-migration.ts"));
const store = jiti(join(root, "lib/github-automation-store.ts"));
const scheduler = jiti(join(root, "lib/github-automation-scheduler.ts"));
const errors = jiti(join(root, "lib/github-automation-errors.ts"));

let passed = 0;
async function test(name, fn) {
  process.stdout.write(`• ${name} ... `);
  await fn();
  passed += 1;
  process.stdout.write("ok\n");
}

await test("fresh default config is schema v2, disabled, no closed-loop fields", () => {
  const cfg = config.createDefaultGithubAutomationConfig("2026-07-29T00:00:00.000Z");
  assert.equal(cfg.schemaVersion, 2);
  assert.equal(types.GITHUB_AUTOMATION_CONFIG_SCHEMA_VERSION, 2);
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.paused, false);
  assert.deepEqual(cfg.repositories, []);
  assert.equal(cfg.analysis.maxConcurrency, 2);
  assert.equal("mode" in cfg, false);
  assert.equal("unattended" in cfg, false);
  assert.equal("triage" in cfg, false);
  const safe = config.toGithubAutomationConfigSafeProjection(cfg);
  assert.equal(safe.schemaVersion, 2);
  assert.equal("mode" in safe, false);
  assert.equal("unattended" in safe, false);
  assert.equal("projectRoot" in (safe.repositories[0] ?? {}), false);
});

await test("normalize rejects unknown schema without writing", async () => {
  await assert.rejects(
    async () =>
      config.normalizeGithubAutomationConfig({
        schemaVersion: 99,
        enabled: true,
        paused: false,
        repositories: [],
        analysis: { maxConcurrency: 2 },
      }),
    (err) =>
      err instanceof errors.GithubAutomationError &&
      err.code === "invalid_config",
  );
  assert.equal(await config.githubAutomationConfigExists(), false);
});

await test("normalize rejects retired closed-loop fields on v2", () => {
  assert.throws(
    () =>
      config.normalizeGithubAutomationConfig({
        schemaVersion: 2,
        enabled: false,
        mode: "triage",
        paused: false,
        repositories: [],
        analysis: { maxConcurrency: 2 },
      }),
    (err) => err instanceof errors.GithubAutomationError,
  );
});

await test("v2 repository requires installationId + projectId", () => {
  assert.throws(
    () =>
      config.normalizeGithubAutomationConfig({
        schemaVersion: 2,
        enabled: false,
        paused: false,
        repositories: [
          {
            repositoryId: 1,
            fullName: "acme/demo",
            installationId: 9,
            projectId: null,
            projectRoot: "",
          },
        ],
        analysis: { maxConcurrency: 2 },
      }),
    (err) => err instanceof errors.GithubAutomationError,
  );
});

await test("v1 config migrates to disabled v2 with backup and preserves complete bindings", async () => {
  const automationDir = join(agentDir, "github-automation");
  await mkdir(automationDir, { recursive: true, mode: 0o700 });
  const v1 = {
    schemaVersion: 1,
    enabled: true,
    mode: "unattended",
    paused: false,
    repositories: [
      {
        repositoryId: 424242,
        fullName: "acme/demo-repo",
        installationId: 99,
        projectId: "prj_demo",
        projectRoot: "/tmp/server-only/demo",
        ownerActorIds: [7],
        assigneeIdentitySource: "machine-active-credential",
        baseRef: "main",
      },
      {
        // incomplete binding dropped
        repositoryId: 1,
        fullName: "acme/incomplete",
        installationId: null,
        projectId: null,
        projectRoot: "",
        ownerActorIds: [],
        assigneeIdentitySource: "machine-active-credential",
        baseRef: "main",
      },
    ],
    triage: { maxConcurrency: 3 },
    unattended: {
      enabled: true,
      executionProfile: "full-agent",
      riskProfile: "docs-and-small-bugfix",
      maxConcurrency: 1,
      maxFiles: 12,
      maxChangedLines: 500,
      validationCommands: ["npm run lint"],
    },
    revision: "deadbeef",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  await writeFile(
    join(automationDir, "config.json"),
    `${JSON.stringify(v1, null, 2)}\n`,
    { mode: 0o600 },
  );

  const migrated = await config.readGithubAutomationConfig();
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.enabled, false, "migration forces disabled");
  assert.equal(migrated.repositories.length, 1);
  assert.equal(migrated.repositories[0].repositoryId, 424242);
  assert.equal(migrated.repositories[0].installationId, 99);
  assert.equal(migrated.repositories[0].projectId, "prj_demo");
  assert.equal(migrated.repositories[0].projectRoot, "/tmp/server-only/demo");
  assert.equal(migrated.analysis.maxConcurrency, 3);
  assert.equal("mode" in migrated, false);
  assert.equal("unattended" in migrated, false);

  assert.equal(await migration.githubAutomationConfigV1RetirementBackupExists(), true);
  const backupRaw = JSON.parse(
    await readFile(migration.getGithubAutomationConfigV1RetirementBackupPath(), "utf8"),
  );
  assert.equal(backupRaw.schemaVersion, 1);
  assert.equal(backupRaw.enabled, true);
  assert.equal(backupRaw.mode, "unattended");

  // Idempotent second read — stays v2 disabled with same binding.
  const again = await config.readGithubAutomationConfig();
  assert.equal(again.schemaVersion, 2);
  assert.equal(again.enabled, false);
  assert.equal(again.repositories.length, 1);
  assert.equal(again.repositories[0].repositoryId, 424242);
  assert.equal(again.analysis.maxConcurrency, migrated.analysis.maxConcurrency);
  assert.equal(again.revision, migrated.revision);
});

await test("unknown future schema fails closed and does not overwrite", async () => {
  const automationDir = join(agentDir, "github-automation");
  const future = {
    schemaVersion: 9,
    enabled: true,
    paused: false,
    repositories: [],
    analysis: { maxConcurrency: 2 },
    revision: "future",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const path = join(automationDir, "config.json");
  await writeFile(path, `${JSON.stringify(future, null, 2)}\n`, { mode: 0o600 });
  await assert.rejects(
    () => config.readGithubAutomationConfig(),
    (err) =>
      err instanceof errors.GithubAutomationError &&
      err.code === "invalid_config",
  );
  const onDisk = JSON.parse(await readFile(path, "utf8"));
  assert.equal(onDisk.schemaVersion, 9);
  assert.equal(onDisk.enabled, true);
});

await test("createQueued job is schema v2 kind=issue_analysis", async () => {
  // restore a valid v2 config for store ops
  await config.writeGithubAutomationConfig(
    config.createDefaultGithubAutomationConfig(),
  );
  const job = await store.createQueuedGithubAutomationJob({
    repositoryId: 11,
    repositoryFullName: "acme/demo",
    issueNumber: 3,
    installationId: 22,
    deliveryId: "d1",
    issueTitlePreview: "hello",
  });
  assert.equal(job.schemaVersion, 2);
  assert.equal(job.kind, "issue_analysis");
  assert.equal(job.phase, "received");
  assert.equal(job.status, "queued");
  assert.equal(job.generation, 1);
  assert.equal(store.isGithubIssueAnalysisJobSchedulable(job), true);
  assert.equal(store.isLegacyGithubAutomationJob(job), false);
});

await test("legacy v1 jobs never schedulable and get retirement sidecar", async () => {
  const jobsDir = join(agentDir, "github-automation", "jobs");
  await mkdir(jobsDir, { recursive: true, mode: 0o700 });
  const legacyJob = {
    schemaVersion: 1,
    jobId: "job_legacy_1_1_g1_deadbeef",
    repositoryId: 1,
    repositoryFullName: "acme/legacy",
    issueNumber: 1,
    installationId: 2,
    phase: "implementing",
    status: "queued",
    generation: 1,
    attempt: 0,
    deliveryId: "d-legacy",
    issueTitlePreview: "legacy",
    traceId: "tracelegacy",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    nextRetryAt: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    reasonCode: null,
    effects: [],
    checkpoint: "implementing",
  };
  await writeFile(
    join(jobsDir, `${legacyJob.jobId}.json`),
    `${JSON.stringify(legacyJob, null, 2)}\n`,
    { mode: 0o600 },
  );

  assert.equal(store.isGithubIssueAnalysisJobSchedulable(legacyJob), false);
  assert.equal(store.isLegacyGithubAutomationJob(legacyJob), true);

  const retired1 = await migration.retireLegacyGithubAutomationJobs();
  assert.ok(retired1.retired >= 1);
  const sidecar = await migration.readGithubAutomationJobRetirementSidecar(
    legacyJob.jobId,
  );
  assert.ok(sidecar);
  assert.equal(sidecar.reason, "legacy_pipeline_retired");
  assert.equal(sidecar.originalStatus, "queued");

  // Original job file untouched
  const original = JSON.parse(
    await readFile(join(jobsDir, `${legacyJob.jobId}.json`), "utf8"),
  );
  assert.equal(original.status, "queued");
  assert.equal(original.phase, "implementing");
  assert.equal(original.schemaVersion, 1);

  // Idempotent retirement
  const retired2 = await migration.retireLegacyGithubAutomationJobs();
  assert.equal(retired2.retired, 0);
  assert.ok(retired2.alreadyRetired >= 1);
});

await test("scheduler hard-skips legacy jobs (0 lease) when enabled", async () => {
  // Write enabled v2 config with empty allowlist still ok for tick selection
  const current = await config.readGithubAutomationConfig();
  await config.writeGithubAutomationConfig({
    ...current,
    enabled: true,
    paused: false,
    analysis: { maxConcurrency: 2 },
  });

  scheduler._testResetGithubAutomationScheduler();
  scheduler._testSetGithubAutomationSchedulerAuto(false);
  scheduler.setGithubAutomationJobHandler(async (job) => {
    throw new Error(`handler must not run for ${job.jobId}`);
  });

  const tick = await scheduler.tickGithubAutomationScheduler();
  // Legacy jobs scanned but not started; any analysis job may start — ensure no throw.
  assert.ok(typeof tick.started === "number");
  // Ensure legacy job still queued unmodified
  const legacy = await store.readGithubAutomationJob("job_legacy_1_1_g1_deadbeef");
  assert.ok(legacy);
  assert.equal(legacy.status, "queued");
  assert.equal(legacy.attempt, 0);
  assert.equal(legacy.leaseOwner, null);
});

await test("safe projection never includes projectRoot or closed-loop fields", async () => {
  const written = await config.writeGithubAutomationConfig({
    schemaVersion: 2,
    enabled: false,
    paused: false,
    repositories: [
      {
        repositoryId: 55,
        fullName: "acme/safe",
        installationId: 77,
        projectId: "prj_safe",
        projectRoot: "/var/secret/root",
      },
    ],
    analysis: { maxConcurrency: 2 },
    updatedAt: new Date().toISOString(),
  });
  const safe = config.toGithubAutomationConfigSafeProjection(written);
  const json = JSON.stringify(safe);
  assert.ok(!json.includes("/var/secret/root"));
  // May include projectRootConfigured boolean; never absolute path or path field.
  assert.equal("projectRoot" in safe.repositories[0], false);
  assert.equal("baseRef" in safe.repositories[0], false);
  assert.equal("ownerActorIds" in safe.repositories[0], false);
  assert.equal("unattended" in safe, false);
  assert.equal("mode" in safe, false);
  assert.equal(safe.repositories[0].projectId, "prj_safe");
  assert.equal(safe.repositories[0].installationId, 77);
  assert.equal(safe.repositories[0].projectRootConfigured, true);
  assert.ok(json.includes("projectRootConfigured"));
});

console.log(`\nGIA-01 focused suite: ${passed} passed`);
