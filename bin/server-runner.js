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
 * Open a URL in the user's default browser. Cross-platform best effort.
 */
function openBrowser(url) {
  const isWindows = process.platform === "win32";
  const isMac = process.platform === "darwin";
  const openCmd = isWindows ? "start" : isMac ? "open" : "xdg-open";
  spawn(openCmd, [url], { shell: isWindows, stdio: "ignore", detached: true }).unref();
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
  openBrowser,
  startNextServer,
};
