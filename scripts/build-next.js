#!/usr/bin/env node
"use strict";

/**
 * Build helper for the local Next.js production bundle.
 *
 * Author: lichong <lichong@uino.com>
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawnSync } = require("child_process");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { mkdirSync } = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { join } = require("path");

const projectRoot = join(__dirname, "..");
const buildHome = join(projectRoot, ".next-build-home");

/**
 * Ensures the temporary build home exists.
 *
 * @param {string} dir Temporary home directory used only by the build process.
 */
function ensureBuildHome(dir) {
  mkdirSync(dir, { recursive: true });
}

/**
 * Creates an environment for Next.js build that avoids protected Windows home junctions.
 *
 * @param {NodeJS.ProcessEnv} baseEnv Current process environment.
 * @param {string} homeDir Temporary home directory used by build-only discovery.
 * @returns {NodeJS.ProcessEnv} Environment passed to the build child process.
 */
function createBuildEnv(baseEnv, homeDir) {
  return {
    ...baseEnv,
    HOME: homeDir,
    USERPROFILE: homeDir,
  };
}

ensureBuildHome(buildHome);

const result = spawnSync(
  process.execPath,
  [join(projectRoot, "node_modules", "next", "dist", "bin", "next"), "build", "--webpack"],
  {
    cwd: projectRoot,
    stdio: "inherit",
    env: createBuildEnv(process.env, buildHome),
  }
);

process.exit(result.status ?? 1);
