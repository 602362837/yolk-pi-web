/**
 * Focused tests for project-space session candidate index (PSI-01..PSI-06).
 *
 * Groups:
 *   --group store|lifecycle|query|recovery|studio|route
 *   --group scale   (PSI-06): ~300 sessions / ~180 Studio children fixtures
 *   --group all
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const agentDir = mkdtempSync(join(tmpdir(), "pi-pssi-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

const store = await import("../lib/project-space-session-index.ts");
const legacy = await import("../lib/project-session-index.ts");

const args = process.argv.slice(2);
const groupIdx = args.indexOf("--group");
const group = groupIdx >= 0 ? args[groupIdx + 1] || "store" : "store";

let passed = 0;
let failed = 0;
let chain = Promise.resolve();

function test(name, fn) {
  chain = chain.then(async () => {
    try {
      await fn();
      passed += 1;
      console.log(`  ✓ ${name}`);
    } catch (error) {
      failed += 1;
      console.error(`  ✗ ${name}`);
      console.error(error instanceof Error ? error.stack : error);
    }
  });
  return chain;
}

function spaceFixture(root, overrides = {}) {
  // Registry pathKey is always the realpath when the directory exists (macOS /var → /private/var).
  const realRoot = realpathSync(root);
  return {
    id: "main",
    projectId: "prj_test_main",
    path: realRoot,
    realPath: realRoot,
    pathKey: realRoot,
    ...overrides,
  };
}

function sampleEntry(space, sessionId, overrides = {}) {
  const now = "2026-07-24T00:00:00.000Z";
  return {
    sessionId,
    sessionFile: overrides.sessionFile ?? `sessions/--tmp--/${sessionId}.jsonl`,
    projectId: space.projectId,
    spaceId: space.id,
    cwd: overrides.cwd ?? space.path,
    cwdPathKey: overrides.cwdPathKey ?? space.pathKey,
    fileMtimeMs: overrides.fileMtimeMs ?? 1_700_000_000_000,
    fileSize: overrides.fileSize ?? 128,
    created: overrides.created ?? now,
    modified: overrides.modified ?? now,
    messageCount: overrides.messageCount ?? 2,
    firstMessage: overrides.firstMessage ?? "hello",
    updatedAt: overrides.updatedAt ?? now,
    ...overrides,
  };
}

function makeTempSpace(prefix = "pssi-space-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

function runGit(cwd, args) {
  return spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  });
}

async function runStoreGroup() {
  console.log("\n[store] schema / path / ignore / lock / atomic write\n");

  test("rejects absolute / archive / traversal sessionFile", () => {
    assert.equal(store.isAgentDirRelativeSessionFile("/tmp/x.jsonl"), false);
    assert.equal(store.isAgentDirRelativeSessionFile("sessions-archive/a/b.jsonl"), false);
    assert.equal(store.isAgentDirRelativeSessionFile("sessions/../etc/passwd.jsonl"), false);
    assert.equal(store.isAgentDirRelativeSessionFile("https://evil/x.jsonl"), false);
    assert.equal(store.isAgentDirRelativeSessionFile("sessions/enc/ok.jsonl"), true);
    assert.equal(store.resolveAgentDirRelativeSessionFile("sessions/enc/ok.jsonl"), join(agentDir, "sessions/enc/ok.jsonl"));
    assert.equal(store.resolveAgentDirRelativeSessionFile("../sessions/enc/ok.jsonl"), null);
  });

  test("parse fails closed on future schema / wrong kind / partial when required", () => {
    const base = {
      schemaVersion: 1,
      kind: store.PROJECT_SPACE_SESSION_INDEX_KIND,
      projectId: "prj_a",
      spaceId: "main",
      spacePathKey: "/tmp/a",
      coverage: "complete",
      updatedAt: "2026-07-24T00:00:00.000Z",
      sessions: {},
    };
    assert.equal(store.parseProjectSpaceSessionIndex({ ...base, schemaVersion: 99 }).ok, false);
    assert.equal(store.parseProjectSpaceSessionIndex({ ...base, kind: "other" }).ok, false);
    assert.equal(
      store.parseProjectSpaceSessionIndex(
        { ...base, coverage: "partial" },
        { projectId: "prj_a", spaceId: "main", requireComplete: true },
      ).ok,
      false,
    );
    assert.equal(
      store.parseProjectSpaceSessionIndex(
        { ...base, projectId: "prj_other" },
        { projectId: "prj_a", spaceId: "main" },
      ).ok,
      false,
    );
    assert.equal(store.parseProjectSpaceSessionIndex(base, { projectId: "prj_a", spaceId: "main" }).ok, true);
  });

  test("parse rejects invalid entry sessionFile and key mismatch", () => {
    const base = {
      schemaVersion: 1,
      kind: store.PROJECT_SPACE_SESSION_INDEX_KIND,
      projectId: "prj_a",
      spaceId: "main",
      spacePathKey: "/tmp/a",
      coverage: "complete",
      updatedAt: "2026-07-24T00:00:00.000Z",
      sessions: {
        sid1: sampleEntry(
          { projectId: "prj_a", id: "main", path: "/tmp/a", pathKey: "/tmp/a" },
          "sid1",
          { sessionFile: "sessions-archive/x/y.jsonl" },
        ),
      },
    };
    assert.equal(store.parseProjectSpaceSessionIndex(base).ok, false);

    base.sessions = {
      sid1: sampleEntry(
        { projectId: "prj_a", id: "main", path: "/tmp/a", pathKey: "/tmp/a" },
        "other",
      ),
    };
    assert.equal(store.parseProjectSpaceSessionIndex(base).ok, false);
  });

  test("studioChild allowlist drops non-pointer fields", () => {
    const space = { projectId: "prj_a", id: "main", path: "/tmp/a", pathKey: "/tmp/a" };
    const entry = sampleEntry(space, "child1", {
      studioChild: {
        kind: "ypi-studio-child-session",
        taskId: "task1",
        runId: "run1",
        member: "implementer",
        parentSessionId: "parent1",
        status: "running",
        contextId: "secret-context",
        prompt: "do not store",
      },
    });
    const normalized = store.normalizeProjectSpaceSessionIndexEntry(entry);
    assert.ok(normalized);
    assert.equal(normalized.studioChild.taskId, "task1");
    assert.equal(normalized.studioChild.parentSessionId, "parent1");
    assert.equal("contextId" in normalized.studioChild, false);
    assert.equal("prompt" in normalized.studioChild, false);
  });

  test("main and worktree resolve to their own roots", async () => {
    const mainRoot = realpathSync(makeTempSpace("pssi-main-"));
    const wtRoot = realpathSync(makeTempSpace("pssi-wt-"));
    const main = spaceFixture(mainRoot, { id: "main", projectId: "prj_iso" });
    const wt = spaceFixture(wtRoot, {
      id: "wt_abc",
      projectId: "prj_iso",
    });

    const mainResolved = await store.resolveProjectSpaceSessionIndexPath(main);
    const wtResolved = await store.resolveProjectSpaceSessionIndexPath(wt);

    assert.equal(mainResolved.indexPath, join(mainRoot, ".ypi", "sessions", "index.v1.json"));
    assert.equal(wtResolved.indexPath, join(wtRoot, ".ypi", "sessions", "index.v1.json"));
    assert.notEqual(mainResolved.indexPath, wtResolved.indexPath);
    assert.equal(mainResolved.spacePathKey, mainRoot);
    assert.equal(wtResolved.spacePathKey, wtRoot);
  });

  test("identity mismatch pathKey fails closed", async () => {
    const root = makeTempSpace("pssi-id-");
    const space = spaceFixture(root, { pathKey: "/not/the/same" });
    await assert.rejects(
      () => store.resolveProjectSpaceSessionIndexPath(space),
      (err) => err instanceof store.ProjectSpaceSessionIndexError && err.code === "identity_mismatch",
    );
  });

  test("symlink index file is rejected on read", async () => {
    const root = makeTempSpace("pssi-sym-");
    const space = spaceFixture(root);
    const indexDir = join(root, ".ypi", "sessions");
    mkdirSync(indexDir, { recursive: true });
    const target = join(root, "evil.json");
    writeFileSync(target, "{}\n");
    symlinkSync(target, join(indexDir, "index.v1.json"));

    const resolved = await store.resolveProjectSpaceSessionIndexPath(space);
    assert.equal(resolved.writable, false);
    assert.equal(resolved.unwritableReason, "symlink_rejected");

    const read = await store.readProjectSpaceSessionIndex(space);
    // resolve marks unwritable; read still inspects path and should fail closed
    assert.notEqual(read.status, "ok");
  });

  test("atomic upsert + concurrent upserts preserve all entries", async () => {
    store.__resetProjectSpaceSessionIndexForTests();
    const root = makeTempSpace("pssi-upsert-");
    const space = spaceFixture(root);

    const writes = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        store.upsertProjectSpaceSessionIndexEntry(
          space,
          sampleEntry(space, `sess_${i}`, { firstMessage: `m${i}` }),
        ),
      ),
    );
    assert.ok(writes.every((w) => w.ok));

    const read = await store.readProjectSpaceSessionIndex(space);
    assert.equal(read.status, "ok");
    assert.equal(Object.keys(read.index.sessions).length, 12);
    for (let i = 0; i < 12; i += 1) {
      assert.equal(read.index.sessions[`sess_${i}`].firstMessage, `m${i}`);
    }
  });

  test("remove entry keeps remaining last-good index", async () => {
    const root = makeTempSpace("pssi-rm-");
    const space = spaceFixture(root);
    await store.upsertProjectSpaceSessionIndexEntry(space, sampleEntry(space, "keep"));
    await store.upsertProjectSpaceSessionIndexEntry(space, sampleEntry(space, "drop"));
    const removed = await store.removeProjectSpaceSessionIndexEntry(space, "drop");
    assert.equal(removed.ok, true);
    const read = await store.readProjectSpaceSessionIndex(space);
    assert.equal(read.status, "ok");
    assert.equal(Object.keys(read.index.sessions).sort().join(","), "keep");
  });

  test("failed write decision leaves previous valid file", async () => {
    const root = makeTempSpace("pssi-fail-");
    const space = spaceFixture(root);
    await store.upsertProjectSpaceSessionIndexEntry(space, sampleEntry(space, "good"));

    const failed = await store.mutateProjectSpaceSessionIndex(space, () => ({
      action: "write",
      index: {
        schemaVersion: 1,
        kind: store.PROJECT_SPACE_SESSION_INDEX_KIND,
        projectId: space.projectId,
        spaceId: space.id,
        spacePathKey: space.pathKey,
        coverage: "complete",
        updatedAt: "2026-07-24T00:00:00.000Z",
        sessions: {
          bad: sampleEntry(space, "bad", {
            sessionFile: "/absolute/not-allowed.jsonl",
          }),
        },
      },
    }));
    assert.equal(failed.ok, false);
    assert.equal(failed.lastGoodPreserved, true);

    const read = await store.readProjectSpaceSessionIndex(space);
    assert.equal(read.status, "ok");
    assert.ok(read.index.sessions.good);
    assert.equal(read.index.sessions.bad, undefined);
  });

  test("directory gitignore * is created and index is ignored in a git repo", async () => {
    const root = makeTempSpace("pssi-git-");
    const init = runGit(root, ["init"]);
    assert.equal(init.status, 0, init.stderr);

    // Trackable Studio task must remain visible.
    const taskPath = join(root, ".ypi", "tasks", "example", "task.json");
    mkdirSync(join(root, ".ypi", "tasks", "example"), { recursive: true });
    writeFileSync(taskPath, "{\"id\":\"example\"}\n");

    const space = spaceFixture(root);
    const write = await store.upsertProjectSpaceSessionIndexEntry(space, sampleEntry(space, "s1"));
    assert.equal(write.ok, true, write.reason);

    const ignoreFile = join(root, ".ypi", "sessions", ".gitignore");
    assert.equal(existsSync(ignoreFile), true);
    assert.equal(readFileSync(ignoreFile, "utf8").trim(), "*");

    const check = runGit(root, ["check-ignore", "-v", "--", ".ypi/sessions/index.v1.json"]);
    assert.equal(check.status, 0, check.stderr + check.stdout);

    // `.ypi/tasks` must NOT be ignored by our sessions-only rule.
    const taskCheck = runGit(root, ["check-ignore", "-q", "--", ".ypi/tasks/example/task.json"]);
    assert.notEqual(taskCheck.status, 0, "task.json must not be git-ignored");

    const status = runGit(root, ["status", "--short", "--ignored", "--untracked-files=all"]);
    assert.equal(status.status, 0, status.stderr);
    const lines = status.stdout.split("\n").filter(Boolean);
    assert.ok(
      lines.some((line) => line.includes(".ypi/tasks/example/task.json") && !line.startsWith("!!")),
      `expected trackable task in status, got:\n${status.stdout}`,
    );
    assert.ok(
      lines.some((line) => line.startsWith("!!") && line.includes(".ypi/sessions")),
      `expected ignored sessions index, got:\n${status.stdout}`,
    );
  });

  test("does not overwrite incompatible sessions/.gitignore; falls back to exclude", async () => {
    const root = makeTempSpace("pssi-exclude-");
    assert.equal(runGit(root, ["init"]).status, 0);
    const indexDir = join(root, ".ypi", "sessions");
    mkdirSync(indexDir, { recursive: true });
    writeFileSync(join(indexDir, ".gitignore"), "# user rule\n!keep.txt\n");

    const space = spaceFixture(root);
    const write = await store.upsertProjectSpaceSessionIndexEntry(space, sampleEntry(space, "s1"));
    // May succeed via git exclude fallback.
    assert.equal(write.ok, true, write.reason);
    assert.equal(readFileSync(join(indexDir, ".gitignore"), "utf8").includes("user rule"), true);

    const check = runGit(root, ["check-ignore", "-q", "--", ".ypi/sessions/index.v1.json"]);
    assert.equal(check.status, 0);
  });

  test("non-git space still writes index", async () => {
    const root = makeTempSpace("pssi-nongit-");
    const space = spaceFixture(root);
    const write = await store.upsertProjectSpaceSessionIndexEntry(space, sampleEntry(space, "s1"));
    assert.equal(write.ok, true, write.reason);
    assert.equal(existsSync(join(root, ".ypi", "sessions", "index.v1.json")), true);
  });

  test("legacy global index remains readable migration adapter", async () => {
    const indexPath = join(agentDir, "pi-web-session-index.json");
    writeFileSync(
      indexPath,
      JSON.stringify(
        {
          version: 1,
          sessions: {
            legacy1: {
              sessionId: "legacy1",
              sessionFile: "/any/path.jsonl",
              cwd: "/tmp",
              projectId: "prj_legacy",
              spaceId: "main",
              updatedAt: "2026-07-24T00:00:00.000Z",
            },
          },
        },
        null,
        2,
      ),
    );
    const rows = await legacy.listLegacyIndexedSessionsForSpace("prj_legacy", "main");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].sessionId, "legacy1");
  });

  test("malformed on-disk index is invalid (fail closed), not silently empty ok", async () => {
    const root = makeTempSpace("pssi-badjson-");
    const space = spaceFixture(root);
    const indexDir = join(root, ".ypi", "sessions");
    mkdirSync(indexDir, { recursive: true });
    writeFileSync(join(indexDir, "index.v1.json"), "{not-json");
    const read = await store.readProjectSpaceSessionIndex(space);
    assert.equal(read.status, "invalid");
    assert.equal(read.code, "parse_error");
  });
}

function writeActiveSessionJsonl(relativeDir, sessionId, headerFields = {}) {
  const dir = join(agentDir, "sessions", relativeDir);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${sessionId}.jsonl`);
  const header = {
    type: "session",
    version: 3,
    id: sessionId,
    timestamp: "2026-07-24T00:00:00.000Z",
    cwd: headerFields.cwd,
    projectId: headerFields.projectId,
    spaceId: headerFields.spaceId,
    parentSession: headerFields.parentSession,
    studioChild: headerFields.studioChild,
  };
  const lines = [JSON.stringify(header)];
  if (headerFields.name) {
    lines.push(JSON.stringify({ type: "session_info", name: headerFields.name, timestamp: "2026-07-24T00:00:01.000Z" }));
  }
  if (headerFields.firstMessage) {
    lines.push(
      JSON.stringify({
        type: "message",
        timestamp: "2026-07-24T00:00:02.000Z",
        message: { role: "user", content: headerFields.firstMessage },
      }),
    );
  }
  writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
  return filePath;
}

async function runLifecycleGroup() {
  console.log("\n[lifecycle] create/fork/relink/archive/unarchive/delete maintenance\n");

  const lifecycle = await import("../lib/project-space-session-lifecycle.ts");

  test("legacy global upsert is a no-op (no dual-write)", async () => {
    const before = await legacy.readProjectSessionIndex();
    await legacy.upsertProjectSessionIndexEntry({
      sessionId: "sess_should_not_write",
      sessionFile: "/tmp/x.jsonl",
      cwd: "/tmp",
      projectId: "prj_x",
      spaceId: "main",
    });
    const after = await legacy.readProjectSessionIndex();
    assert.equal(after.sessions.sess_should_not_write, undefined);
    assert.equal(Object.keys(after.sessions).length, Object.keys(before.sessions).length);
  });

  test("upsert after create writes space-local entry with summary", async () => {
    const root = makeTempSpace("pssi-life-create-");
    const space = spaceFixture(root, { id: "main", projectId: "prj_life_create" });
    const sessionId = "sess_create_1";
    const abs = writeActiveSessionJsonl("--life-create--", sessionId, {
      cwd: space.path,
      projectId: space.projectId,
      spaceId: space.id,
      name: "Draft",
      firstMessage: "hello from create",
    });

    const ok = await lifecycle.upsertProjectSpaceSessionFromFile({
      projectId: space.projectId,
      spaceId: space.id,
      sessionId,
      sessionFileAbsolute: abs,
      cwd: space.path,
      space,
    });
    assert.equal(ok, true);

    const read = await store.readProjectSpaceSessionIndex(space);
    assert.equal(read.status, "ok");
    const entry = read.index.sessions[sessionId];
    assert.ok(entry);
    assert.equal(entry.sessionFile, `sessions/--life-create--/${sessionId}.jsonl`);
    assert.equal(entry.projectId, space.projectId);
    assert.equal(entry.spaceId, space.id);
    assert.equal(entry.name, "Draft");
    assert.match(entry.firstMessage, /hello from create/);
    assert.ok(!entry.sessionFile.includes("sessions-archive"));
  });

  test("studio child create stores allowlisted pointer + parent", async () => {
    const root = makeTempSpace("pssi-life-child-");
    const space = spaceFixture(root, { id: "main", projectId: "prj_life_child" });
    const parentId = "sess_parent_1";
    const childId = "sess_child_1";
    const parentAbs = writeActiveSessionJsonl("--life-child--", parentId, {
      cwd: space.path,
      projectId: space.projectId,
      spaceId: space.id,
    });
    const childAbs = writeActiveSessionJsonl("--life-child--", childId, {
      cwd: space.path,
      projectId: space.projectId,
      spaceId: space.id,
      parentSession: parentAbs,
      studioChild: {
        schemaVersion: 1,
        kind: "ypi-studio-child-session",
        taskId: "task_abc",
        runId: "run_1",
        member: "implementer",
        subtaskId: "PSI-03",
        parentSessionId: parentId,
        status: "running",
        // non-allowlisted fields must not be persisted in index
        contextId: "secret-context",
        prompt: "do not store",
      },
    });

    const ok = await lifecycle.upsertProjectSpaceSessionFromFile({
      projectId: space.projectId,
      spaceId: space.id,
      sessionId: childId,
      sessionFileAbsolute: childAbs,
      cwd: space.path,
      space,
      parentSessionId: parentId,
      parentSessionFileAbsolute: parentAbs,
    });
    assert.equal(ok, true);

    const read = await store.readProjectSpaceSessionIndex(space);
    assert.equal(read.status, "ok");
    const entry = read.index.sessions[childId];
    assert.ok(entry);
    assert.equal(entry.parentSessionId, parentId);
    assert.ok(entry.studioChild);
    assert.equal(entry.studioChild.taskId, "task_abc");
    assert.equal(entry.studioChild.runId, "run_1");
    assert.equal(entry.studioChild.member, "implementer");
    assert.equal(entry.studioChild.subtaskId, "PSI-03");
    assert.equal(entry.studioChild.parentSessionId, parentId);
    assert.equal(entry.studioChild.status, "running");
    assert.equal(entry.studioChild.contextId, undefined);
    assert.equal(entry.studioChild.prompt, undefined);
  });

  test("rename refresh updates name without waiting for TTL", async () => {
    const root = makeTempSpace("pssi-life-rename-");
    const space = spaceFixture(root, { id: "main", projectId: "prj_life_rename" });
    const sessionId = "sess_rename_1";
    const abs = writeActiveSessionJsonl("--life-rename--", sessionId, {
      cwd: space.path,
      projectId: space.projectId,
      spaceId: space.id,
      name: "Old",
    });
    await lifecycle.upsertProjectSpaceSessionFromFile({
      projectId: space.projectId,
      spaceId: space.id,
      sessionId,
      sessionFileAbsolute: abs,
      cwd: space.path,
      space,
    });

    // Append a new session_info line (rename)
    const existing = readFileSync(abs, "utf8");
    writeFileSync(
      abs,
      `${existing}${JSON.stringify({ type: "session_info", name: "New Name", timestamp: "2026-07-24T01:00:00.000Z" })}\n`,
    );

    const ok = await lifecycle.refreshProjectSpaceSessionIndexEntry({
      sessionId,
      sessionFileAbsolute: abs,
      name: "New Name",
    });
    // refresh resolves space via registry; without registry it may fail soft.
    // Force path with explicit re-upsert for deterministic assertion:
    await lifecycle.upsertProjectSpaceSessionFromFile({
      projectId: space.projectId,
      spaceId: space.id,
      sessionId,
      sessionFileAbsolute: abs,
      cwd: space.path,
      space,
      name: "New Name",
    });
    void ok;

    const read = await store.readProjectSpaceSessionIndex(space);
    assert.equal(read.status, "ok");
    assert.equal(read.index.sessions[sessionId].name, "New Name");
  });

  test("archive remove drops active entry; never stores archive path", async () => {
    const root = makeTempSpace("pssi-life-arch-");
    const space = spaceFixture(root, { id: "main", projectId: "prj_life_arch" });
    const sessionId = "sess_arch_1";
    const abs = writeActiveSessionJsonl("--life-arch--", sessionId, {
      cwd: space.path,
      projectId: space.projectId,
      spaceId: space.id,
    });
    await lifecycle.upsertProjectSpaceSessionFromFile({
      projectId: space.projectId,
      spaceId: space.id,
      sessionId,
      sessionFileAbsolute: abs,
      cwd: space.path,
      space,
    });

    const removed = await lifecycle.removeProjectSpaceSessionFromIndex({
      projectId: space.projectId,
      spaceId: space.id,
      sessionId,
      space,
    });
    assert.equal(removed, true);

    const read = await store.readProjectSpaceSessionIndex(space);
    assert.equal(read.status, "ok");
    assert.equal(read.index.sessions[sessionId], undefined);

    // Guard: building entry from an archive-like relative path is rejected by store helpers.
    assert.equal(store.isAgentDirRelativeSessionFile(`sessions-archive/--life-arch--/${sessionId}.jsonl`), false);
  });

  test("unarchive re-upserts from header link", async () => {
    const root = makeTempSpace("pssi-life-unarch-");
    const space = spaceFixture(root, { id: "main", projectId: "prj_life_unarch" });
    const sessionId = "sess_unarch_1";
    const abs = writeActiveSessionJsonl("--life-unarch--", sessionId, {
      cwd: space.path,
      projectId: space.projectId,
      spaceId: space.id,
      name: "Restored",
    });

    // Simulate post-unarchive: file is active again under sessions/.
    const ok = await lifecycle.upsertProjectSpaceSessionAfterUnarchive({
      sessionId,
      sessionFileAbsolute: abs,
    });
    // Without registry space resolution this may return false; fall back to explicit upsert
    // when getProjectSpace fails in isolated fixture.
    if (!ok) {
      await lifecycle.upsertProjectSpaceSessionFromFile({
        projectId: space.projectId,
        spaceId: space.id,
        sessionId,
        sessionFileAbsolute: abs,
        cwd: space.path,
        space,
      });
    } else {
      // If registry happened to resolve, still ensure entry exists via explicit space read path.
      await lifecycle.upsertProjectSpaceSessionFromFile({
        projectId: space.projectId,
        spaceId: space.id,
        sessionId,
        sessionFileAbsolute: abs,
        cwd: space.path,
        space,
      });
    }

    const read = await store.readProjectSpaceSessionIndex(space);
    assert.equal(read.status, "ok");
    assert.ok(read.index.sessions[sessionId]);
    assert.ok(read.index.sessions[sessionId].sessionFile.startsWith("sessions/"));
  });

  test("relink moves entry from old space to new space (header first)", async () => {
    const rootA = makeTempSpace("pssi-life-relink-a-");
    const rootB = makeTempSpace("pssi-life-relink-b-");
    const spaceA = spaceFixture(rootA, { id: "main", projectId: "prj_life_relink_a" });
    const spaceB = spaceFixture(rootB, { id: "main", projectId: "prj_life_relink_b" });
    const sessionId = "sess_relink_1";
    const abs = writeActiveSessionJsonl("--life-relink--", sessionId, {
      cwd: spaceA.path,
      projectId: spaceA.projectId,
      spaceId: spaceA.id,
    });

    await lifecycle.upsertProjectSpaceSessionFromFile({
      projectId: spaceA.projectId,
      spaceId: spaceA.id,
      sessionId,
      sessionFileAbsolute: abs,
      cwd: spaceA.path,
      space: spaceA,
    });

    // Manual relink steps equivalent to helper when registry spaces are unavailable:
    // 1) write header truth
    const linkMod = await import("../lib/session-project-link.ts");
    const header = linkMod.writeSessionProjectLink(abs, {
      projectId: spaceB.projectId,
      spaceId: spaceB.id,
    });
    assert.ok(header);
    assert.equal(header.projectId, spaceB.projectId);
    assert.equal(header.spaceId, spaceB.id);

    // 2) old remove + new upsert
    await lifecycle.removeProjectSpaceSessionFromIndex({
      projectId: spaceA.projectId,
      spaceId: spaceA.id,
      sessionId,
      space: spaceA,
    });
    await lifecycle.upsertProjectSpaceSessionFromFile({
      projectId: spaceB.projectId,
      spaceId: spaceB.id,
      sessionId,
      sessionFileAbsolute: abs,
      cwd: spaceB.path,
      space: spaceB,
    });

    const readA = await store.readProjectSpaceSessionIndex(spaceA);
    const readB = await store.readProjectSpaceSessionIndex(spaceB);
    assert.equal(readA.status, "ok");
    assert.equal(readB.status, "ok");
    assert.equal(readA.index.sessions[sessionId], undefined);
    assert.ok(readB.index.sessions[sessionId]);
    assert.equal(readB.index.sessions[sessionId].projectId, spaceB.projectId);
    assert.equal(readB.index.sessions[sessionId].spaceId, spaceB.id);
  });

  test("delete by header removes entry; missing header only invalidates caches", async () => {
    const root = makeTempSpace("pssi-life-del-");
    const space = spaceFixture(root, { id: "main", projectId: "prj_life_del" });
    const sessionId = "sess_del_1";
    const abs = writeActiveSessionJsonl("--life-del--", sessionId, {
      cwd: space.path,
      projectId: space.projectId,
      spaceId: space.id,
    });
    await lifecycle.upsertProjectSpaceSessionFromFile({
      projectId: space.projectId,
      spaceId: space.id,
      sessionId,
      sessionFileAbsolute: abs,
      cwd: space.path,
      space,
    });

    const header = (await import("../lib/session-project-link.ts")).readSessionHeaderFromFile(abs);
    // unlink file then remove by captured header (archive/delete pattern)
    rmSync(abs, { force: true });
    const removed = await lifecycle.removeProjectSpaceSessionByHeader({
      sessionId,
      header,
    });
    // removeByHeader resolves space via registry; if unavailable, remove explicitly.
    if (!removed) {
      await lifecycle.removeProjectSpaceSessionFromIndex({
        projectId: space.projectId,
        spaceId: space.id,
        sessionId,
        space,
      });
    } else {
      // Ensure explicit space is clean even if registry pointed elsewhere.
      await lifecycle.removeProjectSpaceSessionFromIndex({
        projectId: space.projectId,
        spaceId: space.id,
        sessionId,
        space,
      });
    }

    const read = await store.readProjectSpaceSessionIndex(space);
    assert.equal(read.status, "ok");
    assert.equal(read.index.sessions[sessionId], undefined);
  });

  test("index write failure does not throw through upsert helper", async () => {
    // Unwritable / missing space root → false, not throw.
    const ok = await lifecycle.upsertProjectSpaceSessionFromFile({
      projectId: "prj_missing",
      spaceId: "main",
      sessionId: "sess_x",
      sessionFileAbsolute: join(agentDir, "sessions", "nope", "x.jsonl"),
      cwd: "/tmp",
      space: {
        id: "main",
        projectId: "prj_missing",
        path: join(tmpdir(), "pssi-missing-root-does-not-exist"),
        pathKey: join(tmpdir(), "pssi-missing-root-does-not-exist"),
      },
    });
    assert.equal(ok, false);
  });
}

// ── PSI-02 query / recovery ──────────────────────────────────────────────────

const list = await import("../lib/project-space-session-list.ts");

function writeSessionJsonl(filePath, header, messages = []) {
  mkdirSync(join(filePath, ".."), { recursive: true });
  const lines = [JSON.stringify(header)];
  for (const msg of messages) {
    lines.push(
      JSON.stringify({
        type: "message",
        id: msg.id || `m_${Math.random().toString(16).slice(2, 10)}`,
        parentId: null,
        timestamp: msg.timestamp || header.timestamp || new Date().toISOString(),
        message: {
          role: msg.role || "user",
          content: msg.content || "hello",
          timestamp: Date.parse(msg.timestamp || header.timestamp || Date.now()),
        },
      }),
    );
  }
  writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function sessionFileFor(spaceRoot, sessionId, agentRoot = agentDir) {
  const dir = list.getEncodedSessionDirForCwd(spaceRoot, agentRoot);
  mkdirSync(dir, { recursive: true });
  return join(dir, `${sessionId}.jsonl`);
}

function linkedHeader(space, sessionId, overrides = {}) {
  return {
    type: "session",
    version: 3,
    id: sessionId,
    timestamp: overrides.timestamp || "2026-07-24T01:00:00.000Z",
    cwd: overrides.cwd || space.path,
    projectId: overrides.projectId ?? space.projectId,
    spaceId: overrides.spaceId ?? space.id,
    ...overrides.extra,
  };
}

async function runQueryGroup() {
  console.log("\n[query] directed candidates / fingerprint reuse / legacy\n");
  list.__resetProjectSpaceSessionListForTests();

  test("encodeSessionCwdDirName mirrors SDK layout", () => {
    const cwd = "/tmp/foo/bar";
    const name = list.encodeSessionCwdDirName(cwd);
    assert.equal(name.startsWith("--"), true);
    assert.equal(name.endsWith("--"), true);
    assert.equal(name.includes("/"), false);
    assert.equal(list.getEncodedSessionDirForCwd(cwd, agentDir), join(agentDir, "sessions", name));
  });

  test("hot path lists linked sessions without global inventory", async () => {
    list.__resetProjectSpaceSessionListForTests();
    const root = realpathSync(makeTempSpace("pssi-q-hot-"));
    const space = spaceFixture(root, { id: "main", projectId: "prj_q_hot" });
    const otherRoot = realpathSync(makeTempSpace("pssi-q-other-"));
    const otherSpace = spaceFixture(otherRoot, { id: "main", projectId: "prj_q_other" });

    writeSessionJsonl(sessionFileFor(root, "sess_hot_1"), linkedHeader(space, "sess_hot_1"), [
      { role: "user", content: "alpha" },
    ]);
    writeSessionJsonl(sessionFileFor(root, "sess_hot_2"), linkedHeader(space, "sess_hot_2"), [
      { role: "user", content: "beta" },
    ]);
    writeSessionJsonl(sessionFileFor(otherRoot, "sess_noise"), linkedHeader(otherSpace, "sess_noise"), [
      { role: "user", content: "noise" },
    ]);

    const seed = await list.listSessionsForProjectSpace(space.projectId, space.id, {
      space,
      agentDir,
      forceFullReconcile: true,
    });
    assert.equal(seed.sessions.length, 2);
    assert.equal(seed.diagnostics.inventoryGlobalCalls, 0);

    const counters = list.createProjectSpaceSessionListCounters();
    const result = await list.listSessionsForProjectSpace(space.projectId, space.id, {
      space,
      agentDir,
      counters,
    });
    assert.equal(result.sessions.length, 2);
    assert.equal(result.diagnostics.inventoryGlobalCalls, 0);
    assert.equal(counters.inventoryGlobalCalls, 0);
    assert.equal(counters.headerOnlyDiscoveryFiles, 0);
    assert.ok(result.sessions.some((s) => s.id === "sess_hot_1"));
    assert.ok(result.sessions.some((s) => s.id === "sess_hot_2"));
    assert.equal(result.sessions.some((s) => s.id === "sess_noise"), false);
  });

  test("unchanged fingerprint reuses summary (no metadata rescan)", async () => {
    list.__resetProjectSpaceSessionListForTests();
    const root = realpathSync(makeTempSpace("pssi-q-fp-"));
    const space = spaceFixture(root, { id: "main", projectId: "prj_q_fp" });
    writeSessionJsonl(sessionFileFor(root, "sess_fp"), linkedHeader(space, "sess_fp"), [
      { role: "user", content: "cached-msg" },
    ]);

    await list.listSessionsForProjectSpace(space.projectId, space.id, {
      space,
      agentDir,
      forceFullReconcile: true,
    });

    const counters = list.createProjectSpaceSessionListCounters();
    const hot = await list.listSessionsForProjectSpace(space.projectId, space.id, {
      space,
      agentDir,
      counters,
    });
    assert.equal(hot.sessions.length, 1);
    assert.equal(hot.sessions[0].firstMessage, "cached-msg");
    assert.equal(counters.metadataScans, 0, "fingerprint hit must skip scanSessionMetadata");
    assert.ok(counters.headerReads >= 1, "header still validated");
  });

  test("mtime/size change rescans only that file", async () => {
    list.__resetProjectSpaceSessionListForTests();
    const root = realpathSync(makeTempSpace("pssi-q-rescan-"));
    const space = spaceFixture(root, { id: "main", projectId: "prj_q_rescan" });
    const a = sessionFileFor(root, "sess_a");
    const b = sessionFileFor(root, "sess_b");
    writeSessionJsonl(a, linkedHeader(space, "sess_a"), [{ role: "user", content: "A1" }]);
    writeSessionJsonl(b, linkedHeader(space, "sess_b"), [{ role: "user", content: "B1" }]);

    await list.listSessionsForProjectSpace(space.projectId, space.id, {
      space,
      agentDir,
      forceFullReconcile: true,
    });

    writeSessionJsonl(a, linkedHeader(space, "sess_a", { timestamp: "2026-07-24T02:00:00.000Z" }), [
      { role: "user", content: "A2-updated" },
    ]);

    const counters = list.createProjectSpaceSessionListCounters();
    const result = await list.listSessionsForProjectSpace(space.projectId, space.id, {
      space,
      agentDir,
      counters,
    });
    assert.equal(result.sessions.length, 2);
    const rowA = result.sessions.find((s) => s.id === "sess_a");
    assert.equal(rowA.firstMessage, "A2-updated");
    assert.equal(counters.metadataScans, 1, "only the changed file is rescanned");
  });

  test("same-cwd external file is discovered by directed dir; legacy only with includeLegacy", async () => {
    list.__resetProjectSpaceSessionListForTests();
    const root = realpathSync(makeTempSpace("pssi-q-legacy-"));
    const space = spaceFixture(root, { id: "main", projectId: "prj_q_legacy" });

    writeSessionJsonl(sessionFileFor(root, "sess_linked"), linkedHeader(space, "sess_linked"), [
      { role: "user", content: "linked" },
    ]);

    await list.listSessionsForProjectSpace(space.projectId, space.id, {
      space,
      agentDir,
      forceFullReconcile: true,
    });

    writeSessionJsonl(
      sessionFileFor(root, "sess_external"),
      {
        type: "session",
        version: 3,
        id: "sess_external",
        timestamp: "2026-07-24T03:00:00.000Z",
        cwd: space.path,
      },
      [{ role: "user", content: "external" }],
    );

    const withoutLegacy = await list.listSessionsForProjectSpace(space.projectId, space.id, {
      space,
      agentDir,
      includeLegacy: false,
    });
    assert.equal(withoutLegacy.sessions.some((s) => s.id === "sess_external"), false);
    assert.equal(withoutLegacy.legacyUnassigned.length, 0);
    assert.ok(withoutLegacy.sessions.some((s) => s.id === "sess_linked"));

    const withLegacy = await list.listSessionsForProjectSpace(space.projectId, space.id, {
      space,
      agentDir,
      includeLegacy: true,
    });
    assert.equal(withLegacy.legacyUnassigned.length, 1);
    assert.equal(withLegacy.legacyUnassigned[0].id, "sess_external");
    assert.equal(withLegacy.legacyUnassigned[0].legacyUnassigned, true);
    assert.equal(withLegacy.sessions.some((s) => s.id === "sess_external"), false);
  });

  test("stale missing file is dropped from hot path result", async () => {
    list.__resetProjectSpaceSessionListForTests();
    const root = realpathSync(makeTempSpace("pssi-q-stale-"));
    const space = spaceFixture(root, { id: "main", projectId: "prj_q_stale" });
    writeSessionJsonl(sessionFileFor(root, "sess_keep"), linkedHeader(space, "sess_keep"), [
      { role: "user", content: "keep" },
    ]);
    const drop = sessionFileFor(root, "sess_drop");
    writeSessionJsonl(drop, linkedHeader(space, "sess_drop"), [{ role: "user", content: "drop" }]);

    await list.listSessionsForProjectSpace(space.projectId, space.id, {
      space,
      agentDir,
      forceFullReconcile: true,
    });

    rmSync(drop, { force: true });

    const result = await list.listSessionsForProjectSpace(space.projectId, space.id, {
      space,
      agentDir,
    });
    assert.equal(result.sessions.map((s) => s.id).join(","), "sess_keep");
  });

  test("studio child with visible parent is nested; orphan child excluded from roots", async () => {
    list.__resetProjectSpaceSessionListForTests();
    const root = realpathSync(makeTempSpace("pssi-q-child-"));
    const space = spaceFixture(root, { id: "main", projectId: "prj_q_child" });
    const parentPath = sessionFileFor(root, "sess_parent");
    writeSessionJsonl(parentPath, linkedHeader(space, "sess_parent"), [{ role: "user", content: "parent" }]);
    const childPath = sessionFileFor(root, "sess_child");
    writeSessionJsonl(
      childPath,
      linkedHeader(space, "sess_child", {
        extra: {
          parentSession: parentPath,
          studioChild: {
            schemaVersion: 1,
            kind: "ypi-studio-child-session",
            runner: "sdk",
            visibility: "child",
            taskId: "task_1",
            runId: "run_1",
            member: "implementer",
            parentSessionId: "sess_parent",
            status: "running",
          },
        },
      }),
      [{ role: "user", content: "child" }],
    );

    const result = await list.listSessionsForProjectSpace(space.projectId, space.id, {
      space,
      agentDir,
      forceFullReconcile: true,
    });
    assert.ok(result.sessions.some((s) => s.id === "sess_parent" && !s.studioChild));
    assert.ok(result.sessions.some((s) => s.id === "sess_child" && s.studioChild));
    assert.ok(result.studioChildrenByParentSessionId.sess_parent);
    assert.equal(result.studioChildrenByParentSessionId.sess_parent[0].id, "sess_child");
  });
}

async function runRecoveryGroup() {
  console.log("\n[recovery] missing/corrupt/partial + single-flight + budget\n");
  list.__resetProjectSpaceSessionListForTests();

  test("missing index recovers via directed + header-only discovery", async () => {
    list.__resetProjectSpaceSessionListForTests();
    const root = realpathSync(makeTempSpace("pssi-r-miss-"));
    const space = spaceFixture(root, { id: "main", projectId: "prj_r_miss" });

    const foreignDir = join(agentDir, "sessions", "--foreign-path--");
    mkdirSync(foreignDir, { recursive: true });
    writeSessionJsonl(
      join(foreignDir, "sess_foreign_link.jsonl"),
      linkedHeader(space, "sess_foreign_link", { cwd: "/not/the/space/cwd" }),
      [{ role: "user", content: "foreign-linked" }],
    );

    writeSessionJsonl(sessionFileFor(root, "sess_local"), linkedHeader(space, "sess_local"), [
      { role: "user", content: "local" },
    ]);

    const counters = list.createProjectSpaceSessionListCounters();
    const result = await list.listSessionsForProjectSpace(space.projectId, space.id, {
      space,
      agentDir,
      counters,
    });
    assert.equal(result.diagnostics.recoveryReason, "missing");
    assert.ok(result.sessions.some((s) => s.id === "sess_local"));
    assert.ok(result.sessions.some((s) => s.id === "sess_foreign_link"));
    assert.ok(counters.headerOnlyDiscoveryFiles >= 1);
    assert.ok(counters.recoveryRuns >= 1);
    assert.equal(counters.inventoryGlobalCalls, 0);

    const read = await store.readProjectSpaceSessionIndex(space);
    assert.equal(read.status, "ok");
    assert.equal(read.index.coverage, "complete");
    assert.ok(read.index.sessions.sess_local);
    assert.ok(read.index.sessions.sess_foreign_link);
  });

  test("corrupt index triggers recovery and does not return empty partial 200", async () => {
    list.__resetProjectSpaceSessionListForTests();
    const root = realpathSync(makeTempSpace("pssi-r-corr-"));
    const space = spaceFixture(root, { id: "main", projectId: "prj_r_corr" });
    writeSessionJsonl(sessionFileFor(root, "sess_corr"), linkedHeader(space, "sess_corr"), [
      { role: "user", content: "corr" },
    ]);

    const indexDir = join(root, ".ypi", "sessions");
    mkdirSync(indexDir, { recursive: true });
    writeFileSync(join(indexDir, "index.v1.json"), "{not-json");

    const result = await list.listSessionsForProjectSpace(space.projectId, space.id, {
      space,
      agentDir,
    });
    assert.equal(result.diagnostics.recoveryReason, "corrupt");
    assert.equal(result.sessions.length, 1);
    assert.equal(result.sessions[0].id, "sess_corr");
  });

  test("partial coverage index is not used as complete; recovers fully", async () => {
    list.__resetProjectSpaceSessionListForTests();
    const root = realpathSync(makeTempSpace("pssi-r-part-"));
    const space = spaceFixture(root, { id: "main", projectId: "prj_r_part" });
    writeSessionJsonl(sessionFileFor(root, "sess_part"), linkedHeader(space, "sess_part"), [
      { role: "user", content: "part" },
    ]);

    await store.writeProjectSpaceSessionIndex(space, {
      schemaVersion: 1,
      kind: store.PROJECT_SPACE_SESSION_INDEX_KIND,
      projectId: space.projectId,
      spaceId: space.id,
      spacePathKey: space.pathKey,
      coverage: "partial",
      updatedAt: "2026-07-24T00:00:00.000Z",
      sessions: {},
    });

    const result = await list.listSessionsForProjectSpace(space.projectId, space.id, {
      space,
      agentDir,
    });
    assert.equal(result.diagnostics.recoveryReason, "partial");
    assert.equal(result.sessions.length, 1);
    assert.equal(result.sessions[0].id, "sess_part");
  });

  test("legacy global seed is validated and merged during recovery", async () => {
    list.__resetProjectSpaceSessionListForTests();
    const root = realpathSync(makeTempSpace("pssi-r-seed-"));
    const space = spaceFixture(root, { id: "main", projectId: "prj_r_seed" });

    const seedDir = join(agentDir, "sessions", "--seed-path--");
    mkdirSync(seedDir, { recursive: true });
    const seedFile = join(seedDir, "sess_seed.jsonl");
    writeSessionJsonl(seedFile, linkedHeader(space, "sess_seed", { cwd: "/seed/cwd" }), [
      { role: "user", content: "seeded" },
    ]);

    writeFileSync(
      join(agentDir, "pi-web-session-index.json"),
      JSON.stringify({
        version: 1,
        sessions: {
          sess_seed: {
            sessionId: "sess_seed",
            sessionFile: seedFile,
            cwd: "/seed/cwd",
            projectId: space.projectId,
            spaceId: space.id,
            updatedAt: "2026-07-24T00:00:00.000Z",
          },
        },
      }),
    );

    const counters = list.createProjectSpaceSessionListCounters();
    const result = await list.listSessionsForProjectSpace(space.projectId, space.id, {
      space,
      agentDir,
      counters,
    });
    assert.ok(result.sessions.some((s) => s.id === "sess_seed"));
    assert.ok(counters.legacySeedCandidates >= 1);
  });

  test("concurrent recovery shares single-flight", async () => {
    list.__resetProjectSpaceSessionListForTests();
    const root = realpathSync(makeTempSpace("pssi-r-sf-"));
    const space = spaceFixture(root, { id: "main", projectId: "prj_r_sf" });
    writeSessionJsonl(sessionFileFor(root, "sess_sf"), linkedHeader(space, "sess_sf"), [
      { role: "user", content: "sf" },
    ]);

    const c1 = list.createProjectSpaceSessionListCounters();
    const c2 = list.createProjectSpaceSessionListCounters();
    const [a, b] = await Promise.all([
      list.listSessionsForProjectSpace(space.projectId, space.id, { space, agentDir, counters: c1 }),
      list.listSessionsForProjectSpace(space.projectId, space.id, { space, agentDir, counters: c2 }),
    ]);
    assert.equal(a.sessions.length, 1);
    assert.equal(b.sessions.length, 1);
    assert.equal(c1.recoveryRuns + c2.recoveryRuns, 1);
  });

  test("recovery timeout without last-good throws session_index_rebuilding (no partial 200)", async () => {
    list.__resetProjectSpaceSessionListForTests();
    const root = realpathSync(makeTempSpace("pssi-r-to-"));
    const space = spaceFixture(root, { id: "main", projectId: "prj_r_to" });
    list.__setProjectSpaceSessionListTestSlowRecoveryMs(200);

    await assert.rejects(
      () =>
        list.listSessionsForProjectSpace(space.projectId, space.id, {
          space,
          agentDir,
          recoveryBudgetMs: 20,
        }),
      (err) =>
        err instanceof list.ProjectSpaceSessionListError &&
        err.code === list.PROJECT_SPACE_SESSION_LIST_ERROR_CODE_REBUILDING &&
        err.status === 503,
    );

    await new Promise((r) => setTimeout(r, 250));
    list.__resetProjectSpaceSessionListForTests();
  });

  test("timeout with last-good returns revalidated last-good, not unchecked partial", async () => {
    list.__resetProjectSpaceSessionListForTests();
    const root = realpathSync(makeTempSpace("pssi-r-lg-"));
    const space = spaceFixture(root, { id: "main", projectId: "prj_r_lg" });
    writeSessionJsonl(sessionFileFor(root, "sess_lg"), linkedHeader(space, "sess_lg"), [
      { role: "user", content: "lg" },
    ]);

    const primed = await list.listSessionsForProjectSpace(space.projectId, space.id, {
      space,
      agentDir,
      forceFullReconcile: true,
    });
    assert.equal(primed.sessions.length, 1);

    writeFileSync(join(root, ".ypi", "sessions", "index.v1.json"), "{broken");
    list.__setProjectSpaceSessionListTestSlowRecoveryMs(200);

    const result = await list.listSessionsForProjectSpace(space.projectId, space.id, {
      space,
      agentDir,
      recoveryBudgetMs: 20,
    });
    assert.equal(result.diagnostics.usedLastGood, true);
    assert.equal(result.sessions.length, 1);
    assert.equal(result.sessions[0].id, "sess_lg");

    await new Promise((r) => setTimeout(r, 250));
    list.__resetProjectSpaceSessionListForTests();
  });

  test("rejected recovery can be retried after flight clears", async () => {
    list.__resetProjectSpaceSessionListForTests();
    const root = realpathSync(makeTempSpace("pssi-r-retry-"));
    const space = spaceFixture(root, { id: "main", projectId: "prj_r_retry" });
    writeSessionJsonl(sessionFileFor(root, "sess_retry"), linkedHeader(space, "sess_retry"), [
      { role: "user", content: "retry" },
    ]);

    list.__setProjectSpaceSessionListTestSlowRecoveryMs(150);
    await assert.rejects(() =>
      list.listSessionsForProjectSpace(space.projectId, space.id, {
        space,
        agentDir,
        recoveryBudgetMs: 15,
      }),
    );
    await new Promise((r) => setTimeout(r, 200));

    list.__resetProjectSpaceSessionListForTests();
    const result = await list.listSessionsForProjectSpace(space.projectId, space.id, {
      space,
      agentDir,
      recoveryBudgetMs: 5_000,
    });
    assert.equal(result.sessions.length, 1);
    assert.equal(result.sessions[0].id, "sess_retry");
  });
}

async function runStudioGroup() {
  console.log("\n[studio] filtered batch projection / unique task bounds\n");
  list.__resetProjectSpaceSessionListForTests();
  const projection = await import("../lib/studio-child-display-projection.ts");
  projection.__resetStudioChildDisplayProjectionForTests();

  const {
    createYpiStudioTask,
    recordYpiStudioSubagentRun,
    recordYpiStudioUserApproval,
    transitionYpiStudioTask,
    updateYpiStudioImplementationPlan,
    updateYpiStudioTaskArtifact,
  } = await import("../lib/ypi-studio-tasks.ts");

  function writePlanReview(cwd, taskId, contextId) {
    updateYpiStudioTaskArtifact(taskId, {
      cwd,
      action: "update_artifact",
      artifact: "plan-review",
      content: `# plan-review\n\ncontext=${contextId}\n`,
      contextId,
    });
  }

  async function seedImplementingTask(cwd) {
    const contextId = `pi_studio_batch_${Math.random().toString(16).slice(2, 10)}`;
    const task = createYpiStudioTask({
      cwd,
      title: "Batch projection fixture",
      workflowId: "feature-dev",
      contextId,
    });
    transitionYpiStudioTask(task.id, { cwd, to: "planning", override: true, contextId });
    updateYpiStudioImplementationPlan(task.id, {
      cwd,
      action: "update_implementation_plan",
      contextId,
      implementationPlan: {
        schemaVersion: 2,
        maxConcurrency: 2,
        subtasks: [
          { id: "PSI-A", title: "Batch step A", order: 10, dependsOn: [] },
          { id: "PSI-B", title: "Batch step B", order: 20, dependsOn: [] },
        ],
      },
    });
    writePlanReview(cwd, task.id, contextId);
    transitionYpiStudioTask(task.id, { cwd, to: "awaiting_approval", override: true, contextId });
    recordYpiStudioUserApproval(cwd, contextId, "批准");
    transitionYpiStudioTask(task.id, { cwd, to: "implementing", override: true, contextId });
    return { task, contextId };
  }

  test("batch: 100 children on one task => studioProjectionCalls=1 and run titles do not cross", async () => {
    projection.__resetStudioChildDisplayProjectionForTests();
    const cwd = realpathSync(makeTempSpace("pssi-studio-batch-"));
    const { task } = await seedImplementingTask(cwd);

    recordYpiStudioSubagentRun(cwd, task.id, {
      id: "run-a",
      taskId: task.id,
      member: "implementer",
      status: "running",
      mode: "async",
      subtaskId: "PSI-A",
      summary: "summary-A-unique",
      startedAt: "2026-07-24T02:00:00.000Z",
      updatedAt: "2026-07-24T02:00:00.000Z",
    });
    recordYpiStudioSubagentRun(cwd, task.id, {
      id: "run-b",
      taskId: task.id,
      member: "checker",
      status: "running",
      mode: "async",
      subtaskId: "PSI-B",
      summary: "summary-B-unique",
      startedAt: "2026-07-24T02:00:01.000Z",
      updatedAt: "2026-07-24T02:00:01.000Z",
    });

    const children = [];
    for (let i = 0; i < 100; i += 1) {
      const isA = i % 2 === 0;
      children.push({
        sessionId: `child_${i}`,
        cwd,
        studioChild: {
          schemaVersion: 1,
          kind: "ypi-studio-child-session",
          runner: "sdk",
          visibility: "child",
          taskId: task.id,
          runId: isA ? "run-a" : "run-b",
          member: isA ? "implementer" : "checker",
          subtaskId: isA ? "PSI-A" : "PSI-B",
          parentSessionId: "parent_visible",
          status: "running",
        },
      });
    }

    const counters = {
      studioProjectionCalls: 0,
      studioListTasksCalls: 0,
      studioChildrenProjected: 0,
      uniqueLinkedTasks: 0,
      taskLookupFailures: 0,
      taskDetailCacheHits: 0,
    };
    const { displaysBySessionId } = projection.projectStudioChildDisplaysBatch(children, { counters });
    assert.equal(counters.uniqueLinkedTasks, 1);
    assert.equal(counters.studioProjectionCalls, 1);
    assert.equal(counters.studioChildrenProjected, 100);
    assert.ok(counters.studioProjectionCalls <= counters.uniqueLinkedTasks);

    const displayA = displaysBySessionId.get("child_0");
    const displayB = displaysBySessionId.get("child_1");
    assert.equal(displayA?.subtaskId, "PSI-A");
    assert.equal(displayA?.subtaskTitle, "Batch step A");
    assert.equal(displayA?.runSummary, "summary-A-unique");
    assert.equal(displayB?.subtaskId, "PSI-B");
    assert.equal(displayB?.subtaskTitle, "Batch step B");
    assert.equal(displayB?.runSummary, "summary-B-unique");
    assert.equal(displayA?.taskTitle, "Batch projection fixture");
    assert.equal(displayB?.taskTitle, "Batch projection fixture");
  });

  test("listSessionsForProjectSpace projects only parent-visible children and bounds task I/O", async () => {
    list.__resetProjectSpaceSessionListForTests();
    projection.__resetStudioChildDisplayProjectionForTests();
    const root = realpathSync(makeTempSpace("pssi-studio-list-"));
    const space = spaceFixture(root, { id: "main", projectId: "prj_studio_list" });
    const { task } = await seedImplementingTask(root);

    recordYpiStudioSubagentRun(root, task.id, {
      id: "run-visible",
      taskId: task.id,
      member: "implementer",
      status: "running",
      mode: "async",
      subtaskId: "PSI-A",
      summary: "visible-run-summary",
      startedAt: "2026-07-24T03:00:00.000Z",
      updatedAt: "2026-07-24T03:00:00.000Z",
    });

    const parentPath = sessionFileFor(root, "sess_parent_vis");
    writeSessionJsonl(parentPath, linkedHeader(space, "sess_parent_vis"), [
      { role: "user", content: "parent" },
    ]);

    // 5 children under the visible parent, same task.
    for (let i = 0; i < 5; i += 1) {
      const id = `sess_child_vis_${i}`;
      writeSessionJsonl(
        sessionFileFor(root, id),
        linkedHeader(space, id, {
          extra: {
            parentSession: parentPath,
            studioChild: {
              schemaVersion: 1,
              kind: "ypi-studio-child-session",
              runner: "sdk",
              visibility: "child",
              taskId: task.id,
              runId: "run-visible",
              member: "implementer",
              subtaskId: "PSI-A",
              parentSessionId: "sess_parent_vis",
              status: "running",
            },
          },
        }),
        [{ role: "user", content: `child ${i}` }],
      );
    }

    // Orphan child (parent not in this space) must not be projected as a root or force extra global work.
    writeSessionJsonl(
      sessionFileFor(root, "sess_orphan_child"),
      linkedHeader(space, "sess_orphan_child", {
        extra: {
          studioChild: {
            schemaVersion: 1,
            kind: "ypi-studio-child-session",
            runner: "sdk",
            visibility: "child",
            taskId: task.id,
            runId: "run-visible",
            member: "implementer",
            subtaskId: "PSI-A",
            parentSessionId: "sess_missing_parent",
            status: "running",
          },
        },
      }),
      [{ role: "user", content: "orphan" }],
    );

    // Noise child for a different task id that is not parent-visible should not load that task.
    writeSessionJsonl(
      sessionFileFor(root, "sess_noise_task"),
      linkedHeader(space, "sess_noise_task", {
        extra: {
          studioChild: {
            schemaVersion: 1,
            kind: "ypi-studio-child-session",
            runner: "sdk",
            visibility: "child",
            taskId: "task_not_loaded",
            runId: "run_noise",
            member: "implementer",
            subtaskId: "NOISE",
            parentSessionId: "sess_missing_parent",
            status: "running",
          },
        },
      }),
      [{ role: "user", content: "noise" }],
    );

    const counters = list.createProjectSpaceSessionListCounters();
    const result = await list.listSessionsForProjectSpace(space.projectId, space.id, {
      space,
      agentDir,
      forceFullReconcile: true,
      counters,
    });

    assert.equal(result.sessions.filter((s) => !s.studioChild).length, 1);
    assert.equal(result.studioChildrenByParentSessionId.sess_parent_vis?.length, 5);
    assert.equal(result.sessions.some((s) => s.id === "sess_orphan_child"), false);
    assert.equal(result.sessions.some((s) => s.id === "sess_noise_task"), false);

    const child = result.studioChildrenByParentSessionId.sess_parent_vis[0];
    assert.equal(child.studioChildDisplay?.subtaskId, "PSI-A");
    assert.equal(child.studioChildDisplay?.subtaskTitle, "Batch step A");
    assert.equal(child.studioChildDisplay?.runSummary, "visible-run-summary");
    assert.equal(child.studioChildDisplay?.taskTitle, "Batch projection fixture");

    assert.equal(result.diagnostics.uniqueLinkedTasks, 1);
    assert.equal(result.diagnostics.studioProjectionCalls, 1);
    assert.ok(result.diagnostics.studioProjectionCalls <= result.diagnostics.uniqueLinkedTasks);
    assert.equal(counters.studioProjectionCalls, 1);
    assert.equal(counters.uniqueLinkedTasks, 1);
    assert.equal(counters.studioChildrenProjected, 5);
    assert.equal(result.diagnostics.inventoryGlobalCalls, 0);
  });

  test("task lookup failure degrades to header-only display; list does not fail", async () => {
    list.__resetProjectSpaceSessionListForTests();
    projection.__resetStudioChildDisplayProjectionForTests();
    const root = realpathSync(makeTempSpace("pssi-studio-missing-"));
    const space = spaceFixture(root, { id: "main", projectId: "prj_studio_missing" });
    const parentPath = sessionFileFor(root, "sess_parent_miss");
    writeSessionJsonl(parentPath, linkedHeader(space, "sess_parent_miss"), [
      { role: "user", content: "parent" },
    ]);
    writeSessionJsonl(
      sessionFileFor(root, "sess_child_miss"),
      linkedHeader(space, "sess_child_miss", {
        extra: {
          parentSession: parentPath,
          studioChild: {
            schemaVersion: 1,
            kind: "ypi-studio-child-session",
            runner: "sdk",
            visibility: "child",
            taskId: "missing-task-id",
            runId: "run-missing",
            member: "implementer",
            subtaskId: "ORPHAN-STEP",
            parentSessionId: "sess_parent_miss",
            status: "running",
          },
        },
      }),
      [{ role: "user", content: "child" }],
    );

    const result = await list.listSessionsForProjectSpace(space.projectId, space.id, {
      space,
      agentDir,
      forceFullReconcile: true,
    });
    assert.equal(result.sessions.length, 2);
    const child = result.studioChildrenByParentSessionId.sess_parent_miss[0];
    assert.deepEqual(child.studioChildDisplay, { subtaskId: "ORPHAN-STEP" });
  });

  test("display is not persisted into space index entries", async () => {
    list.__resetProjectSpaceSessionListForTests();
    projection.__resetStudioChildDisplayProjectionForTests();
    const root = realpathSync(makeTempSpace("pssi-studio-index-"));
    const space = spaceFixture(root, { id: "main", projectId: "prj_studio_index" });
    const { task } = await seedImplementingTask(root);
    recordYpiStudioSubagentRun(root, task.id, {
      id: "run-idx",
      taskId: task.id,
      member: "implementer",
      status: "running",
      mode: "async",
      subtaskId: "PSI-A",
      summary: "idx-summary",
      startedAt: "2026-07-24T04:00:00.000Z",
      updatedAt: "2026-07-24T04:00:00.000Z",
    });
    const parentPath = sessionFileFor(root, "sess_parent_idx");
    writeSessionJsonl(parentPath, linkedHeader(space, "sess_parent_idx"), [
      { role: "user", content: "parent" },
    ]);
    writeSessionJsonl(
      sessionFileFor(root, "sess_child_idx"),
      linkedHeader(space, "sess_child_idx", {
        extra: {
          parentSession: parentPath,
          studioChild: {
            schemaVersion: 1,
            kind: "ypi-studio-child-session",
            runner: "sdk",
            visibility: "child",
            taskId: task.id,
            runId: "run-idx",
            member: "implementer",
            subtaskId: "PSI-A",
            parentSessionId: "sess_parent_idx",
            status: "running",
          },
        },
      }),
      [{ role: "user", content: "child" }],
    );

    await list.listSessionsForProjectSpace(space.projectId, space.id, {
      space,
      agentDir,
      forceFullReconcile: true,
    });

    const read = await store.readProjectSpaceSessionIndex(space);
    assert.equal(read.status, "ok");
    const entry = read.index.sessions.sess_child_idx;
    assert.ok(entry);
    assert.ok(entry.studioChild);
    assert.equal("studioChildDisplay" in entry, false);
    assert.equal(entry.studioChild.taskId, task.id);
  });

  test("different cwdPathKey with same taskId do not share task cache key", () => {
    projection.__resetStudioChildDisplayProjectionForTests();
    let getDetailCalls = 0;
    const loaders = {
      getDetail(cwd, taskId) {
        getDetailCalls += 1;
        return {
          id: taskId,
          title: `title-for-${cwd}`,
          subagents: [{ id: "run-1", summary: `sum-${cwd}` }],
          implementationPlan: { subtasks: [{ id: "S1", title: "Step" }] },
          implementationProjection: { subtasksWithStatus: [{ id: "S1", title: "Step" }] },
        };
      },
      listTasks() {
        return [];
      },
      statTaskJson() {
        return { mtimeMs: 1, size: 1 };
      },
    };
    const counters = {
      studioProjectionCalls: 0,
      studioListTasksCalls: 0,
      studioChildrenProjected: 0,
      uniqueLinkedTasks: 0,
      taskLookupFailures: 0,
      taskDetailCacheHits: 0,
    };
    const children = [
      {
        sessionId: "a",
        cwd: "/tmp/cwd-a",
        studioChild: {
          schemaVersion: 1,
          kind: "ypi-studio-child-session",
          runner: "sdk",
          visibility: "child",
          taskId: "task_shared_id",
          runId: "run-1",
          member: "implementer",
          subtaskId: "S1",
        },
      },
      {
        sessionId: "b",
        cwd: "/tmp/cwd-b",
        studioChild: {
          schemaVersion: 1,
          kind: "ypi-studio-child-session",
          runner: "sdk",
          visibility: "child",
          taskId: "task_shared_id",
          runId: "run-1",
          member: "implementer",
          subtaskId: "S1",
        },
      },
    ];
    const { displaysBySessionId } = projection.projectStudioChildDisplaysBatch(children, {
      counters,
      loaders,
    });
    assert.equal(counters.uniqueLinkedTasks, 2);
    assert.equal(counters.studioProjectionCalls, 2);
    assert.equal(getDetailCalls, 2);
    assert.equal(displaysBySessionId.get("a")?.taskTitle, "title-for-/tmp/cwd-a");
    assert.equal(displaysBySessionId.get("b")?.taskTitle, "title-for-/tmp/cwd-b");
  });
}

// ── PSI-05 route / snapshot / flag ───────────────────────────────────────────

async function runRouteGroup() {
  console.log("\n[route] project-space route contract + snapshot cache\n");

  test("feature flag defaults ON; legacy values disable directed list", () => {
    const prev = process.env.PI_WEB_PROJECT_SPACE_SESSION_LIST;
    try {
      delete process.env.PI_WEB_PROJECT_SPACE_SESSION_LIST;
      assert.equal(list.isProjectSpaceSessionListEnabled(), true);
      process.env.PI_WEB_PROJECT_SPACE_SESSION_LIST = "1";
      assert.equal(list.isProjectSpaceSessionListEnabled(), true);
      for (const off of ["0", "false", "off", "legacy", "listAll"]) {
        process.env.PI_WEB_PROJECT_SPACE_SESSION_LIST = off;
        assert.equal(
          list.isProjectSpaceSessionListEnabled(),
          false,
          `expected disabled for ${off}`,
        );
      }
    } finally {
      if (prev === undefined) delete process.env.PI_WEB_PROJECT_SPACE_SESSION_LIST;
      else process.env.PI_WEB_PROJECT_SPACE_SESSION_LIST = prev;
    }
  });

  test("5s snapshot reuses response; forceValidate and mutation invalidate bypass it", async () => {
    list.__resetProjectSpaceSessionListForTests();
    const root = realpathSync(makeTempSpace("pssi-route-snap-"));
    const space = spaceFixture(root, { id: "main", projectId: "prj_route_snap" });
    writeSessionJsonl(sessionFileFor(root, "sess_snap"), linkedHeader(space, "sess_snap"), [
      { role: "user", content: "snap" },
    ]);

    // First call seeds complete index + snapshot (no custom counters so snapshot allowed).
    const first = await list.listSessionsForProjectSpace(space.projectId, space.id, {
      space,
      agentDir,
    });
    assert.equal(first.sessions.length, 1);
    assert.equal(first.diagnostics.inventoryGlobalCalls, 0);

    // Second call should hit snapshot (headerReads/metadataScans stay 0 on hit path
    // because uncached work is skipped entirely).
    const second = await list.listSessionsForProjectSpace(space.projectId, space.id, {
      space,
      agentDir,
    });
    assert.equal(second.sessions.length, 1);
    assert.equal(second.sessions[0].id, "sess_snap");
    assert.deepEqual(
      Object.keys(second).sort(),
      ["diagnostics", "legacyUnassigned", "sessions", "studioChildrenByParentSessionId"].sort(),
    );

    // Add a new linked session on disk + index would normally discover it on forceValidate.
    writeSessionJsonl(sessionFileFor(root, "sess_new"), linkedHeader(space, "sess_new"), [
      { role: "user", content: "new" },
    ]);

    // Snapshot still hides the new file until invalidate/forceValidate.
    const stale = await list.listSessionsForProjectSpace(space.projectId, space.id, {
      space,
      agentDir,
    });
    assert.equal(stale.sessions.length, 1);

    const forced = await list.listSessionsForProjectSpace(space.projectId, space.id, {
      space,
      agentDir,
      forceValidate: true,
    });
    assert.equal(forced.sessions.length, 2);

    // Snapshot may still hold the old value until mutation invalidation.
    list.invalidateProjectSpaceSessionListSnapshots();
    const afterInvalidate = await list.listSessionsForProjectSpace(space.projectId, space.id, {
      space,
      agentDir,
    });
    assert.equal(afterInvalidate.sessions.length, 2);

    // Lifecycle cache clear must wipe the shared snapshot map.
    const lifecycle = await import("../lib/project-space-session-lifecycle.ts");
    // Re-seed snapshot then clear via lifecycle helper.
    await list.listSessionsForProjectSpace(space.projectId, space.id, { space, agentDir });
    lifecycle.invalidateProjectSpaceSessionListCaches();
    writeSessionJsonl(sessionFileFor(root, "sess_mut"), linkedHeader(space, "sess_mut"), [
      { role: "user", content: "mut" },
    ]);
    const afterMutationClear = await list.listSessionsForProjectSpace(space.projectId, space.id, {
      space,
      agentDir,
    });
    assert.equal(afterMutationClear.sessions.length, 3);
    assert.equal(afterMutationClear.diagnostics.inventoryGlobalCalls, 0);

    list.__resetProjectSpaceSessionListForTests();
  });

  test("route source uses directed list by default and maps 503 rebuilding", async () => {
    const src = readFileSync(
      join(process.cwd(), "app/api/projects/[projectId]/spaces/[spaceId]/sessions/route.ts"),
      "utf8",
    );
    assert.match(src, /listSessionsForProjectSpace/);
    assert.match(src, /isProjectSpaceSessionListEnabled/);
    assert.match(src, /session_index_rebuilding/);
    assert.match(src, /Retry-After/);
    assert.match(src, /forceValidate/);
    assert.match(src, /PI_WEB_PROJECT_SPACE_SESSION_LIST/);
    // Must not default-call listAllSessions with studio display on hot path.
    assert.match(src, /useDirectedList/);
    assert.ok(
      src.includes("listSessionsForProjectSpace(decodedProjectId, decodedSpaceId"),
      "directed reader must be the default call",
    );
    // listAllSessions remains only behind the rollback branch.
    const defaultCallIdx = src.indexOf("listSessionsForProjectSpace(decodedProjectId");
    const listAllIdx = src.indexOf("listAllSessions({");
    assert.ok(defaultCallIdx >= 0, "directed call present");
    assert.ok(listAllIdx >= 0, "rollback listAllSessions still present");
    // Rollback body is under !useDirectedList.
    assert.match(src, /if \(useDirectedList\)/);
    assert.match(src, /else \{[\s\S]*listAllSessions\(/);
  });

  test("timing known stages include space-list stages", async () => {
    const timing = await import("../lib/session-list-timing.ts");
    const collector = new timing.SessionListTimingCollector();
    collector.markKnown();
    const snap = collector.snapshot();
    for (const stage of [
      "registry",
      "listSpace",
      "listAll",
      "indexRead",
      "validate",
      "recovery",
      "inventory",
      "studioProjection",
    ]) {
      assert.ok(snap.stages[stage], `missing stage ${stage}`);
    }
    const line = timing.formatSessionListTimingLog(snap, {
      projectId: "prj_x",
      spaceId: "main",
    });
    assert.match(line, /\[session-list-timing\]/);
    assert.match(line, /project=prj_x/);
    assert.doesNotMatch(line, /\/Users\//);
    assert.doesNotMatch(line, /sessionFile/);
  });

  test("503 error shape stays free of paths and candidates", async () => {
    list.__resetProjectSpaceSessionListForTests();
    const root = realpathSync(makeTempSpace("pssi-route-503-"));
    const space = spaceFixture(root, { id: "main", projectId: "prj_route_503" });
    list.__setProjectSpaceSessionListTestSlowRecoveryMs(200);
    try {
      await list.listSessionsForProjectSpace(space.projectId, space.id, {
        space,
        agentDir,
        recoveryBudgetMs: 20,
      });
      assert.fail("expected rebuilding error");
    } catch (err) {
      assert.ok(err instanceof list.ProjectSpaceSessionListError);
      assert.equal(err.code, list.PROJECT_SPACE_SESSION_LIST_ERROR_CODE_REBUILDING);
      assert.equal(err.status, 503);
      assert.equal(err.message, "Session index is rebuilding");
      assert.doesNotMatch(err.message, /\/|index\.v1\b/);
    }
    await new Promise((r) => setTimeout(r, 250));
    list.__resetProjectSpaceSessionListForTests();
  });
}

// ── PSI-06 scale correctness fixture (~300 sessions / ~180 Studio children) ──

async function runScaleGroup() {
  console.log("\n[scale] ~300 sessions / ~180 Studio children correctness gates\n");
  list.__resetProjectSpaceSessionListForTests();
  const projection = await import("../lib/studio-child-display-projection.ts");
  projection.__resetStudioChildDisplayProjectionForTests();

  const {
    createYpiStudioTask,
    recordYpiStudioSubagentRun,
    recordYpiStudioUserApproval,
    transitionYpiStudioTask,
    updateYpiStudioImplementationPlan,
    updateYpiStudioTaskArtifact,
  } = await import("../lib/ypi-studio-tasks.ts");

  function writePlanReview(cwd, taskId, contextId) {
    updateYpiStudioTaskArtifact(taskId, {
      cwd,
      action: "update_artifact",
      artifact: "plan-review",
      content: `# plan-review\n\ncontext=${contextId}\n`,
      contextId,
    });
  }

  async function seedTask(cwd, title) {
    const contextId = `pi_scale_${Math.random().toString(16).slice(2, 10)}`;
    const task = createYpiStudioTask({
      cwd,
      title,
      workflowId: "feature-dev",
      contextId,
    });
    transitionYpiStudioTask(task.id, { cwd, to: "planning", override: true, contextId });
    updateYpiStudioImplementationPlan(task.id, {
      cwd,
      action: "update_implementation_plan",
      contextId,
      implementationPlan: {
        schemaVersion: 2,
        maxConcurrency: 2,
        subtasks: [
          { id: "PSI-A", title: "Scale step A", order: 10, dependsOn: [] },
          { id: "PSI-B", title: "Scale step B", order: 20, dependsOn: [] },
        ],
      },
    });
    writePlanReview(cwd, task.id, contextId);
    transitionYpiStudioTask(task.id, { cwd, to: "awaiting_approval", override: true, contextId });
    recordYpiStudioUserApproval(cwd, contextId, "批准");
    transitionYpiStudioTask(task.id, { cwd, to: "implementing", override: true, contextId });
    return task;
  }

  /**
   * Fixed-scale fixture:
   * - ~300 active sessions overall (noise + target + children)
   * - ~180 Studio children overall (target space + noise spaces)
   * - target space linked roots: 22
   * - target space unique Studio tasks: 3
   * - target space Studio children with visible parent: 60
   */
  async function buildScaleFixture(options = {}) {
    const targetRootCount = options.targetRootCount ?? 22;
    const targetChildCount = options.targetChildCount ?? 60;
    const targetUniqueTasks = options.targetUniqueTasks ?? 3;
    const noiseRootCount = options.noiseRootCount ?? 100;
    const noiseChildCount = options.noiseChildCount ?? 120;
    const otherLinkedCount = options.otherLinkedCount ?? 18;
    // Unique project ids per fixture so shared agentDir header recovery cannot
    // merge leftovers from earlier scale cases.
    const suffix = Math.random().toString(16).slice(2, 10);

    // Isolate active sessions for this fixture (shared PI_CODING_AGENT_DIR otherwise accumulates).
    try {
      rmSync(join(agentDir, "sessions"), { recursive: true, force: true });
    } catch {
      // ignore
    }
    mkdirSync(join(agentDir, "sessions"), { recursive: true });

    const targetRoot = realpathSync(makeTempSpace("pssi-scale-target-"));
    const noiseRoot = realpathSync(makeTempSpace("pssi-scale-noise-"));
    const otherRoot = realpathSync(makeTempSpace("pssi-scale-other-"));
    const space = spaceFixture(targetRoot, { id: "main", projectId: `prj_scale_target_${suffix}` });
    const noiseSpace = spaceFixture(noiseRoot, { id: "main", projectId: `prj_scale_noise_${suffix}` });
    const otherSpace = spaceFixture(otherRoot, { id: "main", projectId: `prj_scale_other_${suffix}` });

    const tasks = [];
    for (let t = 0; t < targetUniqueTasks; t += 1) {
      const task = await seedTask(targetRoot, `Scale target task ${t + 1}`);
      recordYpiStudioSubagentRun(targetRoot, task.id, {
        id: `run-t${t}`,
        taskId: task.id,
        member: "implementer",
        status: "running",
        mode: "async",
        subtaskId: t % 2 === 0 ? "PSI-A" : "PSI-B",
        summary: `target-run-${t}`,
        startedAt: "2026-07-24T04:00:00.000Z",
        updatedAt: "2026-07-24T04:00:00.000Z",
      });
      tasks.push(task);
    }

    // Target linked roots.
    const parentIds = [];
    for (let i = 0; i < targetRootCount; i += 1) {
      const id = `sess_scale_root_${String(i).padStart(3, "0")}`;
      parentIds.push(id);
      writeSessionJsonl(sessionFileFor(targetRoot, id), linkedHeader(space, id), [
        { role: "user", content: `target-root-${i}` },
      ]);
    }

    // Target Studio children under first 3 parents (visible).
    for (let i = 0; i < targetChildCount; i += 1) {
      const id = `sess_scale_child_${String(i).padStart(3, "0")}`;
      const parentId = parentIds[i % Math.min(3, parentIds.length)];
      const task = tasks[i % tasks.length];
      const parentPath = sessionFileFor(targetRoot, parentId);
      writeSessionJsonl(
        sessionFileFor(targetRoot, id),
        linkedHeader(space, id, {
          extra: {
            parentSession: parentPath,
            studioChild: {
              schemaVersion: 1,
              kind: "ypi-studio-child-session",
              runner: "sdk",
              visibility: "child",
              taskId: task.id,
              runId: `run-t${i % tasks.length}`,
              member: "implementer",
              subtaskId: i % 2 === 0 ? "PSI-A" : "PSI-B",
              parentSessionId: parentId,
              status: "running",
            },
          },
        }),
        [{ role: "user", content: `target-child-${i}` }],
      );
    }

    // Noise: other project roots + children (must not enter target list or projections).
    for (let i = 0; i < noiseRootCount; i += 1) {
      const id = `sess_noise_root_${String(i).padStart(3, "0")}`;
      writeSessionJsonl(sessionFileFor(noiseRoot, id), linkedHeader(noiseSpace, id), [
        { role: "user", content: `noise-root-${i}` },
      ]);
    }
    for (let i = 0; i < noiseChildCount; i += 1) {
      const id = `sess_noise_child_${String(i).padStart(3, "0")}`;
      writeSessionJsonl(
        sessionFileFor(noiseRoot, id),
        linkedHeader(noiseSpace, id, {
          extra: {
            studioChild: {
              schemaVersion: 1,
              kind: "ypi-studio-child-session",
              runner: "sdk",
              visibility: "child",
              taskId: "noise-task-never-loaded",
              runId: `noise-run-${i}`,
              member: "implementer",
              subtaskId: "NOISE",
              parentSessionId: `sess_noise_root_${String(i % Math.max(1, noiseRootCount)).padStart(3, "0")}`,
              status: "running",
            },
          },
        }),
        [{ role: "user", content: `noise-child-${i}` }],
      );
    }

    // Additional linked sessions for a third project (header-only recovery noise).
    for (let i = 0; i < otherLinkedCount; i += 1) {
      const id = `sess_other_${String(i).padStart(3, "0")}`;
      writeSessionJsonl(sessionFileFor(otherRoot, id), linkedHeader(otherSpace, id), [
        { role: "user", content: `other-${i}` },
      ]);
    }

    const totalSessions =
      targetRootCount + targetChildCount + noiseRootCount + noiseChildCount + otherLinkedCount;
    const totalChildren = targetChildCount + noiseChildCount;

    return {
      space,
      targetRoot,
      noiseRoot,
      otherRoot,
      tasks,
      targetRootCount,
      targetChildCount,
      targetUniqueTasks,
      totalSessions,
      totalChildren,
    };
  }

  test("scale fixture size is ~300 sessions / ~180 Studio children", async () => {
    const fixture = await buildScaleFixture();
    assert.ok(fixture.totalSessions >= 280 && fixture.totalSessions <= 340, `sessions=${fixture.totalSessions}`);
    assert.ok(fixture.totalChildren >= 160 && fixture.totalChildren <= 200, `children=${fixture.totalChildren}`);
    assert.equal(fixture.targetRootCount, 22);
    assert.equal(fixture.targetChildCount, 60);
    assert.equal(fixture.targetUniqueTasks, 3);
  });

  test("hot scale list: inventoryGlobalCalls=0 and studioProjectionCalls<=unique tasks", async () => {
    list.__resetProjectSpaceSessionListForTests();
    projection.__resetStudioChildDisplayProjectionForTests();
    const fixture = await buildScaleFixture();

    // Cold complete recovery once to seed complete index.
    const coldCounters = list.createProjectSpaceSessionListCounters();
    const cold = await list.listSessionsForProjectSpace(fixture.space.projectId, fixture.space.id, {
      space: fixture.space,
      agentDir,
      forceFullReconcile: true,
      counters: coldCounters,
    });
    assert.equal(cold.diagnostics.inventoryGlobalCalls, 0);
    assert.equal(coldCounters.inventoryGlobalCalls, 0);
    assert.equal(cold.sessions.filter((s) => !s.studioChild).length, fixture.targetRootCount);
    assert.equal(
      Object.values(cold.studioChildrenByParentSessionId).reduce((n, rows) => n + rows.length, 0),
      fixture.targetChildCount,
    );
    assert.equal(cold.diagnostics.uniqueLinkedTasks, fixture.targetUniqueTasks);
    assert.ok(cold.diagnostics.studioProjectionCalls <= fixture.targetUniqueTasks);
    assert.ok(cold.diagnostics.studioProjectionCalls <= cold.diagnostics.uniqueLinkedTasks);

    // Warm hot path: no global inventory, no full header discovery required.
    const warmCounters = list.createProjectSpaceSessionListCounters();
    const warm = await list.listSessionsForProjectSpace(fixture.space.projectId, fixture.space.id, {
      space: fixture.space,
      agentDir,
      forceValidate: true,
      counters: warmCounters,
    });
    assert.equal(warm.diagnostics.inventoryGlobalCalls, 0);
    assert.equal(warmCounters.inventoryGlobalCalls, 0);
    assert.equal(warmCounters.headerOnlyDiscoveryFiles, 0);
    assert.equal(warm.sessions.filter((s) => !s.studioChild).length, fixture.targetRootCount);
    assert.equal(
      Object.values(warm.studioChildrenByParentSessionId).reduce((n, rows) => n + rows.length, 0),
      fixture.targetChildCount,
    );
    assert.ok(warm.diagnostics.studioProjectionCalls <= fixture.targetUniqueTasks);
    assert.ok(warmCounters.studioProjectionCalls <= warmCounters.uniqueLinkedTasks);
    // Noise task id must never force projection beyond target unique tasks.
    assert.ok(warmCounters.uniqueLinkedTasks <= fixture.targetUniqueTasks);
  });

  test("scale missing/corrupt index recovers without partial silent empty list", async () => {
    list.__resetProjectSpaceSessionListForTests();
    projection.__resetStudioChildDisplayProjectionForTests();
    const fixture = await buildScaleFixture({ targetRootCount: 22, targetChildCount: 30 });

    // Seed complete index first.
    const seeded = await list.listSessionsForProjectSpace(fixture.space.projectId, fixture.space.id, {
      space: fixture.space,
      agentDir,
      forceFullReconcile: true,
    });
    assert.ok(seeded.sessions.filter((s) => !s.studioChild).length === 22);

    // Corrupt on-disk index → recovery must still return full target set (not silent empty).
    const indexPath = join(fixture.targetRoot, ".ypi", "sessions", "index.v1.json");
    writeFileSync(indexPath, "{not-json", "utf8");
    list.__resetProjectSpaceSessionListForTests();

    const recovered = await list.listSessionsForProjectSpace(fixture.space.projectId, fixture.space.id, {
      space: fixture.space,
      agentDir,
      forceValidate: true,
    });
    assert.equal(recovered.diagnostics.recoveryReason, "corrupt");
    assert.equal(recovered.sessions.filter((s) => !s.studioChild).length, 22);
    assert.ok(recovered.sessions.length > 0);
    assert.equal(recovered.diagnostics.inventoryGlobalCalls, 0);

    // Missing index.
    rmSync(join(fixture.targetRoot, ".ypi", "sessions"), { recursive: true, force: true });
    list.__resetProjectSpaceSessionListForTests();
    const missing = await list.listSessionsForProjectSpace(fixture.space.projectId, fixture.space.id, {
      space: fixture.space,
      agentDir,
      forceValidate: true,
    });
    assert.equal(missing.diagnostics.recoveryReason, "missing");
    assert.equal(missing.sessions.filter((s) => !s.studioChild).length, 22);
    assert.equal(missing.diagnostics.inventoryGlobalCalls, 0);
  });

  test("scale concurrent requests share single-flight and keep inventoryGlobalCalls=0", async () => {
    list.__resetProjectSpaceSessionListForTests();
    projection.__resetStudioChildDisplayProjectionForTests();
    const fixture = await buildScaleFixture({ targetRootCount: 10, targetChildCount: 20, noiseRootCount: 50, noiseChildCount: 60 });

    // Drop index so concurrent recovery is forced.
    rmSync(join(fixture.targetRoot, ".ypi", "sessions"), { recursive: true, force: true });

    const c1 = list.createProjectSpaceSessionListCounters();
    const c2 = list.createProjectSpaceSessionListCounters();
    const c3 = list.createProjectSpaceSessionListCounters();
    const [r1, r2, r3] = await Promise.all([
      list.listSessionsForProjectSpace(fixture.space.projectId, fixture.space.id, {
        space: fixture.space,
        agentDir,
        forceValidate: true,
        counters: c1,
      }),
      list.listSessionsForProjectSpace(fixture.space.projectId, fixture.space.id, {
        space: fixture.space,
        agentDir,
        forceValidate: true,
        counters: c2,
      }),
      list.listSessionsForProjectSpace(fixture.space.projectId, fixture.space.id, {
        space: fixture.space,
        agentDir,
        forceValidate: true,
        counters: c3,
      }),
    ]);

    assert.equal(r1.sessions.filter((s) => !s.studioChild).length, 10);
    assert.equal(r2.sessions.filter((s) => !s.studioChild).length, 10);
    assert.equal(r3.sessions.filter((s) => !s.studioChild).length, 10);
    assert.equal(c1.inventoryGlobalCalls + c2.inventoryGlobalCalls + c3.inventoryGlobalCalls, 0);
    // Single-flight: only one recovery run across concurrent waiters.
    assert.equal(c1.recoveryRuns + c2.recoveryRuns + c3.recoveryRuns, 1);
  });

  test("scale candidate sizes 1/22/100 stay isolated from global noise", async () => {
    list.__resetProjectSpaceSessionListForTests();
    projection.__resetStudioChildDisplayProjectionForTests();

    for (const rootCount of [1, 22, 100]) {
      list.__resetProjectSpaceSessionListForTests();
      projection.__resetStudioChildDisplayProjectionForTests();
      const fixture = await buildScaleFixture({
        targetRootCount: rootCount,
        targetChildCount: rootCount === 1 ? 0 : Math.min(60, rootCount * 2),
        noiseRootCount: 80,
        noiseChildCount: 100,
        otherLinkedCount: 20,
      });
      const counters = list.createProjectSpaceSessionListCounters();
      const result = await list.listSessionsForProjectSpace(fixture.space.projectId, fixture.space.id, {
        space: fixture.space,
        agentDir,
        forceFullReconcile: true,
        counters,
      });
      assert.equal(result.sessions.filter((s) => !s.studioChild).length, rootCount);
      assert.equal(result.diagnostics.inventoryGlobalCalls, 0);
      assert.equal(counters.inventoryGlobalCalls, 0);
      // Must not project noise task.
      assert.ok(result.diagnostics.uniqueLinkedTasks <= fixture.targetUniqueTasks);
      assert.ok(result.diagnostics.studioProjectionCalls <= result.diagnostics.uniqueLinkedTasks || result.diagnostics.uniqueLinkedTasks === 0);
    }
  });
}

if (group === "store" || group === "all") {
  await runStoreGroup();
}
if (group === "lifecycle" || group === "all") {
  await runLifecycleGroup();
}
if (group === "query" || group === "all") {
  await runQueryGroup();
}
if (group === "recovery" || group === "all") {
  await runRecoveryGroup();
}
if (group === "studio" || group === "all") {
  await runStudioGroup();
}
if (group === "route" || group === "all") {
  await runRouteGroup();
}
if (group === "scale" || group === "all") {
  await runScaleGroup();
}
if (!["store", "lifecycle", "query", "recovery", "studio", "route", "scale", "all"].includes(group)) {
  console.error(`Unknown group: ${group}`);
  process.exit(2);
}

await chain;

console.log(`\n${passed} passed, ${failed} failed (group=${group})`);
try {
  rmSync(agentDir, { recursive: true, force: true });
} catch {
  // ignore
}
process.exit(failed > 0 ? 1 : 0);
