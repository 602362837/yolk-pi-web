import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { lazyCleanupUploads, persistFileUpload, safeUploadExtension, isStrictPathChild } from "../lib/file-upload-storage.ts";

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "ypi-upload-test-"));
const uploadsRoot = path.join(sandbox, "uploads");
const sentinelPath = path.join(sandbox, "outside-sentinel.txt");
fs.writeFileSync(sentinelPath, "do-not-touch");

function persist(originalName, contents = originalName) {
  return persistFileUpload({ uploadsRoot, originalName, bytes: Buffer.from(contents) });
}

try {
  assert.equal(safeUploadExtension("report.TXT"), ".txt");
  assert.equal(safeUploadExtension("archive.tar.gz"), ".gz");
  assert.equal(safeUploadExtension("bad.中文"), "");
  assert.equal(safeUploadExtension(`bad.${"a".repeat(17)}`), "");
  assert.equal(safeUploadExtension("no-extension"), "");
  assert.equal(isStrictPathChild("/root/a", "/root/a/file"), true);
  assert.equal(isStrictPathChild("/root/a", "/root/a"), false);
  assert.equal(isStrictPathChild("/root/a", "/root/other"), false);

  const hostileNames = [
    "notes.txt",
    "../outside.txt",
    "..\\outside.txt",
    "/tmp/outside.txt",
    "C:\\Windows\\outside.txt",
    "\\\\server\\share\\outside.txt",
    "%2e%2e%2foutside.txt",
    "nul\0name.txt",
    "control\u0001.txt",
    ".",
    "..",
    "",
    "lookalike∕outside.txt",
  ];
  const saved = hostileNames.map((name) => persist(name));
  for (const [index, result] of saved.entries()) {
    assert.equal(path.dirname(result.path), result.uploadDirectory);
    assert.equal(isStrictPathChild(result.uploadDirectory, result.path), true);
    assert.equal(fs.readFileSync(result.path, "utf8"), hostileNames[index]);
    assert.match(path.basename(result.path), /^[0-9a-f-]{36}(?:\.[a-z0-9]{1,16})?$/);
  }
  assert.equal(fs.readFileSync(sentinelPath, "utf8"), "do-not-touch");

  const first = persist("duplicate.txt", "first");
  const second = persist("duplicate.txt", "second");
  assert.notEqual(first.path, second.path);
  assert.equal(fs.readFileSync(first.path, "utf8"), "first");
  assert.equal(fs.readFileSync(second.path, "utf8"), "second");

  if (process.platform !== "win32") {
    assert.equal(fs.statSync(first.uploadDirectory).mode & 0o777, 0o700);
    assert.equal(fs.statSync(first.path).mode & 0o777, 0o600);
  }

  const oldDirectory = path.join(uploadsRoot, crypto.randomUUID());
  fs.mkdirSync(oldDirectory, { mode: 0o700 });
  const oldFile = path.join(oldDirectory, `${crypto.randomUUID()}.txt`);
  fs.writeFileSync(oldFile, "expired", { mode: 0o600 });
  const oldDate = new Date(Date.now() - 10_000);
  fs.utimesSync(oldFile, oldDate, oldDate);

  const linkedDirectory = path.join(uploadsRoot, "linked-directory");
  const outsideDirectory = path.join(sandbox, "outside-directory");
  fs.mkdirSync(outsideDirectory);
  const outsideLinkedFile = path.join(outsideDirectory, "outside.txt");
  fs.writeFileSync(outsideLinkedFile, "outside-directory-sentinel");
  try {
    fs.symlinkSync(outsideDirectory, linkedDirectory, "dir");
    fs.symlinkSync(sentinelPath, path.join(oldDirectory, "linked-file"), "file");
  } catch (error) {
    if (error?.code !== "EPERM") throw error;
  }

  lazyCleanupUploads(uploadsRoot, { retentionMs: 1_000, maxTotalBytes: Number.MAX_SAFE_INTEGER });
  assert.equal(fs.existsSync(oldFile), false);
  assert.equal(fs.readFileSync(sentinelPath, "utf8"), "do-not-touch");
  assert.equal(fs.readFileSync(outsideLinkedFile, "utf8"), "outside-directory-sentinel");

  console.log("file upload storage tests passed");
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}
