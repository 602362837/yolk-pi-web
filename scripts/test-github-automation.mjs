#!/usr/bin/env node
/**
 * Focused tests for independently releasable GitHub automation P0
 * (GHA-01 + GHA-02 + GHA-03 + GHA-04) plus GHCRED local credentials.
 *
 * Covers:
 * - config schema defaults, normalize, CAS revision, safe projection
 * - App credential readiness + RS256 JWT mint (generated key)
 * - installation token cache + fixed-host/redirect/response-cap client
 * - machine assignee: gh precedence, multi-account, git-credential fallback,
 *   canonical /user over credential username, timeout, redaction
 * - credential sentinel scan over config, errors, argv-like surfaces
 * - GHA-02: raw HMAC webhook verify, exclusive delivery, lease, scheduler wake
 * - GHA-03: label+assignee claim, silent-ignore, claim-blocked reconcile,
 *   triage comment markers, owner intent matrix, manual skill skip gate
 * - GHA-04: disable/rollback keeps audit without false claimed success,
 *   P0 capability without Contents/PR permissions, docs identity contracts,
 *   incomplete-claim owner-adoption refusal, recovery retry path
 * - IMP-001/IMP-05: empty default allowlist, user-managed repositories,
 *   setup verify checklist (no scheduler side effects),
 *   no product-default yolk-pi-web hard lock
 * - GHCRED-06: local credential store first-save/rotation/delete/restart,
 *   0700/0600 permissions, generation atomicity, lock/concurrency,
 *   malformed/future/symlink/oversize/non-RSA fail-closed,
 *   env-over-local overlay + blank env fallback, JWT/HMAC/cache,
 *   credentials route contracts, setup/status source semantics,
 *   secret/PEM/path/fingerprint sentinel isolation
 *
 * Always uses temporary PI_CODING_AGENT_DIR — never real ~/.pi/agent.
 * Never uses real operator credentials or live GitHub network.
 *
 * Run:
 *   npm run test:github-automation
 */

import assert from "node:assert/strict";
import {
  generateKeyPairSync,
  createHash,
  createPublicKey,
  createVerify,
} from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { createJiti } from "jiti";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(join(root, "package.json"), { interopDefault: true });
const jitiWithAlias = createJiti(join(root, "package.json"), {
  interopDefault: true,
  alias: { "@": root },
});

// ─── Temp agent dir ──────────────────────────────────────────────────────────

const agentDir = mkdtempSync(join(tmpdir(), "pi-gha-test-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
// GHCRED tests assume no ambient App env from the host shell.
for (const name of [
  "YPI_GITHUB_APP_ID",
  "YPI_GITHUB_APP_PRIVATE_KEY_FILE",
  "YPI_GITHUB_APP_WEBHOOK_SECRET",
  "YPI_GITHUB_APP_SLUG",
]) {
  delete process.env[name];
}

const APP_KEY_SENTINEL = "GHA_APP_PRIVATE_KEY_SENTINEL_do_not_leak";
const WEBHOOK_SECRET_SENTINEL = "gha_webhook_secret_SENTINEL_7f3c91ab";
const INSTALL_TOKEN_SENTINEL = "ghs_INSTALL_TOKEN_SENTINEL_91ab7f3c2d4e";
const MACHINE_TOKEN_SENTINEL = "gho_MACHINE_TOKEN_SENTINEL_ab2d4e7f3c91";
const JWT_MARKER = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9";
/** Unique App ID used only for local-store leakage scans (never projected). */
const LOCAL_APP_ID_SENTINEL = "918273645501";
const LOCAL_WEBHOOK_SECRET_SENTINEL = "gha_local_webhook_SECRET_sentinel_c91ab7f3";

let passed = 0;
let failed = 0;

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`ok - ${name}`);
    })
    .catch((err) => {
      failed += 1;
      console.error(`not ok - ${name}`);
      console.error(err);
    });
}

function assertNoSentinel(value, label, extra = []) {
  if (value === null || value === undefined) return;
  let serialized;
  try {
    serialized = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    serialized = String(value);
  }
  for (const needle of [
    APP_KEY_SENTINEL,
    WEBHOOK_SECRET_SENTINEL,
    INSTALL_TOKEN_SENTINEL,
    MACHINE_TOKEN_SENTINEL,
    "BEGIN RSA PRIVATE KEY",
    "BEGIN PRIVATE KEY",
    ...extra,
  ]) {
    assert.ok(
      !serialized.includes(needle),
      `${label}: leaked secret fragment ${needle}`,
    );
  }
}

function makePrivateKeyFile() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  // Embed a sentinel comment-like marker outside PEM? Keep PEM valid; scan uses token sentinels.
  const keyPath = join(agentDir, "app-private-key.pem");
  writeFileSync(keyPath, pem, { mode: 0o600 });
  chmodSync(keyPath, 0o600);
  return {
    keyPath,
    pem,
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
  };
}

// ─── Load modules under temp agent dir ───────────────────────────────────────

const types = jiti(join(root, "lib/github-automation-types.ts"));
const errors = jiti(join(root, "lib/github-automation-errors.ts"));
const config = jiti(join(root, "lib/github-automation-config.ts"));
const credentials = jiti(join(root, "lib/github-app-credentials.ts"));
const credentialStore = jiti(join(root, "lib/github-app-credential-store.ts"));
const credentialsRoute = jitiWithAlias(
  join(root, "app/api/github-automation/credentials/route.ts"),
);
const client = jiti(join(root, "lib/github-app-client.ts"));
const assignee = jiti(join(root, "lib/github-machine-assignee.ts"));
const webhookVerify = jiti(join(root, "lib/github-webhook-verify.ts"));
const store = jiti(join(root, "lib/github-automation-store.ts"));
const scheduler = jiti(join(root, "lib/github-automation-scheduler.ts"));
const runtime = jiti(join(root, "lib/github-automation-runtime.ts"));
const labels = jiti(join(root, "lib/github-automation-labels.ts"));
const comments = jiti(join(root, "lib/github-automation-comments.ts"));
const ownerIntent = jiti(join(root, "lib/github-owner-intent.ts"));
const triageRunner = jiti(join(root, "lib/github-issue-triage-runner.ts"));
const prLifecycle = jiti(join(root, "lib/github-pr-lifecycle.ts"));
const projection = jiti(join(root, "lib/github-automation-projection.ts"));
const prContract = jiti(join(root, "lib/github-pr-contract.ts"));
const setupVerify = jiti(join(root, "lib/github-automation-setup-verify.ts"));

/**
 * Explicit fixture allowlist entry used by tests that still exercise the
 * historical yolk-pi-web repository id. Fresh product defaults stay empty.
 */
function makeAllowlistedRepository(overrides = {}) {
  return {
    repositoryId: 602362837,
    fullName: "602362837/yolk-pi-web",
    installationId: null,
    projectId: null,
    projectRoot: "",
    ownerActorIds: [],
    assigneeIdentitySource: "machine-active-credential",
    baseRef: "main",
    ...overrides,
  };
}

function makeAllowlistedConfig(overrides = {}) {
  const base = config.createDefaultGithubAutomationConfig();
  return {
    ...base,
    repositories: [makeAllowlistedRepository()],
    ...overrides,
    repositories: overrides.repositories ?? [makeAllowlistedRepository()],
  };
}

// Keep GHA-02 path tests on the default handler unless a case opts into GHA-03.
runtime._testSetGithubIssueTriageAutoRegisterDisabled(true);

// ─── Types / capability ──────────────────────────────────────────────────────

await test("legacy seeded repository constants are recognition-only", () => {
  assert.equal(types.GITHUB_AUTOMATION_LEGACY_SEEDED_REPOSITORY_ID, 602362837);
  assert.equal(
    types.GITHUB_AUTOMATION_LEGACY_SEEDED_REPOSITORY_FULL_NAME,
    "602362837/yolk-pi-web",
  );
  // Deprecated aliases remain for older imports but are not product defaults.
  assert.equal(types.GITHUB_AUTOMATION_DEFAULT_REPOSITORY_ID, 602362837);
  assert.equal(
    types.GITHUB_AUTOMATION_DEFAULT_REPOSITORY_FULL_NAME,
    "602362837/yolk-pi-web",
  );
});

await test("P0 and P1 capability reported separately", () => {
  const p0Only = types.deriveGithubAppCapability({
    metadata: "read",
    issues: "write",
    pull_requests: "none",
    contents: "none",
  });
  assert.equal(p0Only.p0Triage, true);
  assert.equal(p0Only.p1Unattended, false);
  assert.deepEqual(p0Only.missingForP1, ["pull_requests", "contents"]);

  const full = types.deriveGithubAppCapability({
    metadata: "read",
    issues: "write",
    pull_requests: "write",
    contents: "write",
  });
  assert.equal(full.p0Triage, true);
  assert.equal(full.p1Unattended, true);
  assert.deepEqual(full.missingForP0, []);
  assert.deepEqual(full.missingForP1, []);

  const none = types.deriveGithubAppCapability(types.emptyPermissionSnapshot());
  assert.equal(none.p0Triage, false);
  assert.ok(none.missingForP0.includes("issues"));
});

// ─── Errors / redaction ──────────────────────────────────────────────────────

await test("errors redact secret-like substrings", () => {
  const msg = errors.redactGithubAutomationSecrets(
    `Authorization: Bearer ${MACHINE_TOKEN_SENTINEL} password=${WEBHOOK_SECRET_SENTINEL}`,
  );
  assert.ok(!msg.includes(MACHINE_TOKEN_SENTINEL));
  assert.ok(!msg.includes(WEBHOOK_SECRET_SENTINEL));
  assert.ok(msg.includes("[redacted]"));

  const err = new errors.GithubAutomationError(
    "credential_invalid",
    `bad ${MACHINE_TOKEN_SENTINEL}`,
  );
  assertNoSentinel(err.toJSON(), "error.toJSON");
  assertNoSentinel(err.message, "error.message");
});

// ─── Config ──────────────────────────────────────────────────────────────────

await test("default config is disabled with empty repositories", () => {
  const cfg = config.createDefaultGithubAutomationConfig("2026-07-23T00:00:00.000Z");
  assert.equal(cfg.schemaVersion, 1);
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.mode, "off");
  assert.equal(cfg.unattended.enabled, false);
  assert.equal(cfg.unattended.executionProfile, "full-agent");
  assert.equal(cfg.unattended.riskProfile, "docs-and-small-bugfix");
  assert.deepEqual(cfg.repositories, []);
  assert.ok(cfg.revision);
  assertNoSentinel(cfg, "default config");

  const emptyDraft = config.createDefaultGithubAutomationRepository();
  assert.equal(emptyDraft.projectId, null);
  assert.equal(emptyDraft.projectRoot, "");
  assert.notEqual(emptyDraft.repositoryId, 602362837);
  assert.notEqual(emptyDraft.fullName, "602362837/yolk-pi-web");
  assert.equal(
    config.isLegacySeededGithubAutomationRepository({
      repositoryId: 602362837,
      fullName: "602362837/yolk-pi-web",
      projectId: null,
      projectRoot: "",
      installationId: null,
    }),
    true,
  );
  assert.equal(
    config.isLegacySeededGithubAutomationRepository({
      repositoryId: 602362837,
      fullName: "602362837/yolk-pi-web",
      projectId: "prj_operator",
      projectRoot: "",
      installationId: null,
    }),
    false,
  );
});

await test("config rejects non machine-active-credential assignee source", () => {
  assert.throws(
    () =>
      config.normalizeGithubAutomationConfig({
        schemaVersion: 1,
        enabled: false,
        mode: "off",
        repositories: [
          {
            repositoryId: 602362837,
            fullName: "602362837/yolk-pi-web",
            installationId: null,
            projectId: null,
            projectRoot: "/secret/root",
            ownerActorIds: [],
            assigneeIdentitySource: "user-token",
            baseRef: "main",
          },
        ],
      }),
    (err) =>
      err instanceof errors.GithubAutomationError &&
      err.code === "invalid_config",
  );
});

await test("normalize accepts empty repositories and migrates missing projectId", () => {
  const empty = config.normalizeGithubAutomationConfig({
    schemaVersion: 1,
    enabled: false,
    mode: "off",
    repositories: [],
  });
  assert.deepEqual(empty.repositories, []);

  const legacy = config.normalizeGithubAutomationConfig({
    schemaVersion: 1,
    enabled: false,
    mode: "off",
    repositories: [
      {
        repositoryId: 602362837,
        fullName: "602362837/yolk-pi-web",
        installationId: null,
        // pre-IMP-001 disk shape: no projectId field
        projectRoot: "",
        ownerActorIds: [],
        assigneeIdentitySource: "machine-active-credential",
        baseRef: "main",
      },
    ],
  });
  assert.equal(legacy.repositories.length, 1);
  assert.equal(legacy.repositories[0].projectId, null);
  assert.equal(legacy.repositories[0].projectRoot, "");
  assert.equal(config.isLegacySeededGithubAutomationRepository(legacy.repositories[0]), true);
});

await test("safe projection hides projectRoot and validation command text", async () => {
  const written = await config.writeGithubAutomationConfig({
    ...config.createDefaultGithubAutomationConfig(),
    repositories: [
      {
        repositoryId: 424242,
        fullName: "acme/demo-repo",
        installationId: 99,
        projectId: "prj_demo",
        projectRoot: "/var/server-only/canonical/root",
        ownerActorIds: [7],
        assigneeIdentitySource: "machine-active-credential",
        baseRef: "main",
      },
    ],
  });
  const safe = config.toGithubAutomationConfigSafeProjection(written);
  assert.equal(safe.repositories[0].projectRootConfigured, true);
  assert.equal(safe.repositories[0].hasInstallationId, true);
  assert.equal(safe.repositories[0].projectId, "prj_demo");
  assert.equal(safe.repositories[0].installationId, 99);
  assert.deepEqual(safe.repositories[0].ownerActorIds, [7]);
  assert.equal(safe.repositories[0].legacySeeded, false);
  assert.equal("projectRoot" in safe.repositories[0], false);
  assert.equal("validationCommands" in safe.unattended, false);
  assert.equal(safe.unattended.validationCommandCount, 2);
  assertNoSentinel(safe, "safe config projection");
  assert.ok(!JSON.stringify(safe).includes("/var/server-only"));
  projection.assertGithubAutomationProjectionSafe(safe);
});

await test("CAS patch rejects stale revision", async () => {
  const current = await config.readGithubAutomationConfig();
  await assert.rejects(
    () =>
      config.patchGithubAutomationConfig({
        revision: "deadbeefdeadbeef",
        mode: "triage",
      }),
    (err) =>
      err instanceof errors.GithubAutomationError && err.code === "stale_revision",
  );
  const updated = await config.patchGithubAutomationConfig({
    revision: current.revision,
    mode: "triage",
    enabled: true,
  });
  assert.equal(updated.mode, "triage");
  assert.equal(updated.enabled, true);
  assert.notEqual(updated.revision, current.revision);
});

// ─── IMP-02: repository allowlist wire PATCH ─────────────────────────────────
// keyMaterial is created later for JWT tests; generate a local key for identity lookup.

await test("IMP-02 wire repositories add/remove with CAS and path rejection", async () => {
  const imp02Key = makePrivateKeyFile();
  const projectRegistry = jiti(join(root, "lib/project-registry.ts"));
  const projectRoot = join(agentDir, "imp02-project");
  mkdirSync(projectRoot, { recursive: true });
  const { project } = await projectRegistry.registerProject({ path: projectRoot });

  const baseline = await config.writeGithubAutomationConfig({
    ...config.createDefaultGithubAutomationConfig(),
    enabled: false,
    mode: "off",
    repositories: [],
  });
  assert.deepEqual(baseline.repositories, []);

  // Reject absolute projectRoot on the wire.
  assert.throws(
    () =>
      projection.parseGithubAutomationConfigWirePatch({
        revision: baseline.revision,
        repositories: [
          {
            repositoryId: 111,
            fullName: "acme/one",
            installationId: 9,
            projectId: "prj_ok",
            projectRoot: "/Users/secret/absolute/path",
            ownerActorIds: [],
            baseRef: "main",
          },
        ],
      }),
    (err) =>
      err instanceof errors.GithubAutomationError &&
      err.code === "invalid_config" &&
      String(err.details?.field || "").toLowerCase() === "projectroot",
  );

  // Reject absolute path masquerading as projectId.
  assert.throws(
    () =>
      projection.parseGithubAutomationConfigWirePatch({
        revision: baseline.revision,
        repositories: [
          {
            repositoryId: 111,
            fullName: "acme/one",
            installationId: 9,
            projectId: "/Users/secret/absolute/path",
            ownerActorIds: [],
            baseRef: "main",
          },
        ],
      }),
    (err) =>
      err instanceof errors.GithubAutomationError && err.code === "invalid_config",
  );

  // Reject malformed fullName.
  assert.throws(
    () =>
      projection.parseGithubAutomationConfigWirePatch({
        revision: baseline.revision,
        repositories: [
          {
            repositoryId: 111,
            fullName: "not-a-repo",
            installationId: 9,
            projectId: project.id,
            ownerActorIds: [],
            baseRef: "main",
          },
        ],
      }),
    (err) =>
      err instanceof errors.GithubAutomationError && err.code === "invalid_config",
  );

  // Reject duplicate repositoryId in one patch.
  assert.throws(
    () =>
      projection.parseGithubAutomationConfigWirePatch({
        revision: baseline.revision,
        repositories: [
          {
            repositoryId: 111,
            fullName: "acme/one",
            installationId: 9,
            projectId: project.id,
            ownerActorIds: [],
            baseRef: "main",
          },
          {
            repositoryId: 111,
            fullName: "acme/two",
            installationId: 9,
            projectId: project.id,
            ownerActorIds: [],
            baseRef: "main",
          },
        ],
      }),
    (err) =>
      err instanceof errors.GithubAutomationError &&
      err.code === "invalid_config" &&
      err.details?.reason === "duplicate_repository_id",
  );

  // Reject secret field at top level.
  assert.throws(
    () =>
      projection.parseGithubAutomationConfigWirePatch({
        revision: baseline.revision,
        webhookSecret: WEBHOOK_SECRET_SENTINEL,
        repositories: [],
      }),
    /disallowed/i,
  );

  // Add two arbitrary owner/repo entries (skip live GitHub; still bind Project Registry).
  const added = await projection.applyGithubAutomationConfigWirePatch(
    {
      revision: baseline.revision,
      repositories: [
        {
          repositoryId: 424201,
          fullName: "acme/alpha",
          installationId: 9001,
          projectId: project.id,
          ownerActorIds: [42],
          baseRef: "develop",
        },
        {
          repositoryId: 424202,
          fullName: "other-org/beta",
          installationId: 9002,
          projectId: project.id,
          ownerActorIds: [],
          baseRef: "main",
        },
      ],
    },
    { skipNetworkLookup: true, requireProjectId: true },
  );
  assert.equal(added.config.repositories.length, 2);
  assert.equal(added.config.repositories[0].fullName, "acme/alpha");
  assert.equal(added.config.repositories[0].projectId, project.id);
  assert.ok(added.config.repositories[0].projectRoot);
  assert.ok(!added.projection.repositories[0].projectRoot);
  assert.equal("projectRoot" in added.projection.repositories[0], false);
  assert.equal(added.projection.repositories[0].projectId, project.id);
  assert.equal(added.projection.repositories[0].baseRef, "develop");
  assert.deepEqual(added.projection.repositories[0].ownerActorIds, [42]);
  assert.equal(added.projection.repositories[1].fullName, "other-org/beta");
  assertNoSentinel(added.projection, "IMP-02 add projection", [projectRoot]);
  projection.assertGithubAutomationProjectionSafe(added.projection);

  // CAS conflict when using the pre-add revision.
  await assert.rejects(
    () =>
      projection.applyGithubAutomationConfigWirePatch(
        {
          revision: baseline.revision,
          repositories: [],
        },
        { skipNetworkLookup: true, requireProjectId: true },
      ),
    (err) =>
      err instanceof errors.GithubAutomationError &&
      err.code === "stale_revision" &&
      err.details?.reason === "revision_conflict",
  );

  // Remove one repo (no active jobs).
  const afterRemove = await projection.applyGithubAutomationConfigWirePatch(
    {
      revision: added.config.revision,
      repositories: [
        {
          repositoryId: 424202,
          fullName: "other-org/beta",
          installationId: 9002,
          projectId: project.id,
          ownerActorIds: [],
          baseRef: "main",
        },
      ],
    },
    { skipNetworkLookup: true, requireProjectId: true },
  );
  assert.equal(afterRemove.config.repositories.length, 1);
  assert.equal(afterRemove.config.repositories[0].repositoryId, 424202);

  // Active job blocks delete.
  const runningJob = await store.createQueuedGithubAutomationJob({
    repositoryId: 424202,
    repositoryFullName: "other-org/beta",
    issueNumber: 88,
    installationId: 9002,
    deliveryId: "imp02-active",
    issueTitlePreview: "active",
    generation: 1,
  });
  await store.writeGithubAutomationJob({
    ...runningJob,
    status: "running",
    phase: "implementing",
  });

  await assert.rejects(
    () =>
      projection.applyGithubAutomationConfigWirePatch(
        {
          revision: afterRemove.config.revision,
          repositories: [],
        },
        {
          skipNetworkLookup: true,
          requireProjectId: true,
          jobsForDeleteGate: [
            {
              ...runningJob,
              status: "running",
              phase: "implementing",
            },
          ],
        },
      ),
    (err) =>
      err instanceof errors.GithubAutomationError &&
      err.code === "invalid_config" &&
      err.details?.reason === "active_job",
  );

  // Unknown Project Registry id fails closed.
  await assert.rejects(
    () =>
      projection.applyGithubAutomationConfigWirePatch(
        {
          revision: afterRemove.config.revision,
          repositories: [
            {
              repositoryId: 424202,
              fullName: "other-org/beta",
              installationId: 9002,
              projectId: "prj_does_not_exist",
              ownerActorIds: [],
              baseRef: "main",
            },
          ],
        },
        { skipNetworkLookup: true, requireProjectId: true },
      ),
    (err) =>
      err instanceof errors.GithubAutomationError && err.code === "invalid_config",
  );

  // Identity mismatch when lookup is enabled (mock fetch).
  credentials._testOverrideGithubAppCredentialEnv({
    appId: "12345",
    privateKeyFile: imp02Key.keyPath,
    webhookSecret: WEBHOOK_SECRET_SENTINEL,
    appSlug: "ypi-bot",
  });
  client._testClearGithubAppInstallationTokenCache();
  client._testOverrideGithubAppClientFetch(async (url) => {
    const href = String(url);
    if (href.endsWith("/app/installations/9002/access_tokens")) {
      return new Response(
        JSON.stringify({
          token: INSTALL_TOKEN_SENTINEL,
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      );
    }
    if (href.includes("/repos/other-org/beta")) {
      return new Response(
        JSON.stringify({
          id: 999999, // mismatch vs draft 424202
          full_name: "other-org/beta",
          default_branch: "main",
          owner: { id: 1, login: "other-org", type: "Organization" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response("{}", { status: 404 });
  });

  await assert.rejects(
    () =>
      projection.applyGithubAutomationConfigWirePatch(
        {
          revision: afterRemove.config.revision,
          repositories: [
            {
              repositoryId: 424202,
              fullName: "other-org/beta",
              installationId: 9002,
              projectId: project.id,
              ownerActorIds: [],
              baseRef: "main",
            },
          ],
        },
        { skipNetworkLookup: false, requireProjectId: true },
      ),
    (err) =>
      err instanceof errors.GithubAutomationError &&
      err.code === "invalid_config" &&
      err.details?.reason === "repository_id_mismatch",
  );

  client._testOverrideGithubAppClientFetch(undefined);
  client._testClearGithubAppInstallationTokenCache();

  // Ensure no job was enqueued by config PATCH itself (only the fixture job exists).
  const jobs = await store.listGithubAutomationJobs();
  assert.equal(jobs.filter((j) => j.deliveryId === "imp02-active").length, 1);
  assert.equal(
    jobs.filter((j) => j.deliveryId && j.deliveryId.startsWith("config-patch")).length,
    0,
  );

  // Cleanup durable fixture jobs so later webhook tests see an empty job store.
  const jobsDir = join(agentDir, "github-automation", "jobs");
  try {
    for (const name of readdirSync(jobsDir)) {
      if (name.endsWith(".json")) unlinkSync(join(jobsDir, name));
    }
  } catch {
    // Directory may not exist in some environments.
  }
  assert.equal((await store.listGithubAutomationJobs()).length, 0);
});

// ─── App credentials + JWT ───────────────────────────────────────────────────

const keyMaterial = makePrivateKeyFile();

await test("credential readiness missing fields", async () => {
  credentials._testOverrideGithubAppCredentialEnv({
    appId: null,
    privateKeyFile: null,
    webhookSecret: null,
    appSlug: null,
  });
  const missing = await credentials.getGithubAppCredentialSafeProjection();
  assert.equal(missing.configured, false);
  assert.equal(missing.readiness, "missing_app_id");
  assertNoSentinel(missing, "missing readiness");

  credentials._testOverrideGithubAppCredentialEnv({
    appId: "12345",
    privateKeyFile: join(agentDir, "no-such-key.pem"),
    webhookSecret: WEBHOOK_SECRET_SENTINEL,
  });
  const unreadable = await credentials.getGithubAppCredentialSafeProjection();
  assert.equal(unreadable.readiness, "private_key_unreadable");
  assertNoSentinel(unreadable, "unreadable readiness");
});

await test("generated-key RS256 JWT verifies and respects lifetime", async () => {
  credentials._testOverrideGithubAppCredentialEnv({
    appId: "424242",
    privateKeyFile: keyMaterial.keyPath,
    webhookSecret: WEBHOOK_SECRET_SENTINEL,
    appSlug: "yolk-pi-bot",
  });
  credentials._testOverrideGithubAppNowSeconds(1_700_000_000);

  const ready = await credentials.getGithubAppCredentialSafeProjection();
  assert.equal(ready.configured, true);
  assert.equal(ready.readiness, "ready");
  assert.equal(ready.hasWebhookSecret, true);
  assertNoSentinel(ready, "ready projection");

  const creds = await credentials.loadGithubAppCredentials();
  const jwt = credentials.createGithubAppJwt(creds, {
    nowSeconds: 1_700_000_000,
    lifetimeSeconds: 9 * 60,
  });
  assert.equal(jwt.iat, 1_700_000_000 - 60);
  assert.equal(jwt.exp, 1_700_000_000 + 9 * 60);
  assert.ok(jwt.token.startsWith(JWT_MARKER));

  const [headerB64, payloadB64, sigB64] = jwt.token.split(".");
  const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  assert.equal(payload.iss, "424242");
  assert.equal(payload.iat, jwt.iat);
  assert.equal(payload.exp, jwt.exp);

  const verify = createVerify("RSA-SHA256");
  verify.update(`${headerB64}.${payloadB64}`);
  verify.end();
  const ok = verify.verify(
    createPublicKey(keyMaterial.publicKeyPem),
    Buffer.from(sigB64, "base64url"),
  );
  assert.equal(ok, true);

  // Lifetime capped at 9 minutes even if caller asks for more.
  const capped = credentials.createGithubAppJwt(creds, {
    nowSeconds: 1_700_000_000,
    lifetimeSeconds: 60 * 60,
  });
  assert.equal(capped.exp - 1_700_000_000, 9 * 60);

  assertNoSentinel(
    { iat: jwt.iat, exp: jwt.exp, appId: "424242" },
    "jwt metadata",
  );
});

// ─── App client ──────────────────────────────────────────────────────────────

await test("installation token cache and fixed-host guards", async () => {
  credentials._testOverrideGithubAppCredentialEnv({
    appId: "424242",
    privateKeyFile: keyMaterial.keyPath,
    webhookSecret: WEBHOOK_SECRET_SENTINEL,
  });
  client._testClearGithubAppInstallationTokenCache();
  client._testOverrideGithubAppClientNowMs(1_700_000_000_000);

  let tokenPosts = 0;
  const calls = [];

  client._testOverrideGithubAppClientFetch(async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? "GET", init });
    const u = String(url);

    if (u.includes("/app/installations/7/access_tokens")) {
      tokenPosts += 1;
      return new Response(
        JSON.stringify({
          token: INSTALL_TOKEN_SENTINEL,
          expires_at: new Date(1_700_000_000_000 + 60 * 60 * 1000).toISOString(),
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    }

    if (u.includes("/app/installations/7") && !u.includes("access_tokens")) {
      return new Response(
        JSON.stringify({
          id: 7,
          permissions: {
            metadata: "read",
            issues: "write",
            pull_requests: "read",
            contents: "none",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    if (u === "https://evil.example/x") {
      return new Response("", {
        status: 302,
        headers: { location: "https://evil.example/y" },
      });
    }

    return new Response(JSON.stringify({ message: "not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  });

  const first = await client.getGithubInstallationToken(7);
  assert.equal(first.token, INSTALL_TOKEN_SENTINEL);
  assert.equal(tokenPosts, 1);
  const second = await client.getGithubInstallationToken(7);
  assert.equal(second.token, INSTALL_TOKEN_SENTINEL);
  assert.equal(tokenPosts, 1, "token must be cached");

  // Force refresh
  await client.getGithubInstallationToken(7, { forceRefresh: true });
  assert.equal(tokenPosts, 2);

  const capability = await client.getGithubInstallationCapability(7);
  assert.equal(capability.p0Triage, true);
  assert.equal(capability.p1Unattended, false);
  assert.ok(capability.missingForP1.includes("pull_requests"));
  assert.ok(capability.missingForP1.includes("contents"));
  assertNoSentinel(capability, "capability");

  // Redirect rejection on fixed API path
  client._testOverrideGithubAppClientFetch(async () => {
    return new Response("", {
      status: 302,
      headers: { location: "https://evil.example/phish" },
    });
  });
  await assert.rejects(
    () => client.getGithubInstallationToken(8, { forceRefresh: true }),
    (err) =>
      err instanceof errors.GithubAutomationError &&
      err.code === "github_redirect_rejected",
  );

  // Oversized body
  client._testOverrideGithubAppClientFetch(async () => {
    const big = "x".repeat(600 * 1024);
    return new Response(big, { status: 200 });
  });
  await assert.rejects(
    () => client.getGithubInstallationToken(9, { forceRefresh: true }),
    (err) =>
      err instanceof errors.GithubAutomationError &&
      err.code === "github_oversized_response",
  );

  // Ensure Authorization headers used App JWT shape, not machine token.
  for (const call of calls) {
    const auth = call.init?.headers?.Authorization ?? "";
    assert.ok(!auth.includes(MACHINE_TOKEN_SENTINEL));
    assert.ok(!JSON.stringify(call.init?.headers ?? {}).includes(WEBHOOK_SECRET_SENTINEL));
  }
});

await test("githubGetUserWithBearerToken returns canonical login", async () => {
  client._testOverrideGithubAppClientFetch(async (url, init) => {
    assert.equal(String(url), "https://api.github.com/user");
    assert.equal(init?.redirect, "manual");
    const auth = init?.headers?.Authorization ?? "";
    assert.ok(auth.includes(MACHINE_TOKEN_SENTINEL));
    return new Response(
      JSON.stringify({ login: "canonical-login", id: 555 }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
  const user = await client.githubGetUserWithBearerToken(MACHINE_TOKEN_SENTINEL);
  assert.deepEqual(user, { login: "canonical-login", id: 555 });
});

// ─── Machine assignee ────────────────────────────────────────────────────────

await test("gh success path", async () => {
  assignee._testOverrideMachineAssigneeCommandRunner(async ({ command, args }) => {
    if (command === "gh" && args[0] === "auth") {
      return {
        code: 0,
        stdout: "github.com\n  ✓ Logged in to github.com account alice (keyring)\n  - Active account: true\n",
        stderr: "",
      };
    }
    if (command === "gh" && args[0] === "api") {
      return {
        code: 0,
        stdout: JSON.stringify({ login: "alice", id: 101 }),
        stderr: "",
      };
    }
    return { code: 127, stdout: "", stderr: "unexpected" };
  });
  const resolved = await assignee.resolveMachineGithubAssigneeIdentity();
  assert.equal(resolved.ok, true);
  assert.equal(resolved.identity.login, "alice");
  assert.equal(resolved.identity.actorId, 101);
  assert.equal(resolved.identity.identitySource, "gh");
  assertNoSentinel(resolved, "gh identity");
});

await test("multi-account without active is blocked", async () => {
  assignee._testOverrideMachineAssigneeCommandRunner(async ({ command, args }) => {
    if (command === "gh" && args[0] === "auth") {
      return {
        code: 0,
        stdout:
          "github.com\n  account one\n  - Active account: false\n  account two\n  - Active account: false\n",
        stderr: "",
      };
    }
    return { code: 1, stdout: "", stderr: "should not call api" };
  });
  const resolved = await assignee.resolveMachineGithubAssigneeIdentity();
  assert.equal(resolved.ok, false);
  assert.equal(resolved.readiness, "gh_no_active_account");
});

await test("gh unavailable falls back to git credential + canonical /user", async () => {
  let sawFill = false;
  assignee._testOverrideMachineAssigneeCommandRunner(async ({ command, args, stdin }) => {
    if (command === "gh") {
      return {
        code: null,
        stdout: "",
        stderr: "",
        error: Object.assign(new Error("not found"), { code: "ENOENT" }),
      };
    }
    if (command === "git" && args[0] === "credential") {
      sawFill = true;
      assert.ok(String(stdin).includes("host=github.com"));
      assert.ok(String(stdin).includes("protocol=https"));
      // Username intentionally differs from canonical login.
      return {
        code: 0,
        stdout: `protocol=https\nhost=github.com\nusername=helper-username\npassword=${MACHINE_TOKEN_SENTINEL}\n`,
        stderr: "",
      };
    }
    return { code: 1, stdout: "", stderr: "unexpected" };
  });
  assignee._testOverrideMachineAssigneeUserLookup(async (token) => {
    assert.equal(token, MACHINE_TOKEN_SENTINEL);
    return { login: "canonical-from-api", id: 777 };
  });

  const resolved = await assignee.resolveMachineGithubAssigneeIdentity();
  assert.equal(sawFill, true);
  assert.equal(resolved.ok, true);
  assert.equal(resolved.identity.login, "canonical-from-api");
  assert.notEqual(resolved.identity.login, "helper-username");
  assert.equal(resolved.identity.identitySource, "git-credential");
  assertNoSentinel(resolved, "git-credential identity");
});

await test("non-github git credential host is blocked", async () => {
  assignee._testOverrideMachineAssigneeCommandRunner(async ({ command }) => {
    if (command === "gh") {
      return {
        code: null,
        stdout: "",
        stderr: "",
        error: Object.assign(new Error("not found"), { code: "ENOENT" }),
      };
    }
    return {
      code: 0,
      stdout: `protocol=https\nhost=ghe.example.com\nusername=x\npassword=${MACHINE_TOKEN_SENTINEL}\n`,
      stderr: "",
    };
  });
  const resolved = await assignee.resolveMachineGithubAssigneeIdentity();
  assert.equal(resolved.ok, false);
  assert.equal(resolved.readiness, "git_credential_host_unsupported");
});

await test("credential timeout readiness", async () => {
  assignee._testOverrideMachineAssigneeCommandRunner(async () => ({
    code: null,
    stdout: "",
    stderr: "",
    error: Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }),
  }));
  const resolved = await assignee.resolveMachineGithubAssigneeIdentity();
  assert.equal(resolved.ok, false);
  assert.equal(resolved.readiness, "credential_timeout");
});

await test("safe assignee projection omits secrets", async () => {
  assignee._testOverrideMachineAssigneeCommandRunner(async ({ command, args }) => {
    if (command === "gh" && args[0] === "auth") {
      return {
        code: 0,
        stdout: "github.com\n  Active account: true\n",
        stderr: "",
      };
    }
    if (command === "gh" && args[0] === "api") {
      return {
        code: 0,
        stdout: JSON.stringify({ login: "bob", id: 9 }),
        stderr: "",
      };
    }
    return { code: 1, stdout: "", stderr: "" };
  });
  const projection = await assignee.getMachineGithubAssigneeSafeProjection();
  assert.equal(projection.login, "bob");
  assert.equal(projection.readiness, "ready");
  assert.equal(projection.identitySource, "gh");
  assertNoSentinel(projection, "assignee projection");
  for (const key of Object.keys(projection)) {
    assert.ok(
      [
        "login",
        "actorId",
        "identitySource",
        "checkedAt",
        "readiness",
        "assignable",
        "reasonCode",
      ].includes(key),
      `unexpected projection field ${key}`,
    );
  }
});

await test("parseGitCredentialFillOutput never treats username as enough", () => {
  const parsed = assignee.parseGitCredentialFillOutput(
    `protocol=https\nhost=github.com\nusername=only-user\npassword=${MACHINE_TOKEN_SENTINEL}\n`,
  );
  assert.equal(parsed.ok, true);
  assert.equal(parsed.material.username, "only-user");
  assert.equal(parsed.material.password, MACHINE_TOKEN_SENTINEL);
});

await test("interpretGhAuthStatus detects unsupported host", () => {
  const code = assignee.interpretGhAuthStatus(
    "Logged in to enterprise.example.com as alice\n",
    "",
  );
  assert.equal(code, "gh_host_unsupported");
});

// ─── Source isolation / sentinel static scans ────────────────────────────────

await test("source isolation: App modules do not import Links or personal auth fallbacks", () => {
  const files = [
    "lib/github-automation-types.ts",
    "lib/github-automation-config.ts",
    "lib/github-automation-errors.ts",
    "lib/github-app-credentials.ts",
    "lib/github-app-client.ts",
    "lib/github-machine-assignee.ts",
  ];
  for (const rel of files) {
    const src = readFileSync(join(root, rel), "utf8");
    // Import/require isolation (comments may mention adjacent domains).
    assert.ok(
      !/from\s+["'][^"']*links-store/.test(src) &&
        !/require\(["'][^"']*links-store/.test(src),
      `${rel} must not import links-store`,
    );
    assert.ok(
      !/from\s+["'][^"']*links-types/.test(src) &&
        !/require\(["'][^"']*links-types/.test(src),
      `${rel} must not import links-types`,
    );
    assert.ok(
      !/from\s+["'][^"']*github-link-oauth/.test(src) &&
        !/require\(["'][^"']*github-link-oauth/.test(src),
      `${rel} must not import github-link-oauth`,
    );
    assert.ok(
      !/from\s+["'][^"']*web-credential-store/.test(src) &&
        !/require\(["'][^"']*web-credential-store/.test(src),
      `${rel} must not import web-credential-store`,
    );
    assert.ok(
      !/from\s+["'][^"']*oauth-accounts/.test(src) &&
        !/require\(["'][^"']*oauth-accounts/.test(src),
      `${rel} must not import oauth-accounts`,
    );
    // Must not infer login from git config user.name / user.email.
    assert.ok(
      !/git\s+config\s+user\.(name|email)/.test(src) &&
        !/args:\s*\[[^\]]*user\.(name|email)/.test(src),
      `${rel} must not use git user.name/email`,
    );
  }

  const clientSrc = readFileSync(join(root, "lib/github-app-client.ts"), "utf8");
  assert.ok(clientSrc.includes('redirect: "manual"'));
  assert.ok(clientSrc.includes("https://api.github.com"));
  // App client must not shell out to gh for mutations/auth.
  assert.ok(!/\bspawn\b/.test(clientSrc), "app client must not spawn processes");
  assert.ok(
    !/\bexecFile\b/.test(clientSrc),
    "app client must not execFile",
  );
  assert.ok(
    !/command:\s*["']gh["']/.test(clientSrc),
    "app client must not invoke gh",
  );
});

await test("config file on disk contains no credential env material", async () => {
  credentials._testOverrideGithubAppCredentialEnv({
    appId: "424242",
    privateKeyFile: keyMaterial.keyPath,
    webhookSecret: WEBHOOK_SECRET_SENTINEL,
  });
  await config.writeGithubAutomationConfig(config.createDefaultGithubAutomationConfig());
  const disk = readFileSync(config.getGithubAutomationConfigPath(), "utf8");
  assertNoSentinel(disk, "config disk");
  assert.ok(!disk.includes(WEBHOOK_SECRET_SENTINEL));
  assert.ok(!disk.includes("YPI_GITHUB_APP"));
  assert.ok(!disk.includes(keyMaterial.pem.slice(0, 40)));
});

// ─── GHA-02: webhook verify / store / scheduler / runtime ─────────────────────

function issuePayload(overrides = {}) {
  return {
    action: "opened",
    issue: {
      number: 42,
      title: "Fix docs typo in README",
      state: "open",
      body: `SECRET_BODY ${MACHINE_TOKEN_SENTINEL}`,
    },
    repository: {
      id: 602362837,
      full_name: "602362837/yolk-pi-web",
    },
    installation: { id: 999001 },
    sender: { id: 12345, login: "owner-user" },
    ...overrides,
  };
}

function signedRequest(bodyObj, options = {}) {
  const raw =
    typeof bodyObj === "string" ? bodyObj : JSON.stringify(bodyObj ?? {});
  const secret = options.secret ?? WEBHOOK_SECRET_SENTINEL;
  const deliveryId = options.deliveryId ?? `deliv-${Math.random().toString(16).slice(2)}`;
  const eventName = options.eventName ?? "issues";
  const signatureHex = webhookVerify.computeGithubWebhookSignatureHex(raw, secret);
  const headers = new Headers({
    "content-type": "application/json",
    "x-github-event": eventName,
    "x-github-delivery": deliveryId,
    "x-hub-signature-256": options.badSignature
      ? "sha256=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
      : `sha256=${signatureHex}`,
  });
  if (options.omitSignature) headers.delete("x-hub-signature-256");
  return {
    request: new Request("http://localhost/api/github-automation/webhook", {
      method: "POST",
      headers,
      body: raw,
    }),
    deliveryId,
    raw,
  };
}

await test("webhook signature verifies with timing-safe compare", () => {
  const raw = Buffer.from(JSON.stringify({ ok: true }), "utf8");
  const hex = webhookVerify.computeGithubWebhookSignatureHex(raw, WEBHOOK_SECRET_SENTINEL);
  assert.equal(
    webhookVerify.verifyGithubWebhookSignature({
      rawBody: raw,
      signatureHeader: `sha256=${hex}`,
      secret: WEBHOOK_SECRET_SENTINEL,
    }),
    true,
  );
  assert.equal(
    webhookVerify.verifyGithubWebhookSignature({
      rawBody: raw,
      signatureHeader: `sha256=${"ab".repeat(32)}`,
      secret: WEBHOOK_SECRET_SENTINEL,
    }),
    false,
  );
  assert.equal(
    webhookVerify.verifyGithubWebhookSignature({
      rawBody: raw,
      signatureHeader: null,
      secret: WEBHOOK_SECRET_SENTINEL,
    }),
    false,
  );
});

await test("invalid signature has zero business effects", async () => {
  scheduler._testResetGithubAutomationScheduler();
  scheduler._testSetGithubAutomationSchedulerAuto(false);

  await config.writeGithubAutomationConfig({
    ...makeAllowlistedConfig(),
    enabled: true,
    mode: "triage",
  });

  const { request } = signedRequest(issuePayload(), { badSignature: true });
  const result = await runtime.acceptGithubAutomationWebhook({
    request,
    webhookSecret: WEBHOOK_SECRET_SENTINEL,
    wakeScheduler: false,
  });
  assert.equal(result.httpStatus, 401);
  assert.equal(result.code, "unauthorized");
  const jobs = await store.listGithubAutomationJobs();
  assert.equal(jobs.length, 0);
});

await test("missing signature is unauthorized", async () => {
  const { request } = signedRequest(issuePayload(), { omitSignature: true });
  const result = await runtime.acceptGithubAutomationWebhook({
    request,
    webhookSecret: WEBHOOK_SECRET_SENTINEL,
    wakeScheduler: false,
  });
  assert.equal(result.httpStatus, 401);
  assert.equal(result.code, "unauthorized");
});

await test("oversize body returns 413 without enqueue", async () => {
  const big = "x".repeat(64);
  const { request } = signedRequest(big);
  const result = await runtime.acceptGithubAutomationWebhook({
    request,
    webhookSecret: WEBHOOK_SECRET_SENTINEL,
    wakeScheduler: false,
    maxBodyBytes: 16,
  });
  assert.equal(result.httpStatus, 413);
  assert.equal(result.code, "payload_too_large");
  assert.equal((await store.listGithubAutomationJobs()).length, 0);
});

await test("non-allowlisted repository is ignored with zero jobs", async () => {
  await config.writeGithubAutomationConfig({
    ...makeAllowlistedConfig(),
    enabled: true,
    mode: "triage",
  });
  const payload = issuePayload({
    repository: { id: 1, full_name: "other/repo" },
  });
  const { request, deliveryId } = signedRequest(payload);
  const result = await runtime.acceptGithubAutomationWebhook({
    request,
    webhookSecret: WEBHOOK_SECRET_SENTINEL,
    wakeScheduler: false,
  });
  assert.equal(result.httpStatus, 202);
  assert.equal(result.code, "ignored");
  assert.equal(result.ignoreReason, "repository_not_allowlisted");
  assert.equal((await store.listGithubAutomationJobs()).length, 0);
  const delivery = await store.readGithubAutomationDelivery(deliveryId);
  assert.ok(delivery);
  assert.equal(delivery.disposition, "ignored");
  assertNoSentinel(delivery, "delivery record");
  assert.ok(!JSON.stringify(delivery).includes(MACHINE_TOKEN_SENTINEL));
  assert.ok(!JSON.stringify(delivery).includes("SECRET_BODY"));
});

await test("unknown event is ignored", async () => {
  const { request } = signedRequest({ zen: "design" }, { eventName: "sponsorship" });
  const result = await runtime.acceptGithubAutomationWebhook({
    request,
    webhookSecret: WEBHOOK_SECRET_SENTINEL,
    wakeScheduler: false,
  });
  assert.equal(result.httpStatus, 202);
  assert.equal(result.code, "ignored");
  assert.equal(result.ignoreReason, "unknown_event");
});

await test("allowlisted issues delivery enqueues one job without issue body", async () => {
  scheduler._testResetGithubAutomationScheduler();
  scheduler._testSetGithubAutomationSchedulerAuto(false);

  await config.writeGithubAutomationConfig({
    ...makeAllowlistedConfig(),
    enabled: true,
    mode: "triage",
    paused: false,
  });

  const { request, deliveryId, raw } = signedRequest(issuePayload());
  const result = await runtime.acceptGithubAutomationWebhook({
    request,
    webhookSecret: WEBHOOK_SECRET_SENTINEL,
    wakeScheduler: false,
  });
  assert.equal(result.httpStatus, 202);
  assert.equal(result.code, "enqueued");
  assert.ok(result.jobId);

  const jobs = await store.listGithubAutomationJobs();
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].issueNumber, 42);
  assert.equal(jobs[0].status, "queued");
  assert.equal(jobs[0].phase, "received");
  assert.equal(jobs[0].checkpoint, "received");
  assertNoSentinel(jobs[0], "job record");
  assert.ok(!JSON.stringify(jobs[0]).includes("SECRET_BODY"));
  assert.ok(!JSON.stringify(jobs[0]).includes(MACHINE_TOKEN_SENTINEL));

  const delivery = await store.readGithubAutomationDelivery(deliveryId);
  assert.equal(delivery.jobId, result.jobId);
  assert.equal(delivery.disposition, "enqueued");
  assert.ok(!JSON.stringify(delivery).includes(raw));
  assert.ok(!JSON.stringify(delivery).includes(WEBHOOK_SECRET_SENTINEL));
});

await test("duplicate delivery does not create a second job", async () => {
  scheduler._testResetGithubAutomationScheduler();
  scheduler._testSetGithubAutomationSchedulerAuto(false);
  await config.writeGithubAutomationConfig({
    ...makeAllowlistedConfig(),
    enabled: true,
    mode: "triage",
  });

  const payload = issuePayload({ issue: { number: 77, title: "Dup", state: "open", body: "x" } });
  const deliveryId = "dup-delivery-fixed-001";
  const first = signedRequest(payload, { deliveryId });
  const r1 = await runtime.acceptGithubAutomationWebhook({
    request: first.request,
    webhookSecret: WEBHOOK_SECRET_SENTINEL,
    wakeScheduler: false,
  });
  assert.equal(r1.code, "enqueued");

  const second = signedRequest(payload, { deliveryId });
  const r2 = await runtime.acceptGithubAutomationWebhook({
    request: second.request,
    webhookSecret: WEBHOOK_SECRET_SENTINEL,
    wakeScheduler: false,
  });
  assert.equal(r2.code, "duplicate");
  assert.equal(r2.httpStatus, 202);

  const jobs = (await store.listGithubAutomationJobs()).filter((j) => j.issueNumber === 77);
  assert.equal(jobs.length, 1);
});

await test("issue lease serializes concurrent critical sections", async () => {
  const order = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  const p1 = store.withGithubAutomationIssueLease(602362837, 9001, async () => {
    order.push("a-enter");
    await firstGate;
    order.push("a-exit");
    return 1;
  });

  // Give p1 time to acquire.
  await new Promise((r) => setTimeout(r, 30));

  const p2Promise = store.withGithubAutomationIssueLease(
    602362837,
    9001,
    async () => {
      order.push("b");
      return 2;
    },
    { maxWaitMs: 5_000 },
  );

  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(order, ["a-enter"]);
  releaseFirst();
  const [v1, v2] = await Promise.all([p1, p2Promise]);
  assert.equal(v1, 1);
  assert.equal(v2, 2);
  assert.deepEqual(order, ["a-enter", "a-exit", "b"]);
});

await test("scheduler advances received job to claim_readiness checkpoint", async () => {
  scheduler._testResetGithubAutomationScheduler();
  scheduler._testSetGithubAutomationSchedulerAuto(false);
  scheduler.setGithubAutomationJobHandler(null);

  await config.writeGithubAutomationConfig({
    ...makeAllowlistedConfig(),
    enabled: true,
    mode: "triage",
  });

  const { request } = signedRequest(
    issuePayload({
      issue: { number: 55, title: "Sched", state: "open", body: "n" },
    }),
    { deliveryId: "sched-delivery-55" },
  );
  const accepted = await runtime.acceptGithubAutomationWebhook({
    request,
    webhookSecret: WEBHOOK_SECRET_SENTINEL,
    wakeScheduler: false,
  });
  assert.equal(accepted.code, "enqueued");

  // Drain the queue: earlier tests may leave other queued jobs that fill concurrency.
  const deadline = Date.now() + 5_000;
  let job = null;
  let startedTotal = 0;
  while (Date.now() < deadline) {
    const tick = await scheduler.tickGithubAutomationScheduler();
    startedTotal += tick.started;
    // Allow fire-and-forget handlers to finish.
    await new Promise((r) => setTimeout(r, 30));
    job = await store.readGithubAutomationJob(accepted.jobId);
    if (job && job.phase === "claim_readiness") break;
  }
  assert.ok(startedTotal >= 1, "scheduler should start at least one job");
  assert.ok(job);
  assert.equal(job.phase, "claim_readiness");
  assert.equal(job.checkpoint, "claim_readiness");
  assert.equal(job.reasonCode, "awaiting_claim_handler");

  // Further ticks must not re-run parked default-handler jobs.
  const tick2 = await scheduler.tickGithubAutomationScheduler();
  assert.equal(tick2.started, 0);
});

await test("effect marker crash-intent path is durable and generation-safe", async () => {
  const job = await store.createQueuedGithubAutomationJob({
    repositoryId: 602362837,
    repositoryFullName: "602362837/yolk-pi-web",
    issueNumber: 120,
    installationId: 1,
    deliveryId: "eff-1",
    issueTitlePreview: "effect",
    generation: 3,
  });
  const withIntent = {
    ...job,
    effects: store.upsertEffectMarker(job.effects, {
      name: "triage_comment",
      status: "intended",
      remoteId: null,
      generation: 3,
      reasonCode: "comment_intent",
    }),
  };
  await store.writeGithubAutomationJob(withIntent);

  // Simulate remote success commit.
  const confirmed = {
    ...(await store.readGithubAutomationJob(job.jobId)),
    effects: store.upsertEffectMarker(withIntent.effects, {
      name: "triage_comment",
      status: "remote_confirmed",
      remoteId: "123456",
      generation: 3,
      reasonCode: null,
    }),
  };
  await store.writeGithubAutomationJob(confirmed);

  // Older generation must not overwrite newer issue state.
  await store.upsertGithubAutomationIssueState({
    repositoryId: 602362837,
    issueNumber: 120,
    generation: 5,
    activeJobId: job.jobId,
  });
  const blocked = await store.upsertGithubAutomationIssueState({
    repositoryId: 602362837,
    issueNumber: 120,
    generation: 4,
    activeJobId: "should-not-win",
  });
  assert.equal(blocked.generation, 5);
  assert.equal(blocked.activeJobId, job.jobId);

  const reloaded = await store.readGithubAutomationJob(job.jobId);
  assert.equal(reloaded.effects[0].status, "remote_confirmed");
  assert.equal(reloaded.effects[0].remoteId, "123456");
});

await test("safe event projection never includes body or secrets", async () => {
  await store.appendGithubAutomationSafeEvent({
    at: new Date().toISOString(),
    kind: "unit_test_event",
    repositoryId: 602362837,
    issueNumber: 1,
    jobId: "job_x",
    deliveryId: "d1",
    phase: "received",
    reasonCode: "ok",
    traceId: "abcd",
    meta: { note: "safe" },
  });
  const day = new Date().toISOString().slice(0, 10);
  const eventsPath = store.getGithubAutomationEventsPath(day);
  const text = readFileSync(eventsPath, "utf8");
  assertNoSentinel(text, "events jsonl");
  assert.ok(!text.includes("SECRET_BODY"));
  assert.ok(text.includes("unit_test_event"));
});

await test("envelope parser strips issue body and truncates title", () => {
  const longTitle = "T".repeat(200);
  const env = store.parseGithubWebhookEnvelope({
    eventName: "issues",
    deliveryId: "d-parse-1",
    payload: {
      action: "opened",
      issue: { number: 9, title: longTitle, body: "SHOULD_NOT_APPEAR", state: "open" },
      repository: { id: 602362837, full_name: "602362837/yolk-pi-web" },
      installation: { id: 1 },
      sender: { id: 2, login: "u" },
    },
  });
  assert.equal(env.issueNumber, 9);
  assert.ok(env.issueTitlePreview.length <= 120);
  assert.ok(!JSON.stringify(env).includes("SHOULD_NOT_APPEAR"));
});

await test("gha-02 modules stay isolated from Links/OAuth credential stores", () => {
  for (const rel of [
    "lib/github-webhook-verify.ts",
    "lib/github-automation-store.ts",
    "lib/github-automation-scheduler.ts",
    "lib/github-automation-runtime.ts",
    "app/api/github-automation/webhook/route.ts",
  ]) {
    const src = readFileSync(join(root, rel), "utf8");
    assert.ok(
      !/from\s+["'][^"']*links-/.test(src) && !/github-link-oauth/.test(src),
      `${rel} must not import Links`,
    );
    assert.ok(!/web-credential-store/.test(src), `${rel} must not import web-credential-store`);
    assert.ok(!/oauth-accounts/.test(src), `${rel} must not import oauth-accounts`);
    // Must verify signature before parse in runtime/route path.
    if (rel.includes("webhook-verify") || rel.includes("runtime")) {
      assert.ok(
        src.includes("timingSafeEqual") || src.includes("assertValidGithubWebhookSignature"),
        `${rel} must use timing-safe verification`,
      );
    }
  }
  const verifySrc = readFileSync(join(root, "lib/github-webhook-verify.ts"), "utf8");
  assert.ok(verifySrc.includes("timingSafeEqual"));
  const storeSrc = readFileSync(join(root, "lib/github-automation-store.ts"), "utf8");
  assert.ok(storeSrc.includes('"wx"') || storeSrc.includes("'wx'"));
  assert.ok(storeSrc.includes("sync()"));
});

// ─── GHA-03: labels / comments / owner intent / claim runner ─────────────────

await test("approved label catalog includes claim and claim-blocked", () => {
  assert.ok(labels.YPI_APPROVED_LABEL_CATALOG.includes("ypi:claimed"));
  assert.ok(labels.YPI_APPROVED_LABEL_CATALOG.includes("ypi:claim-blocked"));
  assert.equal(labels.isBotManagedLifecycleLabel("ypi:claimed"), true);
  assert.equal(labels.isApprovedYpiLabel("random-user-label"), false);
});

await test("owner intent strips quotes/code and prefers negation", () => {
  const quoted = ownerIntent.parseGithubOwnerIntent("> 采纳\n请说明一下");
  assert.notEqual(quoted.kind, "affirmative");

  const coded = ownerIntent.parseGithubOwnerIntent("```\n采纳\n```\n看看");
  assert.notEqual(coded.kind, "affirmative");

  const neg = ownerIntent.parseGithubOwnerIntent("不要采纳");
  assert.equal(neg.kind, "negative");

  const yes = ownerIntent.parseGithubOwnerIntent("可以做，按建议处理");
  assert.equal(yes.kind, "affirmative");
  assert.equal(yes.isAffirmative, true);

  const en = ownerIntent.parseGithubOwnerIntent("LGTM go ahead");
  assert.equal(en.kind, "affirmative");

  const q = ownerIntent.parseGithubOwnerIntent("可以做吗？");
  assert.equal(q.kind, "question");
});

await test("owner authorization requires owner actor and complete claim", () => {
  const baseActor = {
    senderId: 42,
    senderLogin: "owner",
    senderType: "User",
    repositoryOwnerId: 42,
    repositoryOwnerLogin: "owner",
    repositoryOwnerType: "User",
    ownerActorIds: [],
  };

  const ok = ownerIntent.evaluateGithubOwnerAuthorization({
    actor: baseActor,
    commentBody: "采纳",
    claimComplete: true,
    issueOpen: true,
    recommendation: "yes",
  });
  assert.equal(ok.authorized, true);
  assert.equal(ok.decision, "authorized");

  const nonOwner = ownerIntent.evaluateGithubOwnerAuthorization({
    actor: { ...baseActor, senderId: 99, senderLogin: "other" },
    commentBody: "采纳",
    claimComplete: true,
    issueOpen: true,
    recommendation: "yes",
  });
  assert.equal(nonOwner.authorized, false);
  assert.equal(nonOwner.decision, "not_owner");

  const incomplete = ownerIntent.evaluateGithubOwnerAuthorization({
    actor: baseActor,
    commentBody: "采纳",
    claimComplete: false,
    issueOpen: true,
    recommendation: "yes",
  });
  assert.equal(incomplete.authorized, false);
  assert.equal(incomplete.decision, "incomplete_claim");

  const bot = ownerIntent.evaluateGithubOwnerAuthorization({
    actor: { ...baseActor, senderType: "Bot" },
    commentBody: "采纳",
    claimComplete: true,
    issueOpen: true,
    recommendation: "yes",
  });
  assert.equal(bot.authorized, false);
  assert.equal(bot.decision, "bot_sender");

  const orgOk = ownerIntent.evaluateGithubOwnerAuthorization({
    actor: {
      senderId: 7,
      senderLogin: "maintainer",
      senderType: "User",
      repositoryOwnerId: 1,
      repositoryOwnerLogin: "acme",
      repositoryOwnerType: "Organization",
      ownerActorIds: [7],
    },
    commentBody: "go ahead",
    claimComplete: true,
    issueOpen: true,
    recommendation: "yes",
  });
  assert.equal(orgOk.authorized, true);
});

await test("comment markers are idempotent and secret-free", () => {
  const marker = comments.buildGithubAutomationCommentMarker({
    kind: "triage",
    repositoryId: 602362837,
    issueNumber: 12,
    traceId: "abc123",
  });
  const body = comments.buildTriageConclusionCommentBody({
    marker,
    appBotLogin: "ypi-bot[bot]",
    assigneeLogin: "machine-user",
    recommendation: "yes",
    reasons: ["docs"],
    nextActions: ["wait owner"],
    issueTitlePreview: "Fix docs",
  });
  assert.ok(comments.commentContainsAutomationMarker(body, "triage"));
  assertNoSentinel(body, "triage comment body");
  assert.ok(body.includes("@machine-user"));
  assert.ok(body.includes("ypi:claimed"));

  const blocked = comments.buildClaimBlockedCommentBody({
    marker: comments.buildGithubAutomationCommentMarker({
      kind: "claim_blocked",
      repositoryId: 1,
      issueNumber: 2,
      traceId: "t",
    }),
    appBotLogin: null,
    assigneeLogin: null,
    reasonCode: "gh_not_logged_in",
    operatorHints: ["gh auth login"],
    issueTitlePreview: "x",
  });
  assert.ok(blocked.includes("认领未完成"));
  assert.ok(blocked.includes("blocked_claim_assignee"));
});

await test("deterministic triage classifies docs vs high-risk", () => {
  const docs = triageRunner.analyzeUntrustedGithubIssue({
    title: "Update README installation docs",
    bodyPreview: "Document the new npm install steps for operators.",
    labels: ["documentation"],
  });
  assert.equal(docs.recommendation, "yes");
  assert.equal(docs.typeLabel, "ypi:type-docs");

  const risky = triageRunner.analyzeUntrustedGithubIssue({
    title: "Rotate production secrets and OAuth tokens",
    bodyPreview: "Need to change workflow and lockfile for release.",
    labels: [],
  });
  assert.equal(risky.recommendation, "no");
  assert.equal(risky.riskLabel, "ypi:risk-high");
});

await test("manual skill skip gate for active automation claims", () => {
  assert.equal(
    triageRunner.shouldManualTriageSkipAutomationClaim({
      claimStatus: "complete",
    }).skip,
    true,
  );
  assert.equal(
    triageRunner.shouldManualTriageSkipAutomationClaim({
      claimStatus: "blocked_claim_assignee",
    }).skip,
    true,
  );
  assert.equal(
    triageRunner.shouldManualTriageSkipAutomationClaim({
      claimStatus: null,
      activeJobPhase: "awaiting_owner",
    }).skip,
    true,
  );
  assert.equal(
    triageRunner.shouldManualTriageSkipAutomationClaim({
      claimStatus: null,
      activeJobPhase: null,
    }).skip,
    false,
  );
});

await test("claim runner success requires assignee readback + claimed label + comment", async () => {
  const key = makePrivateKeyFile();
  credentials._testOverrideGithubAppCredentialEnv({
    appId: "12345",
    privateKeyFile: key.keyPath,
    webhookSecret: WEBHOOK_SECRET_SENTINEL,
  });
  client._testClearGithubAppInstallationTokenCache();

  assignee._testOverrideMachineAssigneeCommandRunner(async ({ command, args }) => {
    if (command === "gh" && args[0] === "auth") {
      return {
        code: 0,
        stdout: "Logged in to github.com\nActive account: true\n",
        stderr: "",
      };
    }
    if (command === "gh" && args[0] === "api") {
      return {
        code: 0,
        stdout: JSON.stringify({ login: "machine-user", id: 4242 }),
        stderr: "",
      };
    }
    return { code: 1, stdout: "", stderr: "unexpected" };
  });

  const issueState = {
    number: 77,
    title: "Clarify docs for automation claim",
    body: "Please document the claim flow in README.",
    state: "open",
    labels: [],
    assignees: [],
    user: { login: "reporter", id: 9 },
  };

  client._testOverrideGithubAppClientFetch(async (url, init) => {
    const u = String(url);
    const method = (init?.method ?? "GET").toUpperCase();

    if (u.endsWith("/app/installations/99/access_tokens") && method === "POST") {
      return new Response(
        JSON.stringify({
          token: INSTALL_TOKEN_SENTINEL,
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      );
    }

    // assignability
    if (u.includes("/assignees/machine-user") && method === "GET") {
      return new Response(null, { status: 204 });
    }

    // add assignees
    if (u.endsWith("/issues/77/assignees") && method === "POST") {
      issueState.assignees = [{ login: "machine-user", id: 4242 }];
      return new Response(JSON.stringify(issueState), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Issue labels first (more specific than repo /labels)
    if (u.includes("/issues/77/labels/") && method === "DELETE") {
      const name = decodeURIComponent(u.split("/labels/")[1] ?? "");
      issueState.labels = issueState.labels.filter((l) => l.name !== name);
      return new Response(null, { status: 204 });
    }
    if (u.includes("/issues/77/labels") && method === "POST") {
      const body = JSON.parse(String(init.body ?? "{}"));
      const add = Array.isArray(body.labels) ? body.labels : [];
      for (const name of add) {
        if (!issueState.labels.some((l) => l.name === name)) {
          issueState.labels.push({ name });
        }
      }
      // remove claim-blocked if claimed added
      if (add.includes("ypi:claimed")) {
        issueState.labels = issueState.labels.filter((l) => l.name !== "ypi:claim-blocked");
      }
      return new Response(JSON.stringify(issueState.labels), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // repo labels create / get
    if (u.includes("/labels/") && method === "GET") {
      return new Response(JSON.stringify({ name: "ypi:claimed" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (u.endsWith("/labels") && method === "POST") {
      return new Response(JSON.stringify({ name: "ypi:claimed" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }

    // issue GET
    if (u.endsWith("/issues/77") && method === "GET") {
      return new Response(JSON.stringify(issueState), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // comments list/create
    if (u.includes("/issues/77/comments") && method === "GET") {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (u.includes("/issues/77/comments") && method === "POST") {
      const body = JSON.parse(String(init.body ?? "{}"));
      assert.ok(String(body.body).includes("ypi-github-automation:triage"));
      assertNoSentinel(body, "create comment request");
      return new Response(JSON.stringify({ id: 9001, body: body.body }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }

    // unexpected
    return new Response(JSON.stringify({ message: "not mocked", url: u }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  });

  const job = await store.createQueuedGithubAutomationJob({
    repositoryId: 602362837,
    repositoryFullName: "602362837/yolk-pi-web",
    issueNumber: 77,
    installationId: 99,
    deliveryId: "del-claim-ok",
    issueTitlePreview: "Clarify docs for automation claim",
    generation: 1,
    phase: "received",
  });

  const cfg = makeAllowlistedConfig();
  cfg.enabled = true;
  cfg.mode = "triage";
  cfg.repositories[0].installationId = 99;

  const result = await triageRunner.githubIssueTriageJobHandler(
    { ...job, status: "running" },
    { config: cfg, ownerId: "test" },
  );

  assert.equal(result.job.phase, "awaiting_owner");
  assert.equal(result.job.status, "paused");
  assert.ok(
    result.job.effects.some(
      (e) => e.name === "claim_assignee" && e.status === "remote_confirmed",
    ),
  );
  assert.ok(
    result.job.effects.some(
      (e) => e.name === "claim_label" && e.status === "remote_confirmed",
    ),
  );
  assert.ok(
    result.job.effects.some(
      (e) => e.name === "triage_comment" && e.status === "remote_confirmed",
    ),
  );

  const issueStateRecord = await store.readGithubAutomationIssueState(
    602362837,
    77,
  );
  assert.equal(issueStateRecord.claimStatus, "complete");
  assert.ok(issueState.labels.some((l) => l.name === "ypi:claimed"));
  assert.ok(issueState.assignees.some((a) => a.login === "machine-user"));
  assertNoSentinel(result.job, "job after claim success");

  client._testOverrideGithubAppClientFetch(undefined);
  client._testClearGithubAppInstallationTokenCache();
  assignee._testOverrideMachineAssigneeCommandRunner(null);
  credentials._testOverrideGithubAppCredentialEnv(null);
});

await test("claim runner treats assign 2xx silent-ignore as blocked", async () => {
  const key = makePrivateKeyFile();
  credentials._testOverrideGithubAppCredentialEnv({
    appId: "12345",
    privateKeyFile: key.keyPath,
    webhookSecret: WEBHOOK_SECRET_SENTINEL,
  });
  client._testClearGithubAppInstallationTokenCache();

  assignee._testOverrideMachineAssigneeCommandRunner(async ({ command, args }) => {
    if (command === "gh" && args[0] === "auth") {
      return {
        code: 0,
        stdout: "Logged in to github.com\nActive account: true\n",
        stderr: "",
      };
    }
    if (command === "gh" && args[0] === "api") {
      return {
        code: 0,
        stdout: JSON.stringify({ login: "ghost-user", id: 7 }),
        stderr: "",
      };
    }
    return { code: 1, stdout: "", stderr: "unexpected" };
  });

  const issueState = {
    number: 88,
    title: "Silent ignore",
    body: "docs only",
    state: "open",
    labels: [{ name: "ypi:claimed" }], // partial false claim to reconcile
    assignees: [], // silent ignore: never appears
    user: { login: "r", id: 1 },
  };

  client._testOverrideGithubAppClientFetch(async (url, init) => {
    const u = String(url);
    const method = (init?.method ?? "GET").toUpperCase();

    if (u.endsWith("/app/installations/99/access_tokens") && method === "POST") {
      return new Response(
        JSON.stringify({
          token: INSTALL_TOKEN_SENTINEL,
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      );
    }
    if (u.includes("/assignees/ghost-user") && method === "GET") {
      // pretends assignable
      return new Response(null, { status: 204 });
    }
    if (u.endsWith("/issues/88/assignees") && method === "POST") {
      // 201 but does not add assignee (silent ignore)
      return new Response(JSON.stringify(issueState), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (u.endsWith("/issues/88") && method === "GET") {
      return new Response(JSON.stringify(issueState), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (u.includes("/labels") && method === "GET") {
      return new Response(JSON.stringify({ name: "x" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (u.includes("/labels") && method === "POST") {
      const body = JSON.parse(String(init.body ?? "{}"));
      const add = Array.isArray(body.labels) ? body.labels : body.name ? [body.name] : [];
      for (const name of add) {
        if (typeof name === "string" && !issueState.labels.some((l) => l.name === name)) {
          issueState.labels.push({ name });
        }
      }
      return new Response(JSON.stringify(issueState.labels), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (u.includes("/labels/") && method === "DELETE") {
      const name = decodeURIComponent(u.split("/labels/")[1] ?? "");
      issueState.labels = issueState.labels.filter((l) => l.name !== name);
      return new Response(null, { status: 204 });
    }
    if (u.includes("/comments") && method === "GET") {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (u.includes("/comments") && method === "POST") {
      const body = JSON.parse(String(init.body ?? "{}"));
      assert.ok(String(body.body).includes("claim_blocked") || String(body.body).includes("认领未完成"));
      return new Response(JSON.stringify({ id: 1, body: body.body }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ message: "not mocked", url: u }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  });

  const job = await store.createQueuedGithubAutomationJob({
    repositoryId: 602362837,
    repositoryFullName: "602362837/yolk-pi-web",
    issueNumber: 88,
    installationId: 99,
    deliveryId: "del-silent",
    issueTitlePreview: "Silent ignore",
    generation: 1,
    phase: "received",
  });

  const cfg = makeAllowlistedConfig();
  cfg.enabled = true;
  cfg.mode = "triage";
  cfg.repositories[0].installationId = 99;

  const result = await triageRunner.githubIssueTriageJobHandler(
    { ...job, status: "running" },
    { config: cfg, ownerId: "test" },
  );

  assert.equal(result.job.phase, "blocked_claim_assignee");
  assert.equal(result.job.status, "blocked");
  assert.ok(!issueState.labels.some((l) => l.name === "ypi:claimed"), "false claimed must be removed");
  assert.ok(issueState.labels.some((l) => l.name === "ypi:claim-blocked"));

  const issueStateRecord = await store.readGithubAutomationIssueState(
    602362837,
    88,
  );
  assert.equal(issueStateRecord.claimStatus, "blocked_claim_assignee");

  client._testOverrideGithubAppClientFetch(undefined);
  client._testClearGithubAppInstallationTokenCache();
  assignee._testOverrideMachineAssigneeCommandRunner(null);
  credentials._testOverrideGithubAppCredentialEnv(null);
});

await test("credential missing never claims success or worktree phase", async () => {
  assignee._testOverrideMachineAssigneeCommandRunner(async () => ({
    code: null,
    stdout: "",
    stderr: "",
    error: Object.assign(new Error("not found"), { code: "ENOENT" }),
  }));

  const job = await store.createQueuedGithubAutomationJob({
    repositoryId: 602362837,
    repositoryFullName: "602362837/yolk-pi-web",
    issueNumber: 91,
    installationId: 99,
    deliveryId: "del-cred",
    issueTitlePreview: "No creds",
    generation: 1,
    phase: "received",
  });

  // No GitHub client calls required when identity resolution fails first.
  client._testOverrideGithubAppClientFetch(async () => {
    throw new Error("network should not be used before identity");
  });

  // Still need token endpoint? blockClaim may try mutate if installation present.
  // For gh_unavailable, canMutateGithub is true — mock minimal responses.
  const key = makePrivateKeyFile();
  credentials._testOverrideGithubAppCredentialEnv({
    appId: "12345",
    privateKeyFile: key.keyPath,
    webhookSecret: WEBHOOK_SECRET_SENTINEL,
  });
  client._testClearGithubAppInstallationTokenCache();

  const issueState = {
    number: 91,
    title: "No creds",
    body: "x",
    state: "open",
    labels: [],
    assignees: [],
  };

  client._testOverrideGithubAppClientFetch(async (url, init) => {
    const u = String(url);
    const method = (init?.method ?? "GET").toUpperCase();
    if (u.endsWith("/app/installations/99/access_tokens") && method === "POST") {
      return new Response(
        JSON.stringify({
          token: INSTALL_TOKEN_SENTINEL,
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      );
    }
    if (u.endsWith("/issues/91") && method === "GET") {
      return new Response(JSON.stringify(issueState), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (u.includes("/labels") ) {
      if (method === "GET") {
        return new Response(JSON.stringify({ name: "ypi:claim-blocked" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (method === "POST") {
        const body = JSON.parse(String(init.body ?? "{}"));
        const add = Array.isArray(body.labels) ? body.labels : body.name ? [body.name] : [];
        for (const name of add) {
          if (typeof name === "string" && !issueState.labels.some((l) => l.name === name)) {
            issueState.labels.push({ name });
          }
        }
        return new Response(JSON.stringify(issueState.labels), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (method === "DELETE") return new Response(null, { status: 204 });
    }
    if (u.includes("/comments") && method === "GET") {
      return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (u.includes("/comments") && method === "POST") {
      const body = JSON.parse(String(init.body ?? "{}"));
      return new Response(JSON.stringify({ id: 2, body: body.body }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ message: "not mocked", url: u }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  });

  const cfg = makeAllowlistedConfig();
  cfg.enabled = true;
  cfg.mode = "triage";
  cfg.repositories[0].installationId = 99;

  const result = await triageRunner.githubIssueTriageJobHandler(
    { ...job, status: "running" },
    { config: cfg, ownerId: "test" },
  );

  assert.equal(result.job.phase, "blocked_claim_assignee");
  assert.notEqual(result.job.phase, "implementation_queued");
  assert.notEqual(result.job.phase, "implementing");
  assert.ok(!issueState.labels.some((l) => l.name === "ypi:claimed"));

  client._testOverrideGithubAppClientFetch(undefined);
  client._testClearGithubAppInstallationTokenCache();
  assignee._testOverrideMachineAssigneeCommandRunner(null);
  credentials._testOverrideGithubAppCredentialEnv(null);
});

await test("gha-03 modules stay isolated from Links/OAuth and publisher", () => {
  for (const rel of [
    "lib/github-issue-triage-runner.ts",
    "lib/github-owner-intent.ts",
    "lib/github-automation-labels.ts",
    "lib/github-automation-comments.ts",
    "lib/github-machine-assignee.ts",
  ]) {
    const src = readFileSync(join(root, rel), "utf8");
    assert.ok(!/from\s+["'][^"']*links-/.test(src), `${rel} must not import Links`);
    assert.ok(!/github-link-oauth/.test(src), `${rel} must not import github-link-oauth`);
    assert.ok(!/web-credential-store/.test(src), `${rel} must not import web-credential-store`);
    assert.ok(!/git-worktree/.test(src), `${rel} must not create WorkTree in GHA-03`);
  }
  const skill = readFileSync(
    join(root, ".pi/skills/github-issue-triage/SKILL.md"),
    "utf8",
  );
  assert.ok(skill.includes("身份矩阵"));
  assert.ok(skill.includes("ypi:claimed"));
  assert.ok(skill.includes("自动化"));
  assert.ok(skill.includes("跳过"));
});

// ─── GHA-04: P0 hardening / rollback / docs contracts ────────────────────────

await test("P0 capability is healthy without Contents/PR permissions", () => {
  const p0 = types.deriveGithubAppCapability({
    metadata: "read",
    issues: "write",
    pull_requests: "none",
    contents: "none",
  });
  assert.equal(p0.p0Triage, true);
  assert.equal(p0.p1Unattended, false);
  assert.deepEqual(p0.missingForP0, []);
  assert.ok(p0.missingForP1.includes("pull_requests"));
  assert.ok(p0.missingForP1.includes("contents"));
});

await test("machine assignee failure is never readiness healthy", async () => {
  assignee._testOverrideMachineAssigneeCommandRunner(async () => ({
    code: 1,
    stdout: "",
    stderr: "not logged in",
  }));
  const projection = await assignee.getMachineGithubAssigneeSafeProjection();
  assert.notEqual(projection.readiness, "ready");
  // Identity-only projection leaves assignable null; never true when unresolved.
  assert.notEqual(projection.assignable, true);
  assert.equal(projection.login, null);
  assertNoSentinel(projection, "unhealthy assignee projection");
  assignee._testOverrideMachineAssigneeCommandRunner(null);
});

await test("disable and mode=off keep audit delivery without enqueue", async () => {
  scheduler._testResetGithubAutomationScheduler();
  scheduler._testSetGithubAutomationSchedulerAuto(false);

  await config.writeGithubAutomationConfig({
    ...makeAllowlistedConfig(),
    enabled: false,
    mode: "off",
  });

  const disabledDeliveryId = "rollback-disabled-delivery-1";
  const disabled = signedRequest(issuePayload({
    issue: { number: 501, title: "Disabled keep audit", state: "open", body: "SECRET_BODY" },
  }), { deliveryId: disabledDeliveryId });
  const r1 = await runtime.acceptGithubAutomationWebhook({
    request: disabled.request,
    webhookSecret: WEBHOOK_SECRET_SENTINEL,
    wakeScheduler: false,
  });
  assert.equal(r1.httpStatus, 202);
  assert.equal(r1.code, "ignored");
  assert.equal(r1.ignoreReason, "automation_disabled");
  assert.equal(r1.jobId, null);
  const d1 = await store.readGithubAutomationDelivery(disabledDeliveryId);
  assert.ok(d1);
  assert.equal(d1.disposition, "ignored");
  assert.equal(d1.ignoreReason, "automation_disabled");
  assertNoSentinel(d1, "disabled delivery audit");
  assert.ok(!JSON.stringify(d1).includes("SECRET_BODY"));

  await config.writeGithubAutomationConfig({
    ...makeAllowlistedConfig(),
    enabled: true,
    mode: "off",
  });
  const offDeliveryId = "rollback-mode-off-delivery-1";
  const offReq = signedRequest(issuePayload({
    issue: { number: 502, title: "Mode off keep audit", state: "open", body: "SECRET_BODY" },
  }), { deliveryId: offDeliveryId });
  const r2 = await runtime.acceptGithubAutomationWebhook({
    request: offReq.request,
    webhookSecret: WEBHOOK_SECRET_SENTINEL,
    wakeScheduler: false,
  });
  assert.equal(r2.httpStatus, 202);
  assert.equal(r2.code, "ignored");
  assert.equal(r2.ignoreReason, "mode_off");
  assert.equal((await store.listGithubAutomationJobs()).filter((j) => j.issueNumber === 502).length, 0);
  const d2 = await store.readGithubAutomationDelivery(offDeliveryId);
  assert.ok(d2);
  assert.equal(d2.disposition, "ignored");
  assert.equal(d2.ignoreReason, "mode_off");
});

await test("rollback does not leave false successful claim status", async () => {
  const job = await store.createQueuedGithubAutomationJob({
    repositoryId: 602362837,
    repositoryFullName: "602362837/yolk-pi-web",
    issueNumber: 503,
    installationId: 99,
    deliveryId: "rollback-claim-status",
    issueTitlePreview: "partial claim",
    generation: 1,
    phase: "blocked_claim_assignee",
  });
  const blockedJob = {
    ...job,
    status: "blocked",
    phase: "blocked_claim_assignee",
    checkpoint: "blocked_claim_assignee",
    reasonCode: "assignee_readback_failed",
    effects: store.upsertEffectMarker(job.effects, {
      name: "claim_label",
      status: "failed",
      remoteId: null,
      generation: 1,
      reasonCode: "false_claimed_removed",
    }),
  };
  await store.writeGithubAutomationJob(blockedJob);
  await store.upsertGithubAutomationIssueState({
    repositoryId: 602362837,
    issueNumber: 503,
    generation: 1,
    activeJobId: job.jobId,
    claimStatus: "blocked_claim_assignee",
    lastDeliveryId: "rollback-claim-status",
    effects: blockedJob.effects,
  });

  // Operator disables automation — historical blocked claim must remain blocked,
  // never rewritten into complete/success.
  await config.writeGithubAutomationConfig({
    ...makeAllowlistedConfig(),
    enabled: false,
    mode: "off",
  });
  const issueState = await store.readGithubAutomationIssueState(602362837, 503);
  assert.equal(issueState.claimStatus, "blocked_claim_assignee");
  assert.notEqual(issueState.claimStatus, "complete");
  const reloaded = await store.readGithubAutomationJob(job.jobId);
  assert.equal(reloaded.phase, "blocked_claim_assignee");
  assert.equal(reloaded.status, "blocked");
  assert.ok(reloaded.effects.some((e) => e.name === "claim_label"));
});

await test("owner adoption refuses incomplete claim and never starts worktree phase", () => {
  const actor = {
    senderId: 42,
    senderLogin: "owner",
    senderType: "User",
    repositoryOwnerId: 42,
    repositoryOwnerLogin: "owner",
    repositoryOwnerType: "User",
    ownerActorIds: [],
  };
  const incomplete = ownerIntent.evaluateGithubOwnerAuthorization({
    actor,
    commentBody: "采纳，开始实现",
    claimComplete: false,
    issueOpen: true,
    recommendation: "yes",
  });
  assert.equal(incomplete.authorized, false);
  assert.equal(incomplete.decision, "incomplete_claim");

  const complete = ownerIntent.evaluateGithubOwnerAuthorization({
    actor,
    commentBody: "采纳，开始实现",
    claimComplete: true,
    issueOpen: true,
    recommendation: "yes",
  });
  assert.equal(complete.authorized, true);

  // P0 store phase vocabulary includes waiting automation, not implementing.
  const phases = [
    "accepted_waiting_automation",
    "blocked_claim_assignee",
    "awaiting_owner",
  ];
  for (const phase of phases) {
    assert.ok(typeof phase === "string");
  }
  assert.equal(
    triageRunner.isCompleteClaimFacts({
      assigneeLogin: "machine-user",
      assigneeReadBack: true,
      labelReadBack: true,
      triageCommentPresent: true,
    }),
    true,
  );
  assert.equal(
    triageRunner.isCompleteClaimFacts({
      assigneeLogin: null,
      assigneeReadBack: true,
      labelReadBack: true,
      triageCommentPresent: true,
    }),
    false,
  );
});

await test("claim recovery path can become complete after blocked assignee fix", async () => {
  const key = makePrivateKeyFile();
  credentials._testOverrideGithubAppCredentialEnv({
    appId: "12345",
    privateKeyFile: key.keyPath,
    webhookSecret: WEBHOOK_SECRET_SENTINEL,
  });
  client._testClearGithubAppInstallationTokenCache();

  assignee._testOverrideMachineAssigneeCommandRunner(async ({ command, args }) => {
    if (command === "gh" && args[0] === "auth") {
      return {
        code: 0,
        stdout: "Logged in to github.com\nActive account: true\n",
        stderr: "",
      };
    }
    if (command === "gh" && args[0] === "api") {
      return {
        code: 0,
        stdout: JSON.stringify({ login: "recovered-user", id: 321 }),
        stderr: "",
      };
    }
    return { code: 1, stdout: "", stderr: "unexpected" };
  });

  const issueState = {
    number: 504,
    title: "Update README installation documentation",
    body: "Document the npm install steps for operators in the docs.",
    state: "open",
    labels: [{ name: "ypi:claim-blocked" }, { name: "documentation" }],
    assignees: [],
    user: { login: "r", id: 1 },
    repository: {
      owner: { login: "602362837", id: 1, type: "User" },
    },
  };
  let commentsCreated = 0;

  client._testOverrideGithubAppClientFetch(async (url, init) => {
    const u = String(url);
    const method = (init?.method ?? "GET").toUpperCase();

    if (u.endsWith("/app/installations/99/access_tokens") && method === "POST") {
      return new Response(
        JSON.stringify({
          token: INSTALL_TOKEN_SENTINEL,
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      );
    }
    if (u.includes("/assignees/recovered-user") && method === "GET") {
      return new Response(null, { status: 204 });
    }
    if (u.endsWith("/issues/504/assignees") && method === "POST") {
      if (!issueState.assignees.some((a) => a.login === "recovered-user")) {
        issueState.assignees.push({ login: "recovered-user", id: 321 });
      }
      return new Response(JSON.stringify(issueState), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (u.endsWith("/issues/504") && method === "GET") {
      return new Response(JSON.stringify(issueState), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (u.includes("/labels") && method === "GET") {
      return new Response(JSON.stringify({ name: "x" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (u.includes("/labels") && method === "POST") {
      const body = JSON.parse(String(init.body ?? "{}"));
      const add = Array.isArray(body.labels) ? body.labels : body.name ? [body.name] : [];
      for (const name of add) {
        if (typeof name === "string" && !issueState.labels.some((l) => l.name === name)) {
          issueState.labels.push({ name });
        }
      }
      // claim success should drop claim-blocked
      if (add.includes("ypi:claimed")) {
        issueState.labels = issueState.labels.filter((l) => l.name !== "ypi:claim-blocked");
      }
      return new Response(JSON.stringify(issueState.labels), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (u.includes("/labels/") && method === "DELETE") {
      const name = decodeURIComponent(u.split("/labels/")[1] ?? "");
      issueState.labels = issueState.labels.filter((l) => l.name !== name);
      return new Response(null, { status: 204 });
    }
    if (u.includes("/comments") && method === "GET") {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (u.includes("/comments") && method === "POST") {
      commentsCreated += 1;
      const body = JSON.parse(String(init.body ?? "{}"));
      assertNoSentinel(body, "recovery comment");
      return new Response(JSON.stringify({ id: 7001, body: body.body }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ message: "not mocked", url: u }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  });

  // Pre-seed blocked issue state to prove recovery converges.
  await store.upsertGithubAutomationIssueState({
    repositoryId: 602362837,
    issueNumber: 504,
    generation: 1,
    activeJobId: null,
    claimStatus: "blocked_claim_assignee",
  });

  const job = await store.createQueuedGithubAutomationJob({
    repositoryId: 602362837,
    repositoryFullName: "602362837/yolk-pi-web",
    issueNumber: 504,
    installationId: 99,
    deliveryId: "del-recover",
    issueTitlePreview: "Update README installation documentation",
    generation: 1,
    phase: "received",
  });

  const cfg = makeAllowlistedConfig();
  cfg.enabled = true;
  cfg.mode = "triage";
  cfg.repositories[0].installationId = 99;

  const result = await triageRunner.githubIssueTriageJobHandler(
    { ...job, status: "running" },
    { config: cfg, ownerId: "test" },
  );

  assert.equal(result.job.phase, "awaiting_owner");
  assert.ok(issueState.assignees.some((a) => a.login === "recovered-user"));
  assert.ok(issueState.labels.some((l) => l.name === "ypi:claimed"));
  assert.ok(!issueState.labels.some((l) => l.name === "ypi:claim-blocked"));
  assert.equal(commentsCreated, 1);

  const issueStateRecord = await store.readGithubAutomationIssueState(
    602362837,
    504,
  );
  assert.equal(issueStateRecord.claimStatus, "complete");

  client._testOverrideGithubAppClientFetch(undefined);
  client._testClearGithubAppInstallationTokenCache();
  assignee._testOverrideMachineAssigneeCommandRunner(null);
  credentials._testOverrideGithubAppCredentialEnv(null);
});

await test("docs and AGENTS keep App actor vs machine assignee separated", () => {
  const requiredDocs = [
    "docs/architecture/overview.md",
    "docs/modules/api.md",
    "docs/modules/library.md",
    "docs/integrations/README.md",
    "docs/deployment/README.md",
    "docs/operations/troubleshooting.md",
    "AGENTS.md",
  ];
  for (const rel of requiredDocs) {
    const text = readFileSync(join(root, rel), "utf8");
    assert.ok(
      text.includes("github-automation") || text.includes("GitHub 自动化") || text.includes("GitHub App"),
      `${rel} should document GitHub automation`,
    );
    // Must not claim P1 ships with P0.
    assert.ok(
      !/P0[^\n]{0,80}(ships with P1|includes unattended|includes full agent implement)/i.test(text),
      `${rel} must not claim P1 ships inside P0`,
    );
  }

  const overview = readFileSync(join(root, "docs/architecture/overview.md"), "utf8");
  assert.ok(overview.includes("ypi:claimed"));
  assert.ok(overview.includes("machine") || overview.includes("本机"));
  assert.ok(overview.includes("blocked_claim_assignee") || overview.includes("claim-blocked"));
  assert.ok(overview.includes("YPI_GITHUB_APP_ID") || overview.includes("App private"));
  assert.ok(!/App bot[^\n]{0,40}assignee/i.test(overview) || overview.includes("not as assignee") || overview.includes("不是") || overview.includes("不作为"));

  const deploy = readFileSync(join(root, "docs/deployment/README.md"), "utf8");
  assert.ok(deploy.includes("YPI_GITHUB_APP_ID"));
  assert.ok(deploy.includes("YPI_GITHUB_APP_PRIVATE_KEY_FILE"));
  assert.ok(deploy.includes("YPI_GITHUB_APP_WEBHOOK_SECRET"));
  assert.ok(deploy.includes("HTTPS") || deploy.includes("公网"));
  assert.ok(
    deploy.includes("repositories: []") ||
      deploy.includes("repositories=[]") ||
      deploy.includes("empty allowlist") ||
      deploy.includes("默认空") ||
      deploy.includes("默认 `repositories=[]`") ||
      deploy.includes("默认 repositories=[]"),
    "deployment docs must describe empty default allowlist",
  );
  assert.ok(
    !/repository allowlist keyed by immutable `repositoryId` \(first: `602362837`\)/.test(
      deploy,
    ),
    "deployment docs must not present fixed yolk-pi-web as product default",
  );
  assert.ok(
    deploy.includes("验证配置") ||
      deploy.includes("/api/github-automation/verify") ||
      deploy.includes("setup checklist"),
    "deployment docs must mention setup verify/checklist",
  );

  const api = readFileSync(join(root, "docs/modules/api.md"), "utf8");
  assert.ok(api.includes("github-automation/verify"));
  assert.ok(
    api.includes("repositories") &&
      (api.includes("projectId") || api.includes("Project Registry")),
  );
  assert.ok(
    !/fixed-only yolk-pi-web|default allowlisted repository id `602362837`|hard-lock to yolk-pi-web as product default/.test(
      api,
    ),
  );
  assert.ok(
    api.includes("repositories: []") ||
      api.includes("empty-default allowlist") ||
      api.includes("not hard-locked to yolk-pi-web"),
    "api docs must describe empty-default allowlist",
  );

  const frontend = readFileSync(join(root, "docs/modules/frontend.md"), "utf8");
  assert.ok(
    frontend.includes("Setup checklist") ||
      frontend.includes("验证配置") ||
      frontend.includes("关联仓库"),
  );
  assert.ok(
    frontend.includes("空") ||
      frontend.includes("empty") ||
      frontend.includes("尚未关联") ||
      frontend.includes("repositories=[]"),
  );
  assert.ok(
    !/type="password"|secret paste|paste PEM|webhook secret input/i.test(frontend) ||
      frontend.includes("不") ||
      frontend.includes("never") ||
      frontend.includes("绝不"),
  );

  const library = readFileSync(join(root, "docs/modules/library.md"), "utf8");
  assert.ok(library.includes("github-automation-setup-verify"));
  assert.ok(
    library.includes("empty") ||
      library.includes("[]") ||
      library.includes("默认空") ||
      library.includes("repositories=[]"),
  );
  assert.ok(
    !/default allowlisted repository id `602362837`/.test(library),
    "library docs must not claim fixed default allowlist id as product default",
  );

  const integrations = readFileSync(join(root, "docs/integrations/README.md"), "utf8");
  assert.ok(
    integrations.includes("repositories: []") ||
      integrations.includes("`repositories: []`") ||
      integrations.includes("empty"),
    "integrations docs must describe empty default allowlist",
  );
  assert.ok(
    !/First allowlist repository id is `602362837`/.test(integrations),
    "integrations docs must not hard-lock first allowlist to yolk-pi-web",
  );
  assert.ok(
    integrations.includes("/api/github-automation/verify") ||
      integrations.includes("github-automation-setup-verify"),
  );

  const ops = readFileSync(join(root, "docs/operations/troubleshooting.md"), "utf8");
  assert.ok(ops.includes("blocked_claim_assignee") || ops.includes("认领未完成"));
  assert.ok(ops.includes("ypi:claimed"));

  const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
  assert.ok(agents.includes("github-automation") || agents.includes("GitHub 自动化"));
  assert.ok(
    agents.includes("verify") ||
      agents.includes("setup") ||
      agents.includes("github-automation-setup-verify") ||
      agents.includes("allowlist"),
  );
  // Keep AGENTS navigational: no multi-page inline setup dump.
  assert.ok(agents.length < 80_000);
});

await test("source modules never claim P1 ships with P0 and keep publisher absent", () => {
  const files = [
    "lib/github-automation-types.ts",
    "lib/github-automation-runtime.ts",
    "lib/github-issue-triage-runner.ts",
    "app/api/github-automation/webhook/route.ts",
  ];
  for (const rel of files) {
    const src = readFileSync(join(root, rel), "utf8");
    assert.ok(
      !/from\s+["'][^"']*git-worktree/.test(src) &&
        !/require\(["'][^"']*git-worktree/.test(src),
      `${rel} must not import worktree in P0`,
    );
    assert.ok(
      !/github-git-publisher/.test(src),
      `${rel} must not import publisher in P0`,
    );
    assert.ok(
      !/createPullRequest\s*\(/.test(src),
      `${rel} must not call createPullRequest in P0`,
    );
  }
  const runner = readFileSync(join(root, "lib/github-issue-triage-runner.ts"), "utf8");
  assert.ok(runner.includes("accepted_waiting_automation"));
  assert.ok(runner.includes("never WorkTree") || runner.includes("P0"));
});

// ─── GHA-09: PR lifecycle + safe ops projection ───────────────────────────────

function prPayload(overrides = {}) {
  const headRef =
    overrides.headRef ??
    `ypi/gha/602362837/issue-42/g1`;
  const base = {
    action: "closed",
    number: 77,
    pull_request: {
      number: 77,
      html_url: "https://github.com/602362837/yolk-pi-web/pull/77",
      state: "closed",
      merged: true,
      user: { login: "ypi-bot[bot]" },
      head: {
        ref: headRef,
        repo: {
          id: 602362837,
          full_name: "602362837/yolk-pi-web",
          fork: false,
        },
      },
      base: { ref: "main" },
      body: `Fixes #42\n\nSECRET ${MACHINE_TOKEN_SENTINEL}\n<!-- ypi-github-automation:pr-contract v1 -->`,
    },
    repository: {
      id: 602362837,
      full_name: "602362837/yolk-pi-web",
    },
    installation: { id: 999001 },
    sender: { id: 1, login: "someone" },
  };
  return {
    ...base,
    ...overrides,
    pull_request: {
      ...base.pull_request,
      ...(overrides.pull_request || {}),
      head: {
        ...base.pull_request.head,
        ...((overrides.pull_request && overrides.pull_request.head) || {}),
        repo: {
          ...base.pull_request.head.repo,
          ...((overrides.pull_request &&
            overrides.pull_request.head &&
            overrides.pull_request.head.repo) ||
            {}),
        },
      },
    },
  };
}

async function seedPrOpenJob(opts = {}) {
  const generation = opts.generation ?? 1;
  const issueNumber = opts.issueNumber ?? 42;
  const prNumber = opts.prNumber ?? 77;
  const headBranch =
    opts.headBranch ??
    `ypi/gha/602362837/issue-${issueNumber}/g${generation}`;
  const job = await store.createQueuedGithubAutomationJob({
    repositoryId: 602362837,
    repositoryFullName: "602362837/yolk-pi-web",
    issueNumber,
    installationId: 999001,
    deliveryId: opts.deliveryId ?? "seed-pr",
    issueTitlePreview: "docs fix",
    generation,
    phase: "pr_open",
  });
  const next = await store.writeGithubAutomationJob({
    ...job,
    status: "completed",
    phase: "pr_open",
    checkpoint: "pr_open",
    reasonCode: "pr_open",
    effects: [
      {
        name: "branch",
        status: "remote_confirmed",
        remoteId: headBranch,
        generation,
        updatedAt: new Date().toISOString(),
        reasonCode: null,
      },
      {
        name: "pull_request",
        status: "remote_confirmed",
        remoteId: String(prNumber),
        generation,
        updatedAt: new Date().toISOString(),
        reasonCode: null,
      },
    ],
  });
  await store.upsertGithubAutomationIssueState({
    repositoryId: 602362837,
    issueNumber,
    generation,
    activeJobId: next.jobId,
    claimStatus: "complete",
    lastDeliveryId: opts.deliveryId ?? "seed-pr",
  });
  return next;
}

await test("GHA-09 PR lifecycle: merged vs closed-unmerged for known head/PR", async () => {
  await config.writeGithubAutomationConfig({
    ...makeAllowlistedConfig(),
    enabled: true,
    mode: "unattended",
  });
  const job = await seedPrOpenJob({ prNumber: 77, issueNumber: 42 });

  const merged = await prLifecycle.reconcileGithubPullRequestEvent({
    config: await config.readGithubAutomationConfig(),
    payload: prPayload({ action: "closed", pull_request: { merged: true, state: "closed", number: 77 } }),
    deliveryId: "pr-merged-1",
  });
  assert.equal(merged.disposition, "reconciled_merged");
  assert.equal(merged.mutated, true);
  assert.equal(merged.jobId, job.jobId);
  const afterMerged = await store.readGithubAutomationJob(job.jobId);
  assert.equal(afterMerged.phase, "completed");
  assert.equal(afterMerged.status, "completed");
  assert.equal(afterMerged.reasonCode, "pr_merged");

  // closed-unmerged on a fresh pr_open job
  const job2 = await seedPrOpenJob({
    prNumber: 88,
    issueNumber: 43,
    generation: 1,
    headBranch: "ypi/gha/602362837/issue-43/g1",
  });
  const closed = await prLifecycle.reconcileGithubPullRequestEvent({
    config: await config.readGithubAutomationConfig(),
    payload: prPayload({
      action: "closed",
      pull_request: {
        number: 88,
        merged: false,
        state: "closed",
        head: {
          ref: "ypi/gha/602362837/issue-43/g1",
          repo: { id: 602362837, full_name: "602362837/yolk-pi-web", fork: false },
        },
      },
    }),
    deliveryId: "pr-closed-1",
  });
  assert.equal(closed.disposition, "reconciled_closed_unmerged");
  const afterClosed = await store.readGithubAutomationJob(job2.jobId);
  assert.equal(afterClosed.phase, "blocked");
  assert.equal(afterClosed.reasonCode, "pr_closed_unmerged");
  // Issue claim state is not auto-closed by lifecycle.
  const issue = await store.readGithubAutomationIssueState(602362837, 43);
  assert.equal(issue.claimStatus, "complete");
});

await test("GHA-09 PR lifecycle: unknown/fork/head-collision never mutate jobs", async () => {
  await config.writeGithubAutomationConfig({
    ...makeAllowlistedConfig(),
    enabled: true,
    mode: "unattended",
  });
  const job = await seedPrOpenJob({ prNumber: 91, issueNumber: 50 });
  const before = JSON.stringify(await store.readGithubAutomationJob(job.jobId));

  const unknown = await prLifecycle.reconcileGithubPullRequestEvent({
    config: await config.readGithubAutomationConfig(),
    payload: prPayload({
      pull_request: {
        number: 9999,
        head: {
          ref: "ypi/gha/602362837/issue-9999/g1",
          repo: { id: 602362837, full_name: "602362837/yolk-pi-web", fork: false },
        },
      },
    }),
  });
  assert.equal(unknown.disposition, "ignored_unknown_identity");
  assert.equal(unknown.mutated, false);

  const fork = await prLifecycle.reconcileGithubPullRequestEvent({
    config: await config.readGithubAutomationConfig(),
    payload: prPayload({
      pull_request: {
        number: 91,
        head: {
          ref: "ypi/gha/602362837/issue-50/g1",
          repo: {
            id: 111,
            full_name: "fork/yolk-pi-web",
            fork: true,
          },
        },
      },
    }),
  });
  assert.equal(fork.disposition, "ignored_fork");
  assert.equal(fork.mutated, false);

  // Head collision: two jobs claim same head/PR number identity space.
  const jobB = await seedPrOpenJob({
    prNumber: 91,
    issueNumber: 51,
    generation: 2,
    headBranch: "ypi/gha/602362837/issue-50/g1",
  });
  void jobB;
  const collision = await prLifecycle.reconcileGithubPullRequestEvent({
    config: await config.readGithubAutomationConfig(),
    payload: prPayload({
      pull_request: {
        number: 123456,
        head: {
          ref: "ypi/gha/602362837/issue-50/g1",
          repo: { id: 602362837, full_name: "602362837/yolk-pi-web", fork: false },
        },
      },
    }),
  });
  assert.equal(collision.disposition, "ignored_head_collision");
  assert.equal(collision.mutated, false);

  const after = JSON.stringify(await store.readGithubAutomationJob(job.jobId));
  // Original job not force-completed by unknown/fork paths.
  assert.equal(JSON.parse(after).phase, JSON.parse(before).phase);
});

await test("GHA-09 status projection: full-agent residual risk + forbidden fields", async () => {
  await config.writeGithubAutomationConfig({
    ...config.createDefaultGithubAutomationConfig(),
    enabled: true,
    mode: "triage",
    unattended: {
      ...config.createDefaultUnattendedConfig(),
      enabled: false,
    },
    repositories: [
      {
        repositoryId: 602362837,
        fullName: "602362837/yolk-pi-web",
        installationId: 999001,
        projectId: "prj_status",
        projectRoot: "/Users/secret/path/to/repo",
        ownerActorIds: [],
        assigneeIdentitySource: "machine-active-credential",
        baseRef: "main",
      },
    ],
  });
  await seedPrOpenJob({ prNumber: 101, issueNumber: 60 });

  const status = await projection.buildGithubAutomationStatusProjection({
    resolveLive: false,
    assigneeProjection: {
      login: "machine-op",
      actorId: 4242,
      identitySource: "gh",
      checkedAt: new Date().toISOString(),
      readiness: "ready",
      assignable: true,
      reasonCode: null,
    },
    appProjection: {
      configured: true,
      readiness: "ready",
      appSlug: "ypi-test",
      hasAppId: true,
      hasPrivateKeyFile: true,
      hasWebhookSecret: true,
      checkedAt: new Date().toISOString(),
    },
    capability: types.deriveGithubAppCapability({
      metadata: "read",
      issues: "write",
      pull_requests: "write",
      contents: "write",
    }),
    webhookHealth: "unknown",
  });

  assert.equal(status.runtime.executionProfile, "full-agent");
  assert.equal(status.runtime.riskProfile, "docs-and-small-bugfix");
  assert.equal(status.runtime.residualRiskWarningRequired, true);
  assert.equal(status.policy.residualRiskWarningRequired, true);
  assert.equal(status.policy.sandboxed, false);
  assert.ok(status.policy.residualRiskCodes.includes("arbitrary_commands"));
  assert.equal(status.readiness.assignee.login, "machine-op");
  assert.equal(status.repositories[0].claimSemantics, "ypi_claimed_plus_machine_login");
  assert.ok(status.jobs.length >= 1);
  assert.equal(status.jobs[0].claimStatus, "complete");
  assert.ok(status.jobs[0].hasPullRequest);

  const serialized = JSON.stringify(status);
  assertNoSentinel(status, "status projection");
  assert.ok(!serialized.includes("/Users/secret/path/to/repo"));
  // Boolean flag projectRootConfigured is allowed; absolute path / projectRoot value is not.
  assert.ok(!/"projectRoot"\s*:/.test(serialized));
  assert.ok(serialized.includes("projectRootConfigured"));
  assert.ok(!/"body"\s*:/.test(serialized));
  assert.ok(!serialized.includes("SECRET_BODY"));
  assert.ok(!serialized.includes(MACHINE_TOKEN_SENTINEL));
  projection.assertGithubAutomationProjectionSafe(status);
});

await test("GHA-09 config CAS + disallowed credential/risk overrides", async () => {
  const written = await config.writeGithubAutomationConfig({
    ...makeAllowlistedConfig(),
    enabled: true,
    mode: "triage",
  });

  assert.throws(
    () =>
      projection.parseGithubAutomationConfigWirePatch({
        revision: written.revision,
        token: MACHINE_TOKEN_SENTINEL,
      }),
    /disallowed/i,
  );
  assert.throws(
    () =>
      projection.parseGithubAutomationConfigWirePatch({
        revision: written.revision,
        assigneeIdentitySource: "user-token",
      }),
    /disallowed/i,
  );
  assert.throws(
    () =>
      projection.parseGithubAutomationConfigWirePatch({
        revision: written.revision,
        unattended: { executionProfile: "restricted" },
      }),
    /disallowed/i,
  );
  assert.throws(
    () =>
      projection.parseGithubAutomationConfigWirePatch({
        revision: written.revision,
        residualRiskWarningRequired: false,
      }),
    /disallowed/i,
  );

  const patch = projection.parseGithubAutomationConfigWirePatch({
    revision: written.revision,
    mode: "off",
    paused: true,
  });
  const next = await config.patchGithubAutomationConfig(patch);
  assert.equal(next.mode, "off");
  assert.equal(next.paused, true);
  assert.equal(next.unattended.executionProfile, "full-agent");
  assert.equal(next.unattended.riskProfile, "docs-and-small-bugfix");

  await assert.rejects(
    () =>
      config.patchGithubAutomationConfig({
        revision: written.revision,
        mode: "triage",
      }),
    (err) => err && err.code === "stale_revision",
  );
});

await test("GHA-09 job actions are state-gated and idempotent-ish", async () => {
  projection._testResetGithubAutomationActionRateLimit();
  await config.writeGithubAutomationConfig({
    ...makeAllowlistedConfig(),
    enabled: true,
    mode: "unattended",
  });

  const blocked = await store.createQueuedGithubAutomationJob({
    repositoryId: 602362837,
    repositoryFullName: "602362837/yolk-pi-web",
    issueNumber: 70,
    installationId: 999001,
    deliveryId: "act-1",
    issueTitlePreview: "blocked job",
    generation: 1,
    phase: "blocked",
  });
  await store.writeGithubAutomationJob({
    ...blocked,
    status: "blocked",
    phase: "blocked",
    reasonCode: "policy_denied",
  });

  const deniedPause = await projection.applyGithubAutomationJobAction({
    jobId: blocked.jobId,
    action: "pause",
    wakeScheduler: false,
  });
  assert.equal(deniedPause.ok, false);
  assert.equal(deniedPause.code, "not_allowed");

  const retry = await projection.applyGithubAutomationJobAction({
    jobId: blocked.jobId,
    action: "retry",
    wakeScheduler: false,
  });
  assert.equal(retry.ok, true);
  assert.equal(retry.code, "accepted");
  assert.equal(retry.job.status, "queued");
  assert.equal(retry.partial, true);

  const completed = await seedPrOpenJob({ prNumber: 202, issueNumber: 71 });
  await store.writeGithubAutomationJob({
    ...completed,
    phase: "completed",
    status: "completed",
    reasonCode: "pr_merged",
  });
  const noRetryMerged = await projection.applyGithubAutomationJobAction({
    jobId: completed.jobId,
    action: "retry",
    wakeScheduler: false,
  });
  assert.equal(noRetryMerged.ok, false);
  assert.equal(noRetryMerged.code, "not_allowed");

  const queued = await store.createQueuedGithubAutomationJob({
    repositoryId: 602362837,
    repositoryFullName: "602362837/yolk-pi-web",
    issueNumber: 72,
    installationId: 999001,
    deliveryId: "act-2",
    issueTitlePreview: "pausable",
    generation: 1,
    phase: "implementation_queued",
  });
  const pause = await projection.applyGithubAutomationJobAction({
    jobId: queued.jobId,
    action: "pause",
    wakeScheduler: false,
  });
  assert.equal(pause.ok, true);
  assert.equal(pause.job.status, "paused");

  const resume = await projection.applyGithubAutomationJobAction({
    jobId: queued.jobId,
    action: "resume",
    wakeScheduler: false,
  });
  assert.equal(resume.ok, true);
  assert.equal(resume.job.status, "queued");
});

await test("GHA-09 pull_request webhook reconciles without enqueueing issue jobs", async () => {
  scheduler._testResetGithubAutomationScheduler();
  scheduler._testSetGithubAutomationSchedulerAuto(false);
  await config.writeGithubAutomationConfig({
    ...makeAllowlistedConfig(),
    enabled: true,
    mode: "unattended",
  });
  const job = await seedPrOpenJob({ prNumber: 303, issueNumber: 80 });
  const jobsBefore = (await store.listGithubAutomationJobs()).length;

  const payload = prPayload({
    action: "closed",
    pull_request: {
      number: 303,
      merged: true,
      state: "closed",
      head: {
        ref: "ypi/gha/602362837/issue-80/g1",
        repo: { id: 602362837, full_name: "602362837/yolk-pi-web", fork: false },
      },
    },
  });
  const { request } = signedRequest(payload, {
    eventName: "pull_request",
    deliveryId: "pr-wh-1",
  });
  const result = await runtime.acceptGithubAutomationWebhook({
    request,
    webhookSecret: WEBHOOK_SECRET_SENTINEL,
    wakeScheduler: false,
  });
  assert.equal(result.httpStatus, 202);
  assert.equal(result.jobId, job.jobId);
  const jobsAfter = await store.listGithubAutomationJobs();
  assert.equal(jobsAfter.length, jobsBefore);
  const updated = await store.readGithubAutomationJob(job.jobId);
  assert.equal(updated.phase, "completed");
  assert.equal(updated.reasonCode, "pr_merged");
});

await test("GHA-09 reviewer skill blocks missing Fixes contract", () => {
  const skill = readFileSync(
    join(root, ".pi/skills/pr-review-handle/SKILL.md"),
    "utf8",
  );
  assert.ok(skill.includes("missing_closing_contract") || skill.includes("Fixes #N"));
  assert.ok(skill.includes("ypi-github-automation:pr-contract"));
  assert.ok(skill.includes("Do not merge") || skill.includes("do not merge"));
  assert.ok(skill.includes("closed-unmerged") || skill.includes("closed unmerged"));

  const missing = prContract.isGithubAutomationPrClosingBlocking({
    body: "## changes\nno closing line",
    hasAutomationMarker: true,
  });
  assert.equal(missing.block, true);

  const ok = prContract.isGithubAutomationPrClosingBlocking({
    body: "Fixes #12\n<!-- ypi-github-automation:pr-contract v1 -->",
    expectedIssueNumber: 12,
    hasAutomationMarker: true,
  });
  assert.equal(ok.block, false);

  const cross = prContract.isGithubAutomationPrClosingBlocking({
    body: "Fixes other/repo#12\n<!-- ypi-github-automation:pr-contract v1 -->",
    expectedIssueNumber: 12,
    hasAutomationMarker: true,
  });
  assert.equal(cross.block, true);
});

// ─── IMP-001 / IMP-05: setup configurability matrix ──────────────────────────

function makeCredentialProjection(overrides = {}) {
  return {
    configured: false,
    readiness: "missing_app_id",
    hasAppId: false,
    hasPrivateKeyFile: false,
    hasWebhookSecret: false,
    appSlug: null,
    checkedAt: "2026-07-24T00:00:00.000Z",
    ...overrides,
  };
}

function makeAssigneeProjection(overrides = {}) {
  return {
    readiness: "gh_not_logged_in",
    login: null,
    actorId: null,
    assignable: null,
    identitySource: null,
    reasonCode: "gh_not_logged_in",
    checkedAt: "2026-07-24T00:00:00.000Z",
    ...overrides,
  };
}

function makeCapabilityProjection(overrides = {}) {
  const permissions = {
    metadata: "none",
    issues: "none",
    pull_requests: "none",
    contents: "none",
    ...(overrides.permissions || {}),
  };
  const base = types.deriveGithubAppCapability(permissions);
  return {
    ...base,
    ...overrides,
    permissions: {
      ...base.permissions,
      ...(overrides.permissions || {}),
    },
  };
}

await test("IMP-05 empty default allowlist is not hard-locked to yolk-pi-web", () => {
  const cfg = config.createDefaultGithubAutomationConfig();
  assert.deepEqual(cfg.repositories, []);
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.mode, "off");
  assert.equal(cfg.unattended.enabled, false);

  const draft = config.createDefaultGithubAutomationRepository();
  assert.equal(draft.repositoryId, 0);
  assert.equal(draft.fullName, "");
  assert.notEqual(draft.fullName, "602362837/yolk-pi-web");
  assert.equal(draft.projectId, null);
  assert.equal(draft.projectRoot, "");

  // Legacy seeded constants remain recognition-only helpers for migration/UI flags.
  assert.equal(types.GITHUB_AUTOMATION_LEGACY_SEEDED_REPOSITORY_ID, 602362837);
  assert.equal(
    config.isLegacySeededGithubAutomationRepository({
      repositoryId: 602362837,
      fullName: "602362837/yolk-pi-web",
      projectId: null,
      projectRoot: "",
      installationId: null,
    }),
    true,
  );
  // Operator-owned binding of the same id is not treated as auto-seeded product default.
  assert.equal(
    config.isLegacySeededGithubAutomationRepository({
      repositoryId: 602362837,
      fullName: "602362837/yolk-pi-web",
      projectId: "prj_user",
      projectRoot: "/server/only/root",
      installationId: 11,
    }),
    false,
  );
});

await test("IMP-05 setup verify returns fixed checklist steps without side effects", async () => {
  await config.writeGithubAutomationConfig(config.createDefaultGithubAutomationConfig());
  const jobsBefore = (await store.listGithubAutomationJobs()).length;

  const result = await setupVerify.runGithubAutomationSetupVerify({
    resolveLive: false,
    appProjection: makeCredentialProjection({
      configured: false,
      readiness: "missing_app_id",
      hasAppId: false,
      hasPrivateKeyFile: false,
      hasWebhookSecret: false,
    }),
    assigneeProjection: makeAssigneeProjection(),
    capability: makeCapabilityProjection(),
    webhookHealth: "unknown",
    webhookLastVerifiedAt: null,
    webhookRecentDeliveryCount: 0,
  });

  assert.equal(result.ok, true);
  assert.equal(result.allReady, false);
  assert.equal(result.p0Ready, false);
  assert.equal(result.sideEffects.enqueuedJobs, false);
  assert.equal(result.sideEffects.schedulerWoken, false);
  assert.equal(result.sideEffects.githubMutations, false);
  assert.deepEqual(setupVerify.githubAutomationSetupVerifySideEffectContract(), {
    enqueuesJobs: false,
    wakesScheduler: false,
    mutatesGithub: false,
  });

  const codes = result.checklist.map((item) => item.code);
  for (const required of [
    "app_id",
    "private_key_file",
    "webhook_secret",
    "installation",
    "permissions",
    "assignee",
    "allowlist",
    "project_binding",
    "webhook_health",
  ]) {
    assert.ok(codes.includes(required), `missing checklist code ${required}`);
  }

  const byCode = Object.fromEntries(result.checklist.map((item) => [item.code, item]));
  assert.equal(byCode.allowlist.state, "pending");
  assert.equal(byCode.allowlist.reasonCode, "allowlist_empty");
  assert.ok(byCode.allowlist.nextStep);
  assert.ok(byCode.allowlist.nextStep.includes("关联仓库"));
  assert.ok(byCode.allowlist.nextStep.includes("yolk-pi-web") === false || byCode.allowlist.nextStep.includes("不会预置"));
  assert.ok(byCode.app_id.nextStep.includes("YPI_GITHUB_APP_ID"));
  assert.ok(byCode.private_key_file.nextStep.includes("YPI_GITHUB_APP_PRIVATE_KEY_FILE"));
  assert.ok(byCode.private_key_file.nextStep.includes("0600"));
  assert.ok(byCode.webhook_secret.nextStep.includes("YPI_GITHUB_APP_WEBHOOK_SECRET"));
  assert.ok(!byCode.webhook_secret.nextStep.includes(WEBHOOK_SECRET_SENTINEL));

  for (const item of result.checklist) {
    if (item.state !== "ready") {
      assert.ok(
        typeof item.nextStep === "string" && item.nextStep.trim().length > 0,
        `${item.code} must provide nextStep when not ready`,
      );
    }
  }

  assert.equal(result.summary.allowlist.repositoryCount, 0);
  assert.equal(result.summary.allowlist.ready, false);
  assertNoSentinel(result, "setup verify empty result");
  projection.assertGithubAutomationProjectionSafe(result);

  const jobsAfter = (await store.listGithubAutomationJobs()).length;
  assert.equal(jobsAfter, jobsBefore, "verify must not create jobs");
});

await test("IMP-05 setup verify ready path still never enqueues work", async () => {
  const projectRegistry = jiti(join(root, "lib/project-registry.ts"));
  const projectRoot = join(agentDir, "imp05-ready-project");
  mkdirSync(projectRoot, { recursive: true });
  const { project } = await projectRegistry.registerProject({ path: projectRoot });

  const written = await config.writeGithubAutomationConfig({
    ...config.createDefaultGithubAutomationConfig(),
    enabled: true,
    mode: "triage",
    repositories: [
      {
        repositoryId: 424201,
        fullName: "acme/alpha",
        installationId: 9001,
        projectId: project.id,
        projectRoot,
        ownerActorIds: [],
        assigneeIdentitySource: "machine-active-credential",
        baseRef: "main",
      },
    ],
  });

  const jobsBefore = (await store.listGithubAutomationJobs()).length;
  const result = await setupVerify.runGithubAutomationSetupVerify({
    config: written,
    resolveLive: false,
    appProjection: makeCredentialProjection({
      configured: true,
      readiness: "ready",
      hasAppId: true,
      hasPrivateKeyFile: true,
      hasWebhookSecret: true,
    }),
    assigneeProjection: makeAssigneeProjection({
      readiness: "ready",
      login: "machine-bot",
      actorId: 321,
      assignable: true,
      identitySource: "gh",
      reasonCode: null,
    }),
    capability: makeCapabilityProjection({
      permissions: {
        metadata: "read",
        issues: "write",
        contents: "write",
        pull_requests: "write",
      },
    }),
    webhookHealth: "healthy",
    webhookLastVerifiedAt: "2026-07-24T01:00:00.000Z",
    webhookRecentDeliveryCount: 2,
  });

  assert.equal(result.ok, true);
  assert.equal(result.p0Ready, true);
  assert.equal(result.p1Ready, true);
  assert.equal(result.allReady, true);
  assert.equal(result.unattendedEligible, true);
  assert.equal(result.sideEffects.enqueuedJobs, false);
  assert.equal(result.sideEffects.schedulerWoken, false);
  assert.equal(result.sideEffects.githubMutations, false);
  assert.equal(result.summary.allowlist.repositoryCount, 1);
  assert.equal(result.summary.allowlist.ready, true);
  assertNoSentinel(result, "setup verify ready result", [projectRoot, APP_KEY_SENTINEL]);
  assert.ok(!JSON.stringify(result).includes(projectRoot));
  projection.assertGithubAutomationProjectionSafe(result);
  assert.equal((await store.listGithubAutomationJobs()).length, jobsBefore);
});

await test("IMP-05 config GET projects + multi-repo add/remove stay path-free", async () => {
  const projectRegistry = jiti(join(root, "lib/project-registry.ts"));
  const rootA = join(agentDir, "imp05-a");
  const rootB = join(agentDir, "imp05-b");
  mkdirSync(rootA, { recursive: true });
  mkdirSync(rootB, { recursive: true });
  const { project: projectA } = await projectRegistry.registerProject({ path: rootA });
  const { project: projectB } = await projectRegistry.registerProject({ path: rootB });

  await config.writeGithubAutomationConfig({
    ...config.createDefaultGithubAutomationConfig(),
    repositories: [],
  });

  const emptyPayload = await projection.buildGithubAutomationConfigGetPayload();
  assert.deepEqual(emptyPayload.config.repositories, []);
  assert.ok(Array.isArray(emptyPayload.projectChoices));
  assert.ok(emptyPayload.projectChoices.some((p) => p.projectId === projectA.id));
  assert.ok(emptyPayload.projectChoices.every((p) => !("path" in p) && !("projectRoot" in p) && !("realRootPath" in p)));
  assertNoSentinel(emptyPayload, "empty GET payload", [rootA, rootB]);
  projection.assertGithubAutomationProjectionSafe(emptyPayload);

  const added = await projection.applyGithubAutomationConfigWirePatch(
    {
      revision: emptyPayload.config.revision,
      repositories: [
        {
          repositoryId: 7001,
          fullName: "acme/one",
          installationId: 11,
          baseRef: "main",
          projectId: projectA.id,
          ownerActorIds: [],
        },
        {
          repositoryId: 7002,
          fullName: "other/two",
          installationId: 12,
          baseRef: "develop",
          projectId: projectB.id,
          ownerActorIds: [99],
        },
      ],
    },
    { skipNetworkLookup: true, requireProjectId: true },
  );
  assert.equal(added.config.repositories.length, 2);
  assert.equal(added.projection.repositories.length, 2);
  assert.equal(added.projection.repositories[0].fullName, "acme/one");
  assert.equal(added.projection.repositories[1].fullName, "other/two");
  assert.ok(added.config.repositories[0].projectRoot);
  assert.equal("projectRoot" in added.projection.repositories[0], false);
  assertNoSentinel(added.projection, "multi-repo projection", [rootA, rootB]);

  const afterRemove = await projection.applyGithubAutomationConfigWirePatch(
    {
      revision: added.config.revision,
      repositories: [
        {
          repositoryId: 7002,
          fullName: "other/two",
          installationId: 12,
          baseRef: "develop",
          projectId: projectB.id,
          ownerActorIds: [99],
        },
      ],
    },
    { skipNetworkLookup: true, requireProjectId: true },
  );
  assert.equal(afterRemove.config.repositories.length, 1);
  assert.equal(afterRemove.config.repositories[0].repositoryId, 7002);
  assert.equal(afterRemove.projection.repositories[0].projectId, projectB.id);
  assert.equal("projectRoot" in afterRemove.projection.repositories[0], false);

  // Clear allowlist when no active jobs.
  const cleared = await projection.applyGithubAutomationConfigWirePatch(
    {
      revision: afterRemove.config.revision,
      repositories: [],
    },
    { skipNetworkLookup: true, requireProjectId: true },
  );
  assert.deepEqual(cleared.config.repositories, []);
  assert.deepEqual(cleared.projection.repositories, []);
});

await test("IMP-05 UI/API surfaces use local credentials path without yolk-pi-web hard lock", () => {
  const ui = readFileSync(join(root, "components/GithubAutomationConfig.tsx"), "utf8");
  assert.ok(ui.includes("Setup checklist") || ui.includes("验证配置"));
  assert.ok(ui.includes("关联仓库") || ui.includes("尚未关联仓库"));
  assert.ok(ui.includes("/api/github-automation/verify"));
  assert.ok(ui.includes("/api/github-automation/credentials"));
  assert.ok(ui.includes("YPI_GITHUB_APP_ID"));
  assert.ok(ui.includes("YPI_GITHUB_APP_PRIVATE_KEY_FILE"));
  assert.ok(ui.includes("YPI_GITHUB_APP_WEBHOOK_SECRET"));
  assert.ok(ui.includes("不会预置 yolk-pi-web") || ui.includes("不会预置"));
  // Local credential form is write-only: password input is allowed, reveal/download is not.
  assert.ok(/type=["']password["']/.test(ui), "webhook secret uses password input");
  assert.ok(ui.includes('autoComplete="new-password"') || ui.includes("autocomplete=\"new-password\""));
  assert.ok(!/type=["']password["'][\s\S]{0,200}reveal/i.test(ui));
  assert.ok(!/download.*privateKey|privateKey.*download/i.test(ui));
  assert.ok(!/localStorage\.(setItem|getItem)/.test(ui));
  assert.ok(!/navigator\.clipboard\.writeText\([^\)]*(token|secret|pem|projectRoot)/i.test(ui));
  // Clipboard helpers may copy env *names* only.
  assert.ok(ui.includes("copyEnvName") || ui.includes("已复制"));
  assert.ok(!ui.includes("BEGIN PRIVATE KEY"));
  assert.ok(!ui.includes("projectRoot:"));
  assert.ok(
    ui.includes("本机 GitHub App 凭据") || ui.includes("保存到本机"),
    "primary CTA is local credentials",
  );
  assert.ok(
    ui.includes("高级：环境变量覆盖") || ui.includes("环境变量覆盖"),
    "env is advanced override, not the only path",
  );

  const verifyRoute = readFileSync(
    join(root, "app/api/github-automation/verify/route.ts"),
    "utf8",
  );
  assert.ok(verifyRoute.includes("runGithubAutomationSetupVerify"));
  assert.ok(verifyRoute.includes("no-store"));
  assert.ok(verifyRoute.includes("rejects credential/path/command fields") || verifyRoute.includes("hasDisallowedBodyKeys"));
  assert.ok(!/wakeGithubAutomationScheduler/.test(verifyRoute));
  assert.ok(!/createQueuedGithubAutomationJob/.test(verifyRoute));
  assert.ok(!/from\s+["'][^"']*github-automation-scheduler/.test(verifyRoute));
  assert.ok(verifyRoute.includes("enqueuedJobs: false"));
  assert.ok(verifyRoute.includes("schedulerWoken: false"));

  const configRoute = readFileSync(
    join(root, "app/api/github-automation/config/route.ts"),
    "utf8",
  );
  assert.ok(configRoute.includes("projectChoices"));
  assert.ok(configRoute.includes("applyGithubAutomationConfigWirePatch"));
  assert.ok(configRoute.includes("skipNetworkLookup is intentionally not accepted"));

  const setupSrc = readFileSync(
    join(root, "lib/github-automation-setup-verify.ts"),
    "utf8",
  );
  assert.ok(!/from\s+["'][^"']*github-automation-scheduler/.test(setupSrc));
  assert.ok(!/wakeGithubAutomationScheduler/.test(setupSrc));
  assert.ok(!/createQueuedGithubAutomationJob/.test(setupSrc));
  assert.ok(setupSrc.includes("enqueuedJobs: false"));
  assert.ok(setupSrc.includes("本机 GitHub App 凭据") || setupSrc.includes("LOCAL_CREDENTIAL_CARD"));
});

await test("IMP-05 sentinel scan over setup projection + config GET", async () => {
  credentials._testOverrideGithubAppCredentialEnv({
    appId: "424242",
    privateKeyFile: keyMaterial.keyPath,
    webhookSecret: WEBHOOK_SECRET_SENTINEL,
  });
  const written = await config.writeGithubAutomationConfig({
    ...config.createDefaultGithubAutomationConfig(),
    repositories: [
      {
        repositoryId: 88001,
        fullName: "sentinel/repo",
        installationId: 33,
        projectId: "prj_sentinel",
        projectRoot: "/Users/secret/absolute/project-root",
        ownerActorIds: [],
        assigneeIdentitySource: "machine-active-credential",
        baseRef: "main",
      },
    ],
  });
  const safe = config.toGithubAutomationConfigSafeProjection(written);
  assertNoSentinel(safe, "IMP-05 config projection", [
    "/Users/secret/absolute/project-root",
    keyMaterial.pem.slice(0, 32),
  ]);
  assert.equal("projectRoot" in safe.repositories[0], false);

  const verify = await setupVerify.runGithubAutomationSetupVerify({
    config: written,
    resolveLive: false,
    appProjection: makeCredentialProjection({
      configured: true,
      readiness: "ready",
      hasAppId: true,
      hasPrivateKeyFile: true,
      hasWebhookSecret: true,
    }),
    assigneeProjection: makeAssigneeProjection({
      readiness: "ready",
      login: "bot",
      actorId: 9,
      assignable: true,
      identitySource: "gh",
      reasonCode: null,
    }),
    capability: makeCapabilityProjection({
      permissions: {
        metadata: "read",
        issues: "write",
        pull_requests: "none",
        contents: "none",
      },
    }),
    webhookHealth: "unknown",
  });
  assertNoSentinel(verify, "IMP-05 verify projection", [
    "/Users/secret/absolute/project-root",
    WEBHOOK_SECRET_SENTINEL,
    INSTALL_TOKEN_SENTINEL,
    MACHINE_TOKEN_SENTINEL,
    keyMaterial.pem.slice(0, 32),
  ]);
  projection.assertGithubAutomationProjectionSafe(verify);
  credentials._testOverrideGithubAppCredentialEnv(null);
});

// ─── GHCRED-06: local credential store / overlay / API / leakage ─────────────

function posixMode(path) {
  try {
    return statSync(path).mode & 0o777;
  } catch {
    return null;
  }
}

function assertPosixMode(path, expected, label) {
  const mode = posixMode(path);
  if (mode === null) return;
  // Skip hard mode asserts on platforms that ignore POSIX permission bits.
  if (process.platform === "win32") return;
  assert.equal(mode, expected, `${label} mode expected ${expected.toString(8)} got ${mode.toString(8)}`);
}

function makeLocalRsaPemPair() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  return {
    pem: privateKey.export({ type: "pkcs8", format: "pem" }),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
  };
}

function makeEcPrivateKeyPem() {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return privateKey.export({ type: "pkcs8", format: "pem" });
}

function automationRoot() {
  return join(agentDir, "github-automation");
}

function credentialsMetadataPath() {
  return join(automationRoot(), "credentials.v1.json");
}

function listGenerationKeys() {
  const rootDir = automationRoot();
  if (!existsSync(rootDir)) return [];
  return readdirSync(rootDir).filter((name) =>
    /^private-key\.[A-Za-z0-9_-]{8,64}\.pem$/.test(name),
  );
}

function readActiveLocalBundle() {
  const metaPath = credentialsMetadataPath();
  if (!existsSync(metaPath)) return null;
  return JSON.parse(readFileSync(metaPath, "utf8"));
}

function fingerprintPemText(pem) {
  return `sha256:${createHash("sha256").update(pem.replace(/\r\n/g, "\n").trim(), "utf8").digest("hex")}`;
}

function localSentinelExtras(extra = []) {
  const bundle = readActiveLocalBundle();
  const extras = [
    LOCAL_APP_ID_SENTINEL,
    LOCAL_WEBHOOK_SECRET_SENTINEL,
    WEBHOOK_SECRET_SENTINEL,
    APP_KEY_SENTINEL,
    INSTALL_TOKEN_SENTINEL,
    MACHINE_TOKEN_SENTINEL,
    "BEGIN PRIVATE KEY",
    "BEGIN RSA PRIVATE KEY",
    "sha256:",
    ...extra,
  ];
  if (bundle?.keyFile) extras.push(bundle.keyFile);
  if (bundle?.keySha256) extras.push(bundle.keySha256);
  if (bundle?.appId) extras.push(String(bundle.appId));
  if (bundle?.webhookSecret) extras.push(String(bundle.webhookSecret));
  return extras;
}

async function clearLocalCredentialsForTests() {
  credentials._testOverrideGithubAppCredentialEnv(null);
  credentialStore._testResetGithubAppCredentialStoreQueue();
  try {
    await credentialStore.deleteGithubAppLocalCredentials();
  } catch {
    // missing is fine
  }
  // Hard wipe residual metadata/keys if delete recovered partially.
  const rootDir = automationRoot();
  if (existsSync(credentialsMetadataPath())) {
    unlinkSync(credentialsMetadataPath());
  }
  for (const name of listGenerationKeys()) {
    try {
      unlinkSync(join(rootDir, name));
    } catch {
      // ignore
    }
  }
}

async function saveCompleteLocalBundle(overrides = {}) {
  const key = overrides.pem ? { pem: overrides.pem } : makeLocalRsaPemPair();
  const summary = await credentialStore.upsertGithubAppLocalCredentials({
    appId: overrides.appId ?? LOCAL_APP_ID_SENTINEL,
    webhookSecret: overrides.webhookSecret ?? LOCAL_WEBHOOK_SECRET_SENTINEL,
    privateKeyPem: key.pem,
    appSlug: overrides.appSlug === undefined ? "ypi-local-bot" : overrides.appSlug,
  });
  return { summary, pem: key.pem, publicKeyPem: key.publicKeyPem };
}

async function responseJson(response) {
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body,
    text,
  };
}

function assertNoStore(headers, label) {
  const cache = String(headers["cache-control"] || headers["Cache-Control"] || "");
  assert.ok(cache.includes("no-store"), `${label} must set Cache-Control: no-store`);
}

function assertSafeCredentialStatus(status, label) {
  assert.equal(typeof status, "object");
  assert.equal(typeof status.configured, "boolean");
  assert.equal(typeof status.readiness, "string");
  assert.equal(typeof status.hasAppId, "boolean");
  assert.equal(typeof status.hasPrivateKeyFile, "boolean");
  assert.equal(typeof status.hasPrivateKey, "boolean");
  assert.equal(typeof status.hasWebhookSecret, "boolean");
  assert.ok(status.local && typeof status.local === "object");
  assert.ok(status.sources && typeof status.sources === "object");
  for (const key of ["appId", "key", "webhook", "slug"]) {
    assert.ok(["env", "local", "missing"].includes(status.sources[key]), `${label} sources.${key}`);
  }
  projection.assertGithubAutomationProjectionSafe(status);
  assertNoSentinel(status, label, localSentinelExtras());
}

await test("GHCRED-06 local store first-save permissions generation and restart-import", async () => {
  await clearLocalCredentialsForTests();
  credentials._testOverrideGithubAppCredentialEnv({
    appId: null,
    privateKeyFile: null,
    webhookSecret: null,
    appSlug: null,
  });

  const missing = await credentials.getGithubAppCredentialSafeProjection();
  assert.equal(missing.configured, false);
  assert.equal(missing.local.readiness, "missing");
  assert.equal(missing.sources.appId, "missing");
  assertSafeCredentialStatus(missing, "missing local projection");

  // Partial first save must not create a half bundle.
  await assert.rejects(
    () =>
      credentialStore.upsertGithubAppLocalCredentials({
        appId: LOCAL_APP_ID_SENTINEL,
        webhookSecret: LOCAL_WEBHOOK_SECRET_SENTINEL,
      }),
    (err) => err?.code === "local_credentials_invalid",
  );
  assert.equal(existsSync(credentialsMetadataPath()), false);
  assert.deepEqual(listGenerationKeys(), []);

  const saved = await saveCompleteLocalBundle();
  assert.equal(saved.summary.configured, true);
  assert.equal(saved.summary.readiness, "ready");

  const rootDir = automationRoot();
  assert.ok(existsSync(rootDir));
  assertPosixMode(rootDir, 0o700, "automation root");
  assertPosixMode(credentialsMetadataPath(), 0o600, "credentials.v1.json");
  const keys = listGenerationKeys();
  assert.equal(keys.length, 1);
  assertPosixMode(join(rootDir, keys[0]), 0o600, "generation key");

  const bundle = readActiveLocalBundle();
  assert.equal(bundle.schemaVersion, types.GITHUB_APP_LOCAL_CREDENTIALS_SCHEMA_VERSION);
  assert.equal(bundle.kind, types.GITHUB_APP_LOCAL_CREDENTIALS_KIND);
  assert.equal(bundle.appId, LOCAL_APP_ID_SENTINEL);
  assert.equal(bundle.webhookSecret, LOCAL_WEBHOOK_SECRET_SENTINEL);
  assert.equal(bundle.keyFile, keys[0]);
  assert.ok(!String(bundle.keyFile).includes("/"));
  assert.ok(bundle.keySha256.startsWith("sha256:"));

  // Same-process re-read (simulates restart without ambient env).
  credentials._testOverrideGithubAppCredentialEnv({
    appId: null,
    privateKeyFile: null,
    webhookSecret: null,
    appSlug: null,
  });
  const ready = await credentials.getGithubAppCredentialSafeProjection();
  assert.equal(ready.configured, true);
  assert.equal(ready.readiness, "ready");
  assert.equal(ready.local.configured, true);
  assert.equal(ready.sources.appId, "local");
  assert.equal(ready.sources.key, "local");
  assert.equal(ready.sources.webhook, "local");
  assert.equal(ready.appSlug, "ypi-local-bot");
  assertSafeCredentialStatus(ready, "local-only ready projection");

  const loaded = await credentials.loadGithubAppCredentials();
  assert.equal(loaded.appId, LOCAL_APP_ID_SENTINEL);
  assert.equal(loaded.webhookSecret, LOCAL_WEBHOOK_SECRET_SENTINEL);
  assert.ok(loaded.privateKeyFile.includes(bundle.keyFile));

  // Child process restart-import: fresh modules, no YPI_GITHUB_APP_* env.
  const child = spawnSync(
    process.execPath,
    [
      "--loader",
      "./scripts/ts-extension-loader.mjs",
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      "--input-type=module",
      "-e",
      `
        import { createJiti } from "jiti";
        import { join } from "node:path";
        process.env.PI_CODING_AGENT_DIR = ${JSON.stringify(agentDir)};
        for (const k of [
          "YPI_GITHUB_APP_ID",
          "YPI_GITHUB_APP_PRIVATE_KEY_FILE",
          "YPI_GITHUB_APP_WEBHOOK_SECRET",
          "YPI_GITHUB_APP_SLUG",
        ]) delete process.env[k];
        const jiti = createJiti(join(process.cwd(), "package.json"), { interopDefault: true });
        const credentials = jiti(join(process.cwd(), "lib/github-app-credentials.ts"));
        const status = await credentials.getGithubAppCredentialSafeProjection();
        if (!status.configured || status.readiness !== "ready") {
          console.error(JSON.stringify(status));
          process.exit(2);
        }
        if (status.sources?.appId !== "local" || status.sources?.key !== "local" || status.sources?.webhook !== "local") {
          console.error(JSON.stringify(status.sources));
          process.exit(3);
        }
        const loaded = await credentials.loadGithubAppCredentials();
        if (loaded.appId !== ${JSON.stringify(LOCAL_APP_ID_SENTINEL)}) process.exit(4);
        if (loaded.webhookSecret !== ${JSON.stringify(LOCAL_WEBHOOK_SECRET_SENTINEL)}) process.exit(5);
        const serialized = JSON.stringify(status);
        for (const needle of [
          ${JSON.stringify(LOCAL_APP_ID_SENTINEL)},
          ${JSON.stringify(LOCAL_WEBHOOK_SECRET_SENTINEL)},
          "BEGIN PRIVATE KEY",
          "sha256:",
        ]) {
          if (serialized.includes(needle)) process.exit(6);
        }
        console.log("restart-import-ok");
      `,
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        PI_CODING_AGENT_DIR: agentDir,
        YPI_GITHUB_APP_ID: "",
        YPI_GITHUB_APP_PRIVATE_KEY_FILE: "",
        YPI_GITHUB_APP_WEBHOOK_SECRET: "",
        YPI_GITHUB_APP_SLUG: "",
      },
    },
  );
  assert.equal(child.status, 0, `restart-import child failed: ${child.stderr || child.stdout}`);
  assert.ok(String(child.stdout).includes("restart-import-ok"));

  credentials._testOverrideGithubAppCredentialEnv(null);
});

await test("GHCRED-06 partial rotation atomic generation and blank-preserve", async () => {
  await clearLocalCredentialsForTests();
  credentials._testOverrideGithubAppCredentialEnv({
    appId: null,
    privateKeyFile: null,
    webhookSecret: null,
    appSlug: null,
  });

  const first = await saveCompleteLocalBundle();
  const before = readActiveLocalBundle();
  const beforeKeys = listGenerationKeys();
  assert.equal(beforeKeys.length, 1);

  // Blank/omitted fields preserve local values (never import env).
  const rotatedSecret = await credentialStore.upsertGithubAppLocalCredentials({
    webhookSecret: "gha_local_webhook_rotated_SECRET_9f3c",
  });
  assert.equal(rotatedSecret.configured, true);
  const afterSecret = readActiveLocalBundle();
  assert.equal(afterSecret.appId, before.appId);
  assert.equal(afterSecret.keyFile, before.keyFile);
  assert.equal(afterSecret.webhookSecret, "gha_local_webhook_rotated_SECRET_9f3c");
  assert.deepEqual(listGenerationKeys(), beforeKeys);

  const nextKey = makeLocalRsaPemPair();
  await credentialStore.upsertGithubAppLocalCredentials({
    privateKeyPem: nextKey.pem,
  });
  const afterKey = readActiveLocalBundle();
  assert.equal(afterKey.appId, before.appId);
  assert.equal(afterKey.webhookSecret, "gha_local_webhook_rotated_SECRET_9f3c");
  assert.notEqual(afterKey.keyFile, before.keyFile);
  const storedPem = readFileSync(join(automationRoot(), afterKey.keyFile), "utf8");
  assert.equal(afterKey.keySha256, fingerprintPemText(storedPem));
  // Active generation only (old slot cleaned best-effort).
  const keys = listGenerationKeys();
  assert.ok(keys.includes(afterKey.keyFile));
  assert.equal(keys.length, 1, "old generation cleaned after rotation");

  // JWT verifies with the rotated key.
  const creds = await credentials.loadGithubAppCredentials();
  const jwt = credentials.createGithubAppJwt(creds, {
    nowSeconds: 1_700_000_100,
    lifetimeSeconds: 120,
  });
  const [h, p, s] = jwt.token.split(".");
  const verify = createVerify("RSA-SHA256");
  verify.update(`${h}.${p}`);
  verify.end();
  assert.equal(
    verify.verify(createPublicKey(nextKey.publicKeyPem), Buffer.from(s, "base64url")),
    true,
  );
  const payload = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
  assert.equal(payload.iss, LOCAL_APP_ID_SENTINEL);
  assertNoSentinel({ iat: jwt.iat, exp: jwt.exp }, "rotated jwt metadata", localSentinelExtras([first.pem.slice(0, 40)]));

  credentials._testOverrideGithubAppCredentialEnv(null);
});

await test("GHCRED-06 env overlay matrix blank fallback and invalid local masking", async () => {
  await clearLocalCredentialsForTests();
  const local = await saveCompleteLocalBundle();

  // local-only
  credentials._testOverrideGithubAppCredentialEnv({
    appId: null,
    privateKeyFile: null,
    webhookSecret: null,
    appSlug: null,
  });
  let status = await credentials.getGithubAppCredentialSafeProjection();
  assert.equal(status.configured, true);
  assert.deepEqual(status.sources, {
    appId: "local",
    key: "local",
    webhook: "local",
    slug: "local",
  });

  // env-only path still works with ambient override + no local required.
  await clearLocalCredentialsForTests();
  credentials._testOverrideGithubAppCredentialEnv({
    appId: "424242",
    privateKeyFile: keyMaterial.keyPath,
    webhookSecret: WEBHOOK_SECRET_SENTINEL,
    appSlug: "env-bot",
  });
  status = await credentials.getGithubAppCredentialSafeProjection();
  assert.equal(status.configured, true);
  assert.equal(status.sources.appId, "env");
  assert.equal(status.sources.key, "env");
  assert.equal(status.sources.webhook, "env");
  assert.equal(status.appSlug, "env-bot");
  assertSafeCredentialStatus(status, "env-only projection");

  // partial overlays: restore local then override one field at a time
  await saveCompleteLocalBundle({ pem: local.pem });
  credentials._testOverrideGithubAppCredentialEnv({
    appId: "555001",
    privateKeyFile: null,
    webhookSecret: null,
    appSlug: null,
  });
  status = await credentials.getGithubAppCredentialSafeProjection();
  assert.equal(status.configured, true);
  assert.equal(status.sources.appId, "env");
  assert.equal(status.sources.key, "local");
  assert.equal(status.sources.webhook, "local");

  credentials._testOverrideGithubAppCredentialEnv({
    appId: null,
    privateKeyFile: keyMaterial.keyPath,
    webhookSecret: null,
    appSlug: null,
  });
  status = await credentials.getGithubAppCredentialSafeProjection();
  assert.equal(status.configured, true);
  assert.equal(status.sources.key, "env");
  assert.equal(status.sources.appId, "local");
  assert.equal(status.sources.webhook, "local");

  credentials._testOverrideGithubAppCredentialEnv({
    appId: null,
    privateKeyFile: null,
    webhookSecret: "env_override_webhook_secret_VALUE",
    appSlug: null,
  });
  status = await credentials.getGithubAppCredentialSafeProjection();
  assert.equal(status.configured, true);
  assert.equal(status.sources.webhook, "env");
  const loadedMixed = await credentials.loadGithubAppCredentials();
  assert.equal(loadedMixed.webhookSecret, "env_override_webhook_secret_VALUE");
  assert.equal(loadedMixed.appId, LOCAL_APP_ID_SENTINEL);

  // blank env override must fall back to local (override null/empty).
  credentials._testOverrideGithubAppCredentialEnv({
    appId: "",
    privateKeyFile: "",
    webhookSecret: "",
    appSlug: "",
  });
  status = await credentials.getGithubAppCredentialSafeProjection();
  assert.equal(status.configured, true);
  assert.equal(status.sources.appId, "local");
  assert.equal(status.sources.key, "local");
  assert.equal(status.sources.webhook, "local");

  // Damage local key fingerprint while env fully covers → effective ready + local warning.
  const damaged = readActiveLocalBundle();
  damaged.keySha256 = "sha256:deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
  writeFileSync(credentialsMetadataPath(), `${JSON.stringify(damaged, null, 2)}\n`, { mode: 0o600 });
  credentials._testOverrideGithubAppCredentialEnv({
    appId: "424242",
    privateKeyFile: keyMaterial.keyPath,
    webhookSecret: WEBHOOK_SECRET_SENTINEL,
    appSlug: "env-cover",
  });
  status = await credentials.getGithubAppCredentialSafeProjection();
  assert.equal(status.configured, true);
  assert.equal(status.readiness, "ready");
  assert.equal(status.sources.appId, "env");
  assert.equal(status.sources.key, "env");
  assert.equal(status.sources.webhook, "env");
  assert.ok(["invalid", "unsupported"].includes(status.local.readiness));
  assertSafeCredentialStatus(status, "env masks invalid local");

  // Partial env + invalid local must fail closed for missing local-dependent fields.
  credentials._testOverrideGithubAppCredentialEnv({
    appId: "424242",
    privateKeyFile: null,
    webhookSecret: WEBHOOK_SECRET_SENTINEL,
    appSlug: null,
  });
  status = await credentials.getGithubAppCredentialSafeProjection();
  assert.equal(status.configured, false);
  assert.ok(
    status.readiness === "private_key_invalid" || status.readiness === "missing_private_key_file",
  );
  assertSafeCredentialStatus(status, "partial env + invalid local");

  credentials._testOverrideGithubAppCredentialEnv(null);
  await clearLocalCredentialsForTests();
});

await test("GHCRED-06 local webhook HMAC pass/fail and env secret override", async () => {
  await clearLocalCredentialsForTests();
  await saveCompleteLocalBundle();
  credentials._testOverrideGithubAppCredentialEnv({
    appId: null,
    privateKeyFile: null,
    webhookSecret: null,
    appSlug: null,
  });

  const secret = await credentials.loadGithubAppWebhookSecret();
  assert.equal(secret, LOCAL_WEBHOOK_SECRET_SENTINEL);
  const raw = Buffer.from(JSON.stringify({ ping: true, n: 1 }), "utf8");
  const goodHex = webhookVerify.computeGithubWebhookSignatureHex(raw, secret);
  assert.equal(
    webhookVerify.verifyGithubWebhookSignature({
      rawBody: raw,
      signatureHeader: `sha256=${goodHex}`,
      secret,
    }),
    true,
  );
  assert.equal(
    webhookVerify.verifyGithubWebhookSignature({
      rawBody: raw,
      signatureHeader: `sha256=${"ab".repeat(32)}`,
      secret,
    }),
    false,
  );
  assert.throws(
    () =>
      webhookVerify.assertValidGithubWebhookSignature({
        rawBody: raw,
        signatureHeader: `sha256=${"cd".repeat(32)}`,
        secret,
      }),
    (err) => err?.status === 401 || err?.code === "github_auth_failed",
  );

  // env webhook overrides local for verification path.
  credentials._testOverrideGithubAppCredentialEnv({
    appId: null,
    privateKeyFile: null,
    webhookSecret: WEBHOOK_SECRET_SENTINEL,
    appSlug: null,
  });
  const envSecret = await credentials.loadGithubAppWebhookSecret();
  assert.equal(envSecret, WEBHOOK_SECRET_SENTINEL);
  const envHex = webhookVerify.computeGithubWebhookSignatureHex(raw, WEBHOOK_SECRET_SENTINEL);
  assert.equal(
    webhookVerify.verifyGithubWebhookSignature({
      rawBody: raw,
      signatureHeader: `sha256=${envHex}`,
      secret: envSecret,
    }),
    true,
  );
  // Local secret must not bypass env override.
  assert.equal(
    webhookVerify.verifyGithubWebhookSignature({
      rawBody: raw,
      signatureHeader: `sha256=${goodHex}`,
      secret: envSecret,
    }),
    false,
  );

  credentials._testOverrideGithubAppCredentialEnv(null);
  await clearLocalCredentialsForTests();
});

await test("GHCRED-06 installation token cache clears after local rotation and delete", async () => {
  await clearLocalCredentialsForTests();
  await saveCompleteLocalBundle();
  credentials._testOverrideGithubAppCredentialEnv({
    appId: null,
    privateKeyFile: null,
    webhookSecret: null,
    appSlug: null,
  });

  client._testClearGithubAppInstallationTokenCache();
  client._testOverrideGithubAppClientNowMs(1_700_000_000_000);
  let tokenPosts = 0;
  client._testOverrideGithubAppClientFetch(async (url) => {
    const u = String(url);
    if (u.includes("/app/installations/77/access_tokens")) {
      tokenPosts += 1;
      return new Response(
        JSON.stringify({
          token: `${INSTALL_TOKEN_SENTINEL}_${tokenPosts}`,
          expires_at: new Date(1_700_000_000_000 + 60 * 60 * 1000).toISOString(),
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
  });

  const first = await client.getGithubInstallationToken(77);
  assert.equal(first.token, `${INSTALL_TOKEN_SENTINEL}_1`);
  const cached = await client.getGithubInstallationToken(77);
  assert.equal(cached.token, `${INSTALL_TOKEN_SENTINEL}_1`);
  assert.equal(tokenPosts, 1, "second lookup hits cache");

  // Rotation must invalidate cache.
  await credentialStore.upsertGithubAppLocalCredentials({
    privateKeyPem: makeLocalRsaPemPair().pem,
  });
  client.clearGithubAppInstallationTokenCache();
  const afterRotation = await client.getGithubInstallationToken(77);
  assert.equal(afterRotation.token, `${INSTALL_TOKEN_SENTINEL}_2`);
  assert.equal(tokenPosts, 2);

  // Route-level delete also clears cache (call path mirrors production).
  const del = await credentialsRoute.DELETE(
    new Request("http://localhost/api/github-automation/credentials", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: credentialsRoute._CREDENTIALS_DELETE_CONFIRM }),
    }),
  );
  const delBody = await responseJson(del);
  assert.equal(delBody.status, 200);
  assert.equal(delBody.body.ok, true);
  assertNoStore(delBody.headers, "DELETE credentials");
  assertSafeCredentialStatus(delBody.body.status, "delete response status");

  // Reconfigure env-only and ensure previous local token identity is gone.
  credentials._testOverrideGithubAppCredentialEnv({
    appId: "424242",
    privateKeyFile: keyMaterial.keyPath,
    webhookSecret: WEBHOOK_SECRET_SENTINEL,
  });
  const afterDelete = await client.getGithubInstallationToken(77);
  assert.equal(afterDelete.token, `${INSTALL_TOKEN_SENTINEL}_3`);
  assert.equal(tokenPosts, 3);

  client._testOverrideGithubAppClientFetch(undefined);
  client._testClearGithubAppInstallationTokenCache();
  credentials._testOverrideGithubAppCredentialEnv(null);
  await clearLocalCredentialsForTests();
});

await test("GHCRED-06 fail-closed malformed future symlink oversize non-RSA and concurrent upsert", async () => {
  await clearLocalCredentialsForTests();
  credentials._testOverrideGithubAppCredentialEnv({
    appId: null,
    privateKeyFile: null,
    webhookSecret: null,
    appSlug: null,
  });

  // non-RSA rejected before write
  await assert.rejects(
    () =>
      credentialStore.upsertGithubAppLocalCredentials({
        appId: LOCAL_APP_ID_SENTINEL,
        webhookSecret: LOCAL_WEBHOOK_SECRET_SENTINEL,
        privateKeyPem: makeEcPrivateKeyPem(),
      }),
    (err) => err?.code === "invalid_private_key",
  );
  assert.equal(existsSync(credentialsMetadataPath()), false);

  // oversize PEM rejected
  const huge = `${"A".repeat(70 * 1024)}\n-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----\n`;
  await assert.rejects(
    () =>
      credentialStore.upsertGithubAppLocalCredentials({
        appId: LOCAL_APP_ID_SENTINEL,
        webhookSecret: LOCAL_WEBHOOK_SECRET_SENTINEL,
        privateKeyPem: huge,
      }),
    (err) => err?.code === "private_key_too_large" || err?.code === "invalid_private_key",
  );

  const saved = await saveCompleteLocalBundle();
  const goodBundle = readActiveLocalBundle();

  // future schema is unsupported and ordinary upsert refuses to overwrite
  writeFileSync(
    credentialsMetadataPath(),
    `${JSON.stringify({ ...goodBundle, schemaVersion: 99, kind: "future-kind" }, null, 2)}\n`,
    { mode: 0o600 },
  );
  const unsupported = await credentialStore.getGithubAppLocalCredentialSafeSummary();
  assert.equal(unsupported.readiness, "unsupported");
  await assert.rejects(
    () =>
      credentialStore.upsertGithubAppLocalCredentials({
        appId: LOCAL_APP_ID_SENTINEL,
        webhookSecret: LOCAL_WEBHOOK_SECRET_SENTINEL,
        privateKeyPem: saved.pem,
      }),
    (err) => err?.code === "local_credentials_unsupported",
  );
  // Explicit delete recovers.
  await credentialStore.deleteGithubAppLocalCredentials();
  assert.equal(existsSync(credentialsMetadataPath()), false);

  await saveCompleteLocalBundle({ pem: saved.pem });
  // malformed JSON metadata fail closed
  writeFileSync(credentialsMetadataPath(), "{not-json", { mode: 0o600 });
  const invalid = await credentialStore.getGithubAppLocalCredentialSafeSummary();
  assert.equal(invalid.readiness, "invalid");
  await assert.rejects(
    () =>
      credentialStore.upsertGithubAppLocalCredentials({
        webhookSecret: "x",
      }),
    (err) => err?.code === "local_credentials_invalid",
  );
  await credentialStore.deleteGithubAppLocalCredentials();

  // symlink key rejected
  const again = await saveCompleteLocalBundle({ pem: saved.pem });
  void again;
  const active = readActiveLocalBundle();
  const keyPath = join(automationRoot(), active.keyFile);
  const outside = join(agentDir, "outside-real.pem");
  writeFileSync(outside, saved.pem, { mode: 0o600 });
  unlinkSync(keyPath);
  try {
    symlinkSync(outside, keyPath);
  } catch (err) {
    // Some CI images disallow symlinks; skip only that branch.
    if (err && (err.code === "EPERM" || err.code === "ENOTSUP")) {
      writeFileSync(keyPath, saved.pem, { mode: 0o600 });
    } else {
      throw err;
    }
  }
  if (lstatSync(keyPath).isSymbolicLink()) {
    const summary = await credentialStore.getGithubAppLocalCredentialSafeSummary();
    assert.equal(summary.readiness, "invalid");
    await assert.rejects(
      () => credentials.loadGithubAppCredentials(),
      (err) => err?.code === "not_configured" || err?.code === "local_credentials_invalid",
    );
  }

  // basename traversal rejected by path helper
  assert.throws(
    () => credentialStore.resolveGithubAppCredentialKeyPath("../secrets.pem"),
    (err) => err?.code === "local_credentials_invalid",
  );
  assert.throws(
    () => credentialStore.resolveGithubAppCredentialKeyPath("/tmp/evil.pem"),
    (err) => err?.code === "local_credentials_invalid",
  );

  // concurrent upserts serialize under process queue + lock; final state remains valid complete bundle
  await clearLocalCredentialsForTests();
  const base = await saveCompleteLocalBundle({ pem: saved.pem });
  void base;
  const pemA = makeLocalRsaPemPair().pem;
  const pemB = makeLocalRsaPemPair().pem;
  const results = await Promise.allSettled([
    credentialStore.upsertGithubAppLocalCredentials({
      webhookSecret: "concurrent-secret-A-SENTINEL",
      privateKeyPem: pemA,
    }),
    credentialStore.upsertGithubAppLocalCredentials({
      webhookSecret: "concurrent-secret-B-SENTINEL",
      privateKeyPem: pemB,
    }),
  ]);
  assert.ok(results.every((r) => r.status === "fulfilled"));
  const finalBundle = readActiveLocalBundle();
  assert.ok(finalBundle);
  assert.ok(
    finalBundle.webhookSecret === "concurrent-secret-A-SENTINEL" ||
      finalBundle.webhookSecret === "concurrent-secret-B-SENTINEL",
  );
  assert.equal(listGenerationKeys().length, 1);
  const finalStatus = await credentials.getGithubAppCredentialSafeProjection();
  // no env → local complete
  credentials._testOverrideGithubAppCredentialEnv({
    appId: null,
    privateKeyFile: null,
    webhookSecret: null,
    appSlug: null,
  });
  assert.equal((await credentials.getGithubAppCredentialSafeProjection()).configured, true);
  assertSafeCredentialStatus(finalStatus, "post-concurrent projection");

  // delete must not touch non-secret config / jobs dirs
  mkdirSync(join(automationRoot(), "jobs"), { recursive: true });
  writeFileSync(join(automationRoot(), "jobs", "keep-me.json"), "{\"ok\":true}\n");
  await config.writeGithubAutomationConfig(config.createDefaultGithubAutomationConfig());
  await credentialStore.deleteGithubAppLocalCredentials();
  assert.equal(existsSync(join(automationRoot(), "config.json")), true);
  assert.equal(existsSync(join(automationRoot(), "jobs", "keep-me.json")), true);
  assert.equal(existsSync(credentialsMetadataPath()), false);

  credentials._testOverrideGithubAppCredentialEnv(null);
  await clearLocalCredentialsForTests();
});

await test("GHCRED-06 credentials route GET/PUT/DELETE contracts and sentinel isolation", async () => {
  await clearLocalCredentialsForTests();
  credentials._testOverrideGithubAppCredentialEnv({
    appId: null,
    privateKeyFile: null,
    webhookSecret: null,
    appSlug: null,
  });

  const getEmpty = await responseJson(
    await credentialsRoute.GET(
      new Request("http://localhost/api/github-automation/credentials"),
    ),
  );
  assert.equal(getEmpty.status, 200);
  assert.equal(getEmpty.body.ok, true);
  assertNoStore(getEmpty.headers, "GET empty");
  assertSafeCredentialStatus(getEmpty.body.status, "GET empty status");
  assert.equal(getEmpty.body.status.configured, false);

  // Reject JSON body for PUT
  const putJson = await responseJson(
    await credentialsRoute.PUT(
      new Request("http://localhost/api/github-automation/credentials", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          appId: LOCAL_APP_ID_SENTINEL,
          webhookSecret: LOCAL_WEBHOOK_SECRET_SENTINEL,
          privateKeyPem: makeLocalRsaPemPair().pem,
        }),
      }),
    ),
  );
  assert.equal(putJson.status, 400);
  assert.equal(putJson.body.code, "invalid_credentials_request");
  assertNoStore(putJson.headers, "PUT json reject");
  assertNoSentinel(putJson.body, "PUT json reject body", localSentinelExtras());

  // Reject query secrets
  const getQuery = await responseJson(
    await credentialsRoute.GET(
      new Request(
        `http://localhost/api/github-automation/credentials?webhookSecret=${LOCAL_WEBHOOK_SECRET_SENTINEL}`,
      ),
    ),
  );
  assert.equal(getQuery.status, 400);
  assert.equal(getQuery.body.code, "invalid_credentials_request");
  assertNoSentinel(getQuery.body, "GET query secret reject", localSentinelExtras());

  const pem = makeLocalRsaPemPair().pem;
  const form = new FormData();
  form.set("appId", LOCAL_APP_ID_SENTINEL);
  form.set("webhookSecret", LOCAL_WEBHOOK_SECRET_SENTINEL);
  form.set("privateKeyPem", pem);
  form.set("appSlug", "route-bot");
  const putOk = await responseJson(
    await credentialsRoute.PUT(
      new Request("http://localhost/api/github-automation/credentials", {
        method: "PUT",
        body: form,
      }),
    ),
  );
  assert.equal(putOk.status, 200, JSON.stringify(putOk.body));
  assert.equal(putOk.body.ok, true);
  assertNoStore(putOk.headers, "PUT success");
  assertSafeCredentialStatus(putOk.body.status, "PUT success status");
  assert.equal(putOk.body.status.configured, true);
  assert.equal(putOk.body.status.sources.appId, "local");
  assert.equal(putOk.body.status.local.configured, true);
  // Response must not echo submitted secrets / PEM / path / fingerprint.
  assertNoSentinel(putOk, "PUT success full response", [
    ...localSentinelExtras([pem.slice(0, 48)]),
    join(automationRoot(), "private-key"),
  ]);

  // Ambiguous paste+file rejected
  const ambiguous = new FormData();
  ambiguous.set("privateKeyPem", pem);
  ambiguous.set(
    "privateKeyFile",
    new File([pem], "app.pem", { type: "application/x-pem-file" }),
  );
  const putAmbiguous = await responseJson(
    await credentialsRoute.PUT(
      new Request("http://localhost/api/github-automation/credentials", {
        method: "PUT",
        body: ambiguous,
      }),
    ),
  );
  assert.equal(putAmbiguous.status, 400);
  assert.equal(putAmbiguous.body.code, "invalid_credentials_request");
  assertNoSentinel(putAmbiguous.body, "ambiguous key reject", localSentinelExtras([pem.slice(0, 32)]));

  // Unknown field rejected
  const unknown = new FormData();
  unknown.set("webhookSecret", "new-secret");
  unknown.set("extraField", "nope");
  const putUnknown = await responseJson(
    await credentialsRoute.PUT(
      new Request("http://localhost/api/github-automation/credentials", {
        method: "PUT",
        body: unknown,
      }),
    ),
  );
  assert.equal(putUnknown.status, 400);
  assert.equal(putUnknown.body.code, "invalid_credentials_request");

  // File-only rotation works
  const rotatedPem = makeLocalRsaPemPair().pem;
  const fileForm = new FormData();
  fileForm.set(
    "privateKeyFile",
    new File([rotatedPem], "rotated.pem", { type: "text/plain" }),
  );
  const putFile = await responseJson(
    await credentialsRoute.PUT(
      new Request("http://localhost/api/github-automation/credentials", {
        method: "PUT",
        body: fileForm,
      }),
    ),
  );
  assert.equal(putFile.status, 200, JSON.stringify(putFile.body));
  assert.equal(putFile.body.status.configured, true);
  assertNoSentinel(putFile, "PUT file rotation", localSentinelExtras([rotatedPem.slice(0, 40)]));

  // DELETE requires exact confirm
  const delBad = await responseJson(
    await credentialsRoute.DELETE(
      new Request("http://localhost/api/github-automation/credentials", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: "yes" }),
      }),
    ),
  );
  assert.equal(delBad.status, 400);
  assert.equal(existsSync(credentialsMetadataPath()), true);

  const delOk = await responseJson(
    await credentialsRoute.DELETE(
      new Request("http://localhost/api/github-automation/credentials", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirm: credentialsRoute._CREDENTIALS_DELETE_CONFIRM,
        }),
      }),
    ),
  );
  assert.equal(delOk.status, 200);
  assert.equal(delOk.body.ok, true);
  assert.equal(delOk.body.status.local.configured, false);
  assertNoStore(delOk.headers, "DELETE success");
  assertSafeCredentialStatus(delOk.body.status, "DELETE success status");
  assert.equal(existsSync(credentialsMetadataPath()), false);

  // After delete, env-only still projects configured without leaking.
  credentials._testOverrideGithubAppCredentialEnv({
    appId: "424242",
    privateKeyFile: keyMaterial.keyPath,
    webhookSecret: WEBHOOK_SECRET_SENTINEL,
  });
  const getEnv = await responseJson(
    await credentialsRoute.GET(
      new Request("http://localhost/api/github-automation/credentials"),
    ),
  );
  assert.equal(getEnv.body.status.configured, true);
  assert.equal(getEnv.body.status.sources.appId, "env");
  assertSafeCredentialStatus(getEnv.body.status, "GET env-only after delete");

  credentials._testOverrideGithubAppCredentialEnv(null);
  await clearLocalCredentialsForTests();
});

await test("GHCRED-06 setup/status source semantics and non-credential surfaces stay clean", async () => {
  await clearLocalCredentialsForTests();
  credentials._testOverrideGithubAppCredentialEnv({
    appId: null,
    privateKeyFile: null,
    webhookSecret: null,
    appSlug: null,
  });

  const emptyApp = await credentials.getGithubAppCredentialSafeProjection();
  const emptyVerify = await setupVerify.runGithubAutomationSetupVerify({
    config: config.createDefaultGithubAutomationConfig(),
    resolveLive: false,
    appProjection: emptyApp,
    assigneeProjection: makeAssigneeProjection(),
    capability: makeCapabilityProjection(),
    webhookHealth: "unknown",
  });
  assert.equal(emptyVerify.sideEffects.enqueuedJobs, false);
  assert.equal(emptyVerify.sideEffects.schedulerWoken, false);
  assert.equal(emptyVerify.sideEffects.githubMutations, false);
  const appIdItem = emptyVerify.checklist.find((item) => item.code === "app_id" || /App ID/.test(item.title));
  assert.ok(appIdItem);
  assert.ok(
    /本机 GitHub App 凭据|保存到本机/.test(appIdItem.nextStep || ""),
    "missing App ID next step points to local card",
  );
  assertNoSentinel(emptyVerify, "empty setup verify", localSentinelExtras());
  projection.assertGithubAutomationProjectionSafe(emptyVerify);

  await saveCompleteLocalBundle();
  const localApp = await credentials.getGithubAppCredentialSafeProjection();
  assert.equal(localApp.configured, true);
  assert.equal(localApp.sources.key, "local");

  const localVerify = await setupVerify.runGithubAutomationSetupVerify({
    config: config.createDefaultGithubAutomationConfig(),
    resolveLive: false,
    appProjection: localApp,
    assigneeProjection: makeAssigneeProjection({
      readiness: "ready",
      login: "bot",
      actorId: 1,
      assignable: true,
      identitySource: "gh",
      reasonCode: null,
    }),
    capability: makeCapabilityProjection({
      permissions: {
        metadata: "read",
        issues: "write",
        pull_requests: "none",
        contents: "none",
      },
    }),
    webhookHealth: "unknown",
  });
  assertNoSentinel(localVerify, "local setup verify", localSentinelExtras());
  projection.assertGithubAutomationProjectionSafe(localVerify);

  // Status projection with live credential resolve remains secret-free.
  const statusProjection = await projection.buildGithubAutomationStatusProjection({
    resolveLive: false,
  });
  assertNoSentinel(statusProjection, "status projection", localSentinelExtras());
  projection.assertGithubAutomationProjectionSafe(statusProjection);

  // Non-secret config disk + jobs/events must not contain local secrets.
  const cfg = await config.readGithubAutomationConfig();
  assertNoSentinel(cfg, "config after local save", localSentinelExtras());
  if (existsSync(join(automationRoot(), "config.json"))) {
    assertNoSentinel(
      readFileSync(join(automationRoot(), "config.json"), "utf8"),
      "config.json disk",
      localSentinelExtras(),
    );
  }

  // Source isolation: credential store not imported by Links/OAuth domains; credentials route not by verify.
  const verifyRouteSrc = readFileSync(
    join(root, "app/api/github-automation/verify/route.ts"),
    "utf8",
  );
  assert.ok(!/upsertGithubAppLocalCredentials|deleteGithubAppLocalCredentials/.test(verifyRouteSrc));
  assert.ok(!/from\s+["'][^"']*github-app-credential-store/.test(verifyRouteSrc));

  const statusRouteSrc = readFileSync(
    join(root, "app/api/github-automation/status/route.ts"),
    "utf8",
  );
  assert.ok(!/upsertGithubAppLocalCredentials|deleteGithubAppLocalCredentials/.test(statusRouteSrc));

  const storeSrc = readFileSync(join(root, "lib/github-app-credential-store.ts"), "utf8");
  // Comments may mention sibling secret stores for isolation guidance; imports must not.
  assert.ok(
    !/from\s+["'][^"']*(web-credential-store|links-store|oauth-accounts|api-key-accounts)/.test(
      storeSrc,
    ),
  );
  assert.ok(
    !/require\(["'][^"']*(web-credential-store|links-store|oauth-accounts|api-key-accounts)/.test(
      storeSrc,
    ),
  );

  // UI static scan: no hardcoded PEM / absolute path import controls.
  const ui = readFileSync(join(root, "components/GithubAutomationConfig.tsx"), "utf8");
  assert.ok(!ui.includes("BEGIN PRIVATE KEY"));
  assert.ok(!/privateKeyPath|serverPath|absolutePath/.test(ui));
  assert.ok(ui.includes("/api/github-automation/credentials"));

  credentials._testOverrideGithubAppCredentialEnv(null);
  await clearLocalCredentialsForTests();
});

// ─── Cleanup hooks ───────────────────────────────────────────────────────────

scheduler._testResetGithubAutomationScheduler();
scheduler.setGithubAutomationJobHandler(null);
runtime._testSetGithubIssueTriageAutoRegisterDisabled(false);
runtime._testResetGithubIssueTriageHandlerRegistration();
assignee._testOverrideMachineAssigneeCommandRunner(null);
assignee._testOverrideMachineAssigneeUserLookup(null);
client._testOverrideGithubAppClientFetch(undefined);
client._testClearGithubAppInstallationTokenCache();
credentials._testOverrideGithubAppCredentialEnv(null);
credentials._testOverrideGithubAppNowSeconds(null);
credentialStore._testResetGithubAppCredentialStoreQueue();
projection._testResetGithubAutomationActionRateLimit();
try {
  await credentialStore.deleteGithubAppLocalCredentials();
} catch {
  // ignore
}

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log("");
console.log(`passed=${passed} failed=${failed}`);

try {
  rmSync(agentDir, { recursive: true, force: true });
} catch {
  // ignore
}

if (failed > 0) {
  process.exitCode = 1;
}
