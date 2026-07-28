import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const temp = mkdtempSync(join(tmpdir(), "ypi-packed-check-"));
try {
  // This creates the actual publish tarball; no install or registry access occurs.
  const packed = JSON.parse(execFileSync("npm", ["pack", "--json", "--pack-destination", temp], { cwd: projectRoot, encoding: "utf8" }));
  const tarball = join(temp, packed[0].filename);
  assert.equal(existsSync(tarball), true, "npm pack must produce a tarball");
  const consumerRoot = join(temp, "consumer");
  const installedRoot = join(consumerRoot, "node_modules", "@alan-zhao", "yolk-pi-web");
  const unrelatedCwd = join(temp, "unrelated-checker-cwd");
  execFileSync("mkdir", ["-p", join(consumerRoot, "node_modules", "@alan-zhao"), unrelatedCwd]);
  execFileSync("tar", ["-xzf", tarball, "-C", temp]);
  execFileSync("mv", [join(temp, "package"), installedRoot]);

  const required = [
    "lib/worktree-check-cli-extension.ts",
    "lib/worktree-check-extension.ts",
    "lib/worktree-check-execution.ts",
    "lib/worktree-check-policy.ts",
    "lib/git-worktree.ts",
    "scripts/ts-extension-loader.mjs",
  ];
  for (const file of required) assert.equal(existsSync(join(installedRoot, file)), true, `packed package is missing ${file}`);

  // The consumer intentionally gets dependencies through its node_modules tree;
  // all product imports below must still resolve from the packed installed root.
  symlinkSync(join(projectRoot, "node_modules"), join(consumerRoot, "node_modules", "@dependencies"));
  symlinkSync(join(consumerRoot, "node_modules", "@dependencies"), join(installedRoot, "node_modules"));
  const probe = join(temp, "probe-installed-runtime.mjs");
  writeFileSync(probe, [
    'import assert from "node:assert/strict";',
    'import { createRequire } from "node:module";',
    'import { join, resolve } from "node:path";',
    'const root = process.env.INSTALLED_ROOT;',
    'const require = createRequire(join(root, "package.json"));',
    'const { createJiti } = require("jiti");',
    'const jiti = createJiti(join(root, "package.json"), { interopDefault: true });',
    'const policy = jiti(resolve(root, "lib/worktree-check-policy.ts"));',
    'const extension = jiti(resolve(root, "lib/worktree-check-extension.ts"));',
    'const cli = jiti(resolve(root, "lib/worktree-check-cli-extension.ts"));',
    'assert.equal(policy.WORKTREE_CHECK_POLICY_ID, "worktree-check");',
    'assert.equal(extension.worktreeCheckPolicyHandshake(), `${policy.WORKTREE_CHECK_POLICY_ID}@${policy.WORKTREE_CHECK_POLICY_VERSION}`);',
    'assert.equal(typeof cli.default, "function");',
    'for (const modulePath of [import.meta.resolve(resolve(root, "lib/worktree-check-policy.ts")), import.meta.resolve(resolve(root, "lib/worktree-check-extension.ts")), import.meta.resolve(resolve(root, "lib/worktree-check-cli-extension.ts"))]) {',
    '  assert.ok(modulePath.includes(root), `source fallback: ${modulePath}`);',
    '}',
    'console.log("installed-runtime-handshake-ok");',
  ].join("\n"));
  const runtime = execFileSync(process.execPath, [probe], { cwd: unrelatedCwd, env: { ...process.env, INSTALLED_ROOT: installedRoot }, encoding: "utf8" });
  assert.match(runtime, /installed-runtime-handshake-ok/);

  const cli = readFileSync(join(installedRoot, "lib/worktree-check-cli-extension.ts"), "utf8");
  assert.match(cli, /ypi-worktree-check-result-v1/);
  assert.match(cli, /YPI_WORKTREE_CHECK_RESULT_FENCE/);
  assert.doesNotMatch(cli, /process\.cwd\(\)/);
  console.log(`CR24-installed-tarball-runtime-load-handshake passed (${required.length} packed assets; unrelated cwd)`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
