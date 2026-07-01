#!/usr/bin/env node
"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawn } = require("child_process");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseArgs } = require("util");

const pkgDir = path.join(__dirname, "..");
const nextDir = path.join(pkgDir, ".next");

// Resolve next's CLI entry directly to avoid relying on .bin symlinks (which
// may not exist when installed via npx).
let nextBin;
try {
  nextBin = require.resolve("next/dist/bin/next", { paths: [pkgDir] });
} catch {
  // Fallback: locate next package root and derive the bin path manually.
  try {
    const nextPkg = require.resolve("next/package.json", { paths: [pkgDir] });
    nextBin = path.join(path.dirname(nextPkg), "dist", "bin", "next");
  } catch {
    nextBin = path.join(pkgDir, "node_modules", "next", "dist", "bin", "next");
  }
}

const { values: cliArgs } = parseArgs({
  options: {
    port:         { type: "string", short: "p" },
    hostname:     { type: "string", short: "H" },
    proxy:        { type: "string" },
    "socks-proxy": { type: "string" },
    "no-proxy":  { type: "string" },
  },
  strict: false,
});

const port       = cliArgs.port     ?? process.env.PORT     ?? "30141";
const hostname   = cliArgs.hostname ?? process.env.HOSTNAME ?? null;
const httpProxy  = cliArgs.proxy ?? process.env.PROXY_URL ?? process.env.HTTP_PROXY ?? process.env.http_proxy ?? null;
const socksProxy = cliArgs["socks-proxy"] ?? process.env.SOCKS_PROXY_URL ?? process.env.ALL_PROXY ?? process.env.all_proxy ?? null;
const noProxy    = cliArgs["no-proxy"] ?? process.env.NO_PROXY ?? process.env.no_proxy ?? null;

if (!fs.existsSync(nextDir)) {
  console.error("Build artifacts not found. Please report this issue.");
  process.exit(1);
}

const nextArgs = ["start", "-p", port];
if (hostname) nextArgs.push("-H", hostname);

function appendNodeOption(current, option) {
  const parts = (current ?? "").split(/\s+/).filter(Boolean);
  return parts.includes(option) ? current ?? "" : [...parts, option].join(" ");
}

function createRuntimeEnv(baseEnv) {
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

// Always run next's JS entry with node directly — avoids .bin symlink issues
// and path-with-spaces problems on Windows when shell: true is used.
const child = spawn(process.execPath, [nextBin, ...nextArgs], {
  cwd: pkgDir,
  stdio: ["inherit", "pipe", "inherit"],
  env: createRuntimeEnv(process.env),
});

let browserOpened = false;
const url = `http://${hostname ?? "localhost"}:${port}`;

child.stdout.on("data", (chunk) => {
  const text = chunk.toString();
  process.stdout.write(text);
  if (!browserOpened && text.includes("Ready")) {
    browserOpened = true;
    const isWindows = process.platform === "win32";
    const isMac = process.platform === "darwin";
    const openCmd = isWindows ? "start" : isMac ? "open" : "xdg-open";
    spawn(openCmd, [url], { shell: isWindows, stdio: "ignore", detached: true }).unref();
  }
});

child.on("exit", (code) => process.exit(code ?? 0));
