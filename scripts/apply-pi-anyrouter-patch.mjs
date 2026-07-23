#!/usr/bin/env node
/**
 * apply-pi-anyrouter-patch — install-time apply for the verified 0.3.2 patch
 *
 * Fail closed:
 * - missing package: skip with exit 0 only when optional (postinstall soft path)
 * - pristine 0.3.2: apply patches/pi-anyrouter+0.3.2.patch then re-verify
 * - already patched: no-op after hash check
 * - unknown hash / wrong version: non-zero exit (never silent drift)
 *
 * Run: node scripts/apply-pi-anyrouter-patch.mjs
 *      node scripts/apply-pi-anyrouter-patch.mjs --strict
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PI_ANYROUTER_PACKAGE,
  PI_ANYROUTER_VERSION,
  assertPiAnyrouterPatched,
  inspectPiAnyrouterInstall,
} from "./verify-pi-anyrouter-patch.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const strict = process.argv.includes("--strict");

function applyPatchFile() {
  const patchPath = join(root, "patches", `${PI_ANYROUTER_PACKAGE}+${PI_ANYROUTER_VERSION}.patch`);
  if (!existsSync(patchPath)) {
    throw new Error(`patch file missing: ${patchPath}`);
  }
  // Prefer the system `patch` tool (patch-package style unified diff, -p1).
  const result = spawnSync("patch", ["-p1", "--forward", "--batch", "-i", patchPath], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(
      `failed to apply ${PI_ANYROUTER_PACKAGE}@${PI_ANYROUTER_VERSION} patch${detail ? `:\n${detail}` : ""}`,
    );
  }
}

function main() {
  const pkgPath = join(root, "node_modules", PI_ANYROUTER_PACKAGE, "package.json");
  if (!existsSync(pkgPath)) {
    if (strict) {
      throw new Error(`${PI_ANYROUTER_PACKAGE} is not installed (exact ${PI_ANYROUTER_VERSION} required)`);
    }
    console.log(`[apply-pi-anyrouter-patch] skip: ${PI_ANYROUTER_PACKAGE} not installed`);
    return;
  }

  const info = inspectPiAnyrouterInstall(root);
  if (info.version !== PI_ANYROUTER_VERSION) {
    throw new Error(
      `${PI_ANYROUTER_PACKAGE} version mismatch: expected ${PI_ANYROUTER_VERSION}, got ${info.version}`,
    );
  }

  if (info.state === "patched") {
    assertPiAnyrouterPatched(root);
    console.log(`[apply-pi-anyrouter-patch] already patched (${info.hash.slice(0, 12)}…)`);
    return;
  }

  if (info.state === "unpatched") {
    applyPatchFile();
    const after = assertPiAnyrouterPatched(root);
    console.log(`[apply-pi-anyrouter-patch] applied patch (${after.hash.slice(0, 12)}…)`);
    return;
  }

  throw new Error(
    `${PI_ANYROUTER_PACKAGE} source hash mismatch before apply (fail closed): ${info.hash}`,
  );
}

try {
  main();
} catch (err) {
  console.error(`[apply-pi-anyrouter-patch] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
