import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeSessionHeader } from "../lib/ypi-studio-child-session-header.ts";
import { parseSessionHeaderMetadata } from "../lib/session-header-metadata.ts";
import { studioChildSessionTitle } from "../lib/session-title.ts";

const now = "2026-07-07T00:00:00.000Z";
const root = mkdtempSync(join(tmpdir(), "ypi-studio-sdk-runner-"));

try {
  const childSessionFile = join(root, "sessions", "encoded-cwd", "child.jsonl");
  assert.equal(existsSync(childSessionFile), false, "precondition: child JSONL should not exist before header write");

  const header = writeSessionHeader(
    childSessionFile,
    {
      projectId: "project-1",
      spaceId: "main",
      studioChild: {
        schemaVersion: 1,
        kind: "ypi-studio-child-session",
        runner: "sdk",
        visibility: "child",
        status: "running",
        parentSessionId: "parent-session",
        parentSessionFile: "/tmp/parent.jsonl",
        contextId: "pi_parent-session",
        taskId: "task-1",
        runId: "run-1",
        member: "checker",
        subtaskId: "sdk-runner-validation-docs",
        createdAt: now,
      },
    },
    {
      type: "session",
      version: 3,
      id: "child-session",
      timestamp: now,
      cwd: root,
      parentSession: "/tmp/parent.jsonl",
    },
  );

  assert.ok(header, "writeSessionHeader should return the created session header");
  assert.equal(existsSync(childSessionFile), true, "missing child JSONL should be created");
  assert.equal(header?.studioChild?.kind, "ypi-studio-child-session");
  assert.equal(header?.studioChild?.runner, "sdk");
  assert.equal(header?.studioChild?.parentSessionId, "parent-session");
  assert.equal(header?.projectId, "project-1");
  assert.equal(header?.spaceId, "main");

  const firstLine = readFileSync(childSessionFile, "utf8").split("\n")[0];
  const metadata = parseSessionHeaderMetadata(firstLine);
  assert.equal(metadata.projectLink.projectId, "project-1");
  assert.equal(metadata.projectLink.spaceId, "main");
  assert.equal(metadata.studioChild?.taskId, "task-1");
  assert.equal(metadata.studioChild?.runId, "run-1");
  assert.equal(metadata.studioChild?.member, "checker");
  assert.equal(metadata.studioChild?.subtaskId, "sdk-runner-validation-docs");

  // Durable session_info names share the pure title helper used by sidebar projection.
  assert.equal(
    studioChildSessionTitle({
      subtaskId: metadata.studioChild?.subtaskId,
      subtaskTitle: "Validate header docs",
      member: metadata.studioChild?.member,
      taskTitle: "SDK runner task",
      taskId: metadata.studioChild?.taskId,
    }),
    "sdk-runner-validation-docs · Validate header docs",
  );
  assert.equal(
    studioChildSessionTitle({
      member: "architect",
      taskTitle: "SDK runner task",
      taskId: metadata.studioChild?.taskId,
    }),
    "architect · SDK runner task",
  );

  const mergedHeader = writeSessionHeader(childSessionFile, {
    studioChild: { ...header.studioChild, status: "succeeded", finishedAt: now, terminationReason: "done" },
  });
  assert.equal(mergedHeader?.studioChild?.status, "succeeded");
  assert.equal(JSON.parse(readFileSync(childSessionFile, "utf8").split("\n")[0]).studioChild?.terminationReason, "done");
  assert.match(readFileSync(childSessionFile, "utf8"), /\n$/u, "header-only JSONL remains newline-terminated");
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("ypi-studio SDK runner header tests passed");
