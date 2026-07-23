"use strict";

// Common server startup helper shared by the `ypi` (Web) and `ypic` (CLI)
// entrypoints. Kept as CommonJS so the published package can execute it
// directly with Node without relying on compiled TypeScript sources.
//
// Responsibilities extracted from bin/pi-web.js:
//   - resolve the next CLI entry
//   - build the proxy-aware runtime env
//   - spawn `next start` with process.execPath (no shell:true)
//   - detect the "Ready" line and emit a ready callback (used by ypi to
//     open the browser; ypic does not self-start a server in the MVP but
//     may reuse the URL/env conventions)
//
// This module MUST NOT import project TypeScript (lib/**). It only depends
// on Node built-ins so it works inside the npm-published package.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawn } = require("child_process");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseArgs } = require("util");

const DEFAULT_PORT = "30141";

// Argument spec shared by ypi/ypic for server connection/startup options.
const SERVER_ARG_SPEC = {
  options: {
    port: { type: "string", short: "p" },
    hostname: { type: "string", short: "H" },
    proxy: { type: "string" },
    "socks-proxy": { type: "string" },
    "no-proxy": { type: "string" },
    // Disable auto browser open after Ready (Docker/headless/server installs).
    "no-open": { type: "boolean", default: false },
  },
  strict: false,
};

/**
 * Parse the shared server options from argv. Returns the raw values object.
 * Callers keep responsibility for applying env fallbacks.
 */
function parseServerArgs(argv) {
  const { values } = parseArgs({ ...SERVER_ARG_SPEC, args: argv });
  return values;
}

/**
 * Resolve the next CLI JS entry without relying on .bin symlinks (which may
 * not exist when installed via npx). Falls back gracefully.
 */
function resolveNextBin(pkgDir) {
  try {
    return require.resolve("next/dist/bin/next", { paths: [pkgDir] });
  } catch {
    try {
      const nextPkg = require.resolve("next/package.json", { paths: [pkgDir] });
      return path.join(path.dirname(nextPkg), "dist", "bin", "next");
    } catch {
      return path.join(pkgDir, "node_modules", "next", "dist", "bin", "next");
    }
  }
}

function appendNodeOption(current, option) {
  const parts = (current ?? "").split(/\s+/).filter(Boolean);
  return parts.includes(option) ? current ?? "" : [...parts, option].join(" ");
}

/**
 * Build the proxy-aware runtime env for the next process. Accepts resolved
 * proxy values (already merged with env by the caller) so this stays pure.
 */
function createRuntimeEnv(baseEnv, { httpProxy, socksProxy, noProxy } = {}) {
  const env = { ...baseEnv };
  if (httpProxy) {
    env.HTTP_PROXY = httpProxy;
    env.HTTPS_PROXY = httpProxy;
    env.http_proxy = httpProxy;
    env.https_proxy = httpProxy;
  }
  if (socksProxy) {
    env.ALL_PROXY = socksProxy;
    env.all_proxy = socksProxy;
  }
  if (noProxy) {
    env.NO_PROXY = noProxy;
    env.no_proxy = noProxy;
  }
  if (httpProxy || socksProxy || noProxy) {
    env.NODE_OPTIONS = appendNodeOption(env.NODE_OPTIONS, "--use-env-proxy");
  }
  return env;
}

/**
 * Decide whether ypi should auto-open a browser after Ready.
 * Explicit `--no-open` / `YPI_NO_OPEN=1` always wins. Headless Linux (no
 * DISPLAY/WAYLAND) and CI default to false so containers do not spawn xdg-open.
 */
function shouldAutoOpenBrowser({ noOpen = false } = {}) {
  if (noOpen === true) return false;
  const envNoOpen = process.env.YPI_NO_OPEN;
  if (envNoOpen === "1" || envNoOpen === "true" || envNoOpen === "yes") return false;
  if (process.env.CI === "true" || process.env.CI === "1") return false;
  if (process.platform === "linux") {
    const hasDisplay = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
    if (!hasDisplay) return false;
  }
  return true;
}

/**
 * Open a URL in the user's default browser. Cross-platform best effort.
 *
 * Never throws and never emits unhandled ChildProcess errors: missing
 * helpers such as `xdg-open` in Alpine/Docker must not crash a Ready server.
 */
function openBrowser(url) {
  if (typeof url !== "string" || !url) return;
  try {
    const isWindows = process.platform === "win32";
    const isMac = process.platform === "darwin";
    const openCmd = isWindows ? "cmd" : isMac ? "open" : "xdg-open";
    const args = isWindows ? ["/c", "start", "", url] : [url];
    const child = spawn(openCmd, args, {
      shell: false,
      stdio: "ignore",
      detached: true,
      windowsHide: true,
    });
    child.on("error", () => {
      // Missing binary (ENOENT) or spawn failures are non-fatal.
    });
    // Detach without keeping the parent alive; ignore if already exited.
    try {
      child.unref();
    } catch {
      // ignore
    }
  } catch {
    // Best-effort only — never fail the caller.
  }
}

/**
 * Start the next server and return the child process.
 *
 * Options:
 *   - pkgDir: package root (contains .next)
 *   - port, hostname: resolved server bind params
 *   - httpProxy, socksProxy, noProxy: resolved proxy values
 *   - openBrowser: boolean (ypi=true); when true opens browser on "Ready"
 *   - onReady: optional callback(url) invoked once on the "Ready" line
 *   - baseEnv: env source for the child (defaults to process.env)
 *
 * The child's stdout is piped so we can detect Ready; stderr is inherited.
 * Callers are responsible for forwarding stdout and handling exit if they
 * need custom behavior (ypi forwards stdout to its own stdout).
 */
/**
 * Next writes the build-machine absolute project path into
 * `.next/required-server-files.{json,js}` as `appDir`. Rewrite it to the
 * current package directory so `ypi` works after npm install on another machine.
 * Relative entries under `files` are unchanged.
 */
function ensurePortableRequiredServerFiles(pkgDir) {
  const targets = [
    path.join(pkgDir, ".next", "required-server-files.json"),
    path.join(pkgDir, ".next", "required-server-files.js"),
  ];
  for (const target of targets) {
    if (!fs.existsSync(target)) continue;
    try {
      if (target.endsWith(".json")) {
        const data = JSON.parse(fs.readFileSync(target, "utf8"));
        if (!data || typeof data !== "object") continue;
        if (data.appDir === pkgDir) continue;
        data.appDir = pkgDir;
        if (typeof data.relativeAppDir !== "string") data.relativeAppDir = "";
        fs.writeFileSync(target, `${JSON.stringify(data)}\n`, "utf8");
        continue;
      }
      // required-server-files.js: self.__SERVER_FILES_MANIFEST={...}
      const raw = fs.readFileSync(target, "utf8");
      const prefix = "self.__SERVER_FILES_MANIFEST=";
      const idx = raw.indexOf(prefix);
      if (idx === -1) continue;
      const jsonText = raw.slice(idx + prefix.length).replace(/;\s*$/, "");
      const data = JSON.parse(jsonText);
      if (!data || typeof data !== "object") continue;
      if (data.appDir === pkgDir) continue;
      data.appDir = pkgDir;
      if (typeof data.relativeAppDir !== "string") data.relativeAppDir = "";
      fs.writeFileSync(target, `${prefix}${JSON.stringify(data)}\n`, "utf8");
    } catch {
      // Best-effort only; Next can still start if appDir is unused for route loading.
    }
  }
}

function startNextServer({
  pkgDir,
  port,
  hostname,
  httpProxy,
  socksProxy,
  noProxy,
  openBrowser: shouldOpenBrowser = false,
  onReady,
  baseEnv = process.env,
}) {
  const nextDir = path.join(pkgDir, ".next");
  if (!fs.existsSync(nextDir)) {
    console.error("Build artifacts not found. Please report this issue.");
    process.exit(1);
  }

  ensurePortableRequiredServerFiles(pkgDir);

  const nextBin = resolveNextBin(pkgDir);
  const nextArgs = ["start", "-p", String(port ?? DEFAULT_PORT)];
  if (hostname) nextArgs.push("-H", hostname);

  const child = spawn(process.execPath, [nextBin, ...nextArgs], {
    cwd: pkgDir,
    stdio: ["inherit", "pipe", "inherit"],
    env: createRuntimeEnv(baseEnv, { httpProxy, socksProxy, noProxy }),
  });

  const url = `http://${hostname ?? "localhost"}:${port ?? DEFAULT_PORT}`;
  let readyFired = false;

  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    process.stdout.write(text);
    if (!readyFired && text.includes("Ready")) {
      readyFired = true;
      if (shouldOpenBrowser) openBrowser(url);
      if (typeof onReady === "function") onReady(url);
    }
  });

  return { child, url };
}

module.exports = {
  DEFAULT_PORT,
  SERVER_ARG_SPEC,
  parseServerArgs,
  resolveNextBin,
  createRuntimeEnv,
  ensurePortableRequiredServerFiles,
  shouldAutoOpenBrowser,
  openBrowser,
  startNextServer,
};
