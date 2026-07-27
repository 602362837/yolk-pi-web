/**
 * github-automation-provenance — process/package/build/policy stamps (GHA-CLOSE-04).
 *
 * Kept separate from projection/scheduler/runner to avoid import cycles.
 * Never includes absolute paths, secrets, or package tarball contents.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { GITHUB_UNATTENDED_POLICY_VERSION } from "./github-full-agent-profile";
import { getGithubAutomationProcessEpoch } from "./github-automation-store";
import type {
  GithubAutomationEvaluatedProvenance,
  GithubAutomationRuntimeProvenance,
} from "./github-automation-types";

/** Process start time (module load) — restarts produce a new value. */
const PROCESS_STARTED_AT = new Date().toISOString();

let _cachedPackageVersion: string | null = null;
let _cachedBuildId: string | null = null;
let _cachedCodeRevision: string | null = null;

function readInstalledPackageVersion(): string {
  if (_cachedPackageVersion) return _cachedPackageVersion;
  try {
    const pkgPath = join(process.cwd(), "package.json");
    if (existsSync(pkgPath)) {
      const raw = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: unknown };
      if (typeof raw.version === "string" && raw.version.trim()) {
        _cachedPackageVersion = raw.version.trim().slice(0, 64);
        return _cachedPackageVersion;
      }
    }
  } catch {
    // fall through
  }
  _cachedPackageVersion = "unknown";
  return _cachedPackageVersion;
}

function readNextBuildId(): string {
  if (_cachedBuildId) return _cachedBuildId;
  const fromEnv =
    (typeof process.env.YPI_BUILD_ID === "string" && process.env.YPI_BUILD_ID.trim()) ||
    (typeof process.env.NEXT_BUILD_ID === "string" && process.env.NEXT_BUILD_ID.trim()) ||
    "";
  if (fromEnv) {
    _cachedBuildId = fromEnv.slice(0, 80);
    return _cachedBuildId;
  }
  try {
    const buildIdPath = join(process.cwd(), ".next", "BUILD_ID");
    if (existsSync(buildIdPath)) {
      const id = readFileSync(buildIdPath, "utf8").trim();
      if (id) {
        _cachedBuildId = id.slice(0, 80);
        return _cachedBuildId;
      }
    }
  } catch {
    // fall through
  }
  _cachedBuildId = "dev";
  return _cachedBuildId;
}

/**
 * Opaque code revision for comparing runtime vs evaluated blocks.
 * Combines package version + build id (+ optional SOURCE_VERSION/GITHUB_SHA).
 */
export function getGithubAutomationCodeRevision(): string {
  if (_cachedCodeRevision) return _cachedCodeRevision;
  const pkg = readInstalledPackageVersion();
  const buildId = readNextBuildId();
  const source =
    (typeof process.env.SOURCE_VERSION === "string" && process.env.SOURCE_VERSION.trim()) ||
    (typeof process.env.GITHUB_SHA === "string" && process.env.GITHUB_SHA.trim()) ||
    "";
  const sourceShort = source ? source.slice(0, 12) : "";
  const material = sourceShort
    ? `${pkg}/${buildId}/${sourceShort}`
    : `${pkg}/${buildId}`;
  const digest = createHash("sha256").update(material).digest("hex").slice(0, 10);
  _cachedCodeRevision = `${material}#${digest}`.slice(0, 120);
  return _cachedCodeRevision;
}

/** Safe runtime provenance for status wire + block evaluation stamps. */
export function getGithubAutomationRuntimeProvenance(): GithubAutomationRuntimeProvenance {
  return {
    packageVersion: readInstalledPackageVersion(),
    buildId: readNextBuildId(),
    codeRevision: getGithubAutomationCodeRevision(),
    processEpoch: getGithubAutomationProcessEpoch(),
    processStartedAt: PROCESS_STARTED_AT,
    policyVersion: GITHUB_UNATTENDED_POLICY_VERSION,
  };
}

/** Snapshot used when recording a durable block/decision. */
export function getGithubAutomationEvaluatedProvenance(): GithubAutomationEvaluatedProvenance {
  return {
    codeRevision: getGithubAutomationCodeRevision(),
    policyVersion: GITHUB_UNATTENDED_POLICY_VERSION,
  };
}

/** Test helper: clear provenance caches between cases. */
export function _testResetGithubAutomationRuntimeProvenanceCache(): void {
  _cachedPackageVersion = null;
  _cachedBuildId = null;
  _cachedCodeRevision = null;
}
