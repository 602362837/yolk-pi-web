#!/usr/bin/env node
"use strict";

// `ypi` — Web workspace entrypoint.
//
// Starts the bundled Next server and, on Ready, opens the user's browser.
// The server startup/proxy/spawn logic lives in bin/server-runner.js so it
// can be shared with `ypic` without duplicating the cross-platform spawn
// strategy. Behavior of `ypi` is intentionally unchanged by the refactor.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const serverRunner = require("./server-runner");
const { parseServerArgs, startNextServer } = serverRunner;

const pkgDir = path.join(__dirname, "..");

const cliArgs = parseServerArgs(process.argv.slice(2));

const port       = cliArgs.port     ?? process.env.PORT     ?? "30141";
const hostname   = cliArgs.hostname ?? process.env.HOSTNAME ?? null;
const httpProxy  = cliArgs.proxy ?? process.env.PROXY_URL ?? process.env.HTTP_PROXY ?? process.env.http_proxy ?? null;
const socksProxy = cliArgs["socks-proxy"] ?? process.env.SOCKS_PROXY_URL ?? process.env.ALL_PROXY ?? process.env.all_proxy ?? null;
const noProxy    = cliArgs["no-proxy"] ?? process.env.NO_PROXY ?? process.env.no_proxy ?? null;

const { child } = startNextServer({
  pkgDir,
  port,
  hostname,
  httpProxy,
  socksProxy,
  noProxy,
  openBrowser: true,
});

child.on("exit", (code) => process.exit(code ?? 0));
