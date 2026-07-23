#!/usr/bin/env node
/**
 * verify-pi-anyrouter-patch — fail-closed provenance check for pi-anyrouter@0.3.2
 *
 * Exact-pin contract for yolk-pi-web:
 * - dependency / installed package version must be 0.3.2
 * - package source hash must match either the pristine 0.3.2 tarball body
 *   or the version/source-hash-verified minimal compatibility patch
 * - unknown / drifted sources fail closed (never silently continue)
 *
 * Run: node scripts/verify-pi-anyrouter-patch.mjs
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PI_ANYROUTER_PACKAGE = "pi-anyrouter";
export const PI_ANYROUTER_VERSION = "0.3.2";
/** SHA-256 of the pristine npm 0.3.2 index.ts body. */
export const PI_ANYROUTER_UNPATCHED_SHA256 =
  "8c8cc956d84ac285c814e60b07c0ac6447d68d58a78939c926ca0b1d2160288e";
/** SHA-256 of index.ts after patches/pi-anyrouter+0.3.2.patch. */
export const PI_ANYROUTER_PATCHED_SHA256 =
  "991534e4102754849474cfd889a3ae10cb3b2a80cb2d509a662c6f37d8129947";
export const PI_ANYROUTER_PATCH_MARKER =
  "yolk-pi-web compatibility patch: webManaged config, deferred key check, abortable retry";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function resolveIndexPath(pkgJsonPath) {
  const indexPath = join(dirname(pkgJsonPath), "index.ts");
  if (!existsSync(indexPath)) {
    throw new Error(`${PI_ANYROUTER_PACKAGE} index.ts missing at ${indexPath}`);
  }
  return indexPath;
}

export function inspectPiAnyrouterInstall(cwd = root) {
  const localRequire = createRequire(join(cwd, "package.json"));
  let pkgJsonPath;
  try {
    pkgJsonPath = localRequire.resolve(`${PI_ANYROUTER_PACKAGE}/package.json`);
  } catch {
    pkgJsonPath = join(cwd, "node_modules", PI_ANYROUTER_PACKAGE, "package.json");
    if (!existsSync(pkgJsonPath)) {
      throw new Error(`${PI_ANYROUTER_PACKAGE} is not installed (exact ${PI_ANYROUTER_VERSION} required)`);
    }
  }
  const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
  const indexPath = resolveIndexPath(pkgJsonPath);
  const source = readFileSync(indexPath, "utf8");
  const hash = sha256(source);
  let state = "unknown";
  if (hash === PI_ANYROUTER_PATCHED_SHA256) state = "patched";
  else if (hash === PI_ANYROUTER_UNPATCHED_SHA256) state = "unpatched";
  return {
    packageName: PI_ANYROUTER_PACKAGE,
    version: pkg.version,
    pkgJsonPath,
    indexPath,
    hash,
    state,
    hasPatchMarker: source.includes(PI_ANYROUTER_PATCH_MARKER),
    hasWebManaged: source.includes("webManaged"),
    hasAbortableDelay: source.includes("createAbortError") && source.includes("signal.addEventListener(\"abort\""),
    hasSafeError: source.includes("toSafeAnyRouterError"),
    hasDeferredKey: source.includes("requireApiKey"),
  };
}

export function assertPiAnyrouterPatched(cwd = root) {
  const info = inspectPiAnyrouterInstall(cwd);
  assert.strictEqual(
    info.version,
    PI_ANYROUTER_VERSION,
    `installed ${PI_ANYROUTER_PACKAGE} version must be ${PI_ANYROUTER_VERSION}, got ${info.version}`,
  );
  if (info.state === "patched") {
    assert.ok(info.hasPatchMarker, "patched source must include yolk-pi-web marker");
    assert.ok(info.hasWebManaged, "patched source must support webManaged config");
    assert.ok(info.hasAbortableDelay, "patched source must support abortable delay");
    assert.ok(info.hasSafeError, "patched source must project safe final errors");
    assert.ok(info.hasDeferredKey, "patched source must defer apiKey validation at register");
    return info;
  }
  if (info.state === "unpatched") {
    throw new Error(
      `${PI_ANYROUTER_PACKAGE}@${PI_ANYROUTER_VERSION} is installed but the yolk-pi-web compatibility patch is not applied. Run: node scripts/apply-pi-anyrouter-patch.mjs`,
    );
  }
  throw new Error(
    `${PI_ANYROUTER_PACKAGE} source hash mismatch (fail closed). expected patched ${PI_ANYROUTER_PATCHED_SHA256} or pristine ${PI_ANYROUTER_UNPATCHED_SHA256}, got ${info.hash}`,
  );
}

function main() {
  // Also verify package.json / lock metadata when present.
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const dep = packageJson.dependencies?.[PI_ANYROUTER_PACKAGE];
  assert.strictEqual(dep, PI_ANYROUTER_VERSION, `package.json must exact-pin ${PI_ANYROUTER_PACKAGE}@${PI_ANYROUTER_VERSION}`);

  const patchPath = join(root, "patches", `${PI_ANYROUTER_PACKAGE}+${PI_ANYROUTER_VERSION}.patch`);
  assert.ok(existsSync(patchPath), `missing patch file: ${patchPath}`);

  const info = assertPiAnyrouterPatched(root);
  console.log(
    JSON.stringify(
      {
        ok: true,
        package: info.packageName,
        version: info.version,
        state: info.state,
        hash: info.hash,
        indexPath: info.indexPath,
      },
      null,
      2,
    ),
  );
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
