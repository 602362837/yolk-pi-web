/**
 * github-issue-analysis-evidence — contained read-only repository evidence controller (GIA-02).
 *
 * Application-layer containment (not an OS sandbox):
 * - Root is a caller-validated Project Registry canonical path only.
 * - Model-supplied paths are relative; absolute / URL / `..` / NUL / backslash escapes are rejected.
 * - Every access uses lstat before open; symlinks are rejected; realpath must stay under root.
 * - Only ordinary text files are readable; secret-like basenames and excluded dirs are denied.
 * - Budgets are server-owned; Issue text cannot raise them.
 * - Errors never include absolute paths or raw Node fs messages.
 */

import { createHash, randomBytes } from "node:crypto";
import { type Dirent } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";

import {
  ISSUE_ANALYSIS_LIMITS,
  type IssueAnalysisBudgetSnapshot,
  type IssueAnalysisLedgerEntry,
  type IssueAnalysisReasonCode,
  type IssueAnalysisToolResult,
  type IssueAnalysisBoundedClaim,
  type IssueAnalysisClaimInput,
  sanitizeAnalysisProse,
} from "./github-issue-analysis-types";

// ─── Exclusion rules ─────────────────────────────────────────────────────────

const EXCLUDED_DIR_NAMES = new Set([
  ".git",
  ".ypi",
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
  "vendor",
  ".cache",
  ".turbo",
  ".parcel-cache",
  "tmp",
  "temp",
  ".venv",
  "venv",
  "__pycache__",
  ".tox",
  ".mypy_cache",
  ".pytest_cache",
  ".idea",
  ".vscode",
  ".DS_Store",
]);

const SECRET_BASENAME_EXACT = new Set([
  "auth.json",
  "credentials.json",
  "credentials.v1.json",
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  ".npmrc",
  ".pypirc",
  "netrc",
  ".netrc",
  "cookies",
  "cookies.txt",
]);

const SECRET_BASENAME_PATTERNS: RegExp[] = [
  /^\.env(\..+)?$/i,
  /.*secret.*/i,
  /.*token.*/i,
  /.*credential.*/i,
  /.*private[-_]?key.*/i,
  /.*\.(pem|key|p12|pfx|crt|cer|der)$/i,
  /.*\.(keystore|jks)$/i,
];

// ─── Public controller ───────────────────────────────────────────────────────

export interface IssueAnalysisEvidenceControllerOptions {
  /** Canonical project root from Project Registry (already realpath'd by caller). */
  projectRoot: string;
  /** Optional override of total deadline (tests). Capped by LIMITS. */
  totalDurationMs?: number;
  /** Clock injection for tests. */
  now?: () => number;
}

export class IssueAnalysisEvidenceController {
  private readonly rootReal: string;
  private readonly startedAtMs: number;
  private readonly deadlineAtMs: number;
  private readonly now: () => number;

  private operationsUsed = 0;
  private filesRead = 0;
  private bytesRead = 0;
  private exhausted = false;
  private exhaustReason: IssueAnalysisReasonCode | null = null;

  private readonly ledger = new Map<string, IssueAnalysisLedgerEntry>();
  private evidenceSeq = 0;

  private constructor(
    rootReal: string,
    startedAtMs: number,
    deadlineAtMs: number,
    now: () => number,
  ) {
    this.rootReal = rootReal;
    this.startedAtMs = startedAtMs;
    this.deadlineAtMs = deadlineAtMs;
    this.now = now;
  }

  /**
   * Open a controller after verifying the project root is a real, non-symlink directory.
   * Callers must pass a Project Registry-derived canonical path only.
   */
  static async open(
    options: IssueAnalysisEvidenceControllerOptions,
  ): Promise<IssueAnalysisEvidenceController | { reasonCode: IssueAnalysisReasonCode }> {
    const now = options.now ?? (() => Date.now());
    const startedAtMs = now();
    const duration = Math.min(
      options.totalDurationMs ?? ISSUE_ANALYSIS_LIMITS.totalDurationMs,
      ISSUE_ANALYSIS_LIMITS.totalDurationMs,
    );
    const deadlineAtMs = startedAtMs + Math.max(1, duration);

    const rawRoot = typeof options.projectRoot === "string" ? options.projectRoot.trim() : "";
    if (!rawRoot || rawRoot.includes("\0")) {
      return { reasonCode: "project_root_unavailable" };
    }

    try {
      const rootStat = await lstat(rawRoot);
      if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
        return { reasonCode: "project_root_unavailable" };
      }
      const rootReal = await realpath(rawRoot);
      // Re-check realpath target is still a directory (race-narrow).
      const realStat = await lstat(rootReal);
      if (realStat.isSymbolicLink() || !realStat.isDirectory()) {
        return { reasonCode: "project_root_unavailable" };
      }
      return new IssueAnalysisEvidenceController(rootReal, startedAtMs, deadlineAtMs, now);
    } catch {
      return { reasonCode: "project_root_unavailable" };
    }
  }

  getBudgetSnapshot(): IssueAnalysisBudgetSnapshot {
    const remainingMs = Math.max(0, this.deadlineAtMs - this.now());
    return {
      operationsUsed: this.operationsUsed,
      operationsRemaining: Math.max(
        0,
        ISSUE_ANALYSIS_LIMITS.maxEvidenceOperations - this.operationsUsed,
      ),
      filesRead: this.filesRead,
      filesRemaining: Math.max(0, ISSUE_ANALYSIS_LIMITS.maxFilesRead - this.filesRead),
      bytesRead: this.bytesRead,
      bytesRemaining: Math.max(0, ISSUE_ANALYSIS_LIMITS.maxTotalReadBytes - this.bytesRead),
      deadlineRemainingMs: remainingMs,
      exhausted: this.exhausted || remainingMs <= 0,
    };
  }

  isBudgetExhausted(): boolean {
    return this.getBudgetSnapshot().exhausted;
  }

  getExhaustReason(): IssueAnalysisReasonCode | null {
    if (this.exhaustReason) return this.exhaustReason;
    if (this.deadlineAtMs - this.now() <= 0) return "deadline_exceeded";
    return null;
  }

  getLedgerSnapshot(): ReadonlyMap<string, IssueAnalysisLedgerEntry> {
    return new Map(this.ledger);
  }

  getLedgerEntry(evidenceId: string): IssueAnalysisLedgerEntry | undefined {
    return this.ledger.get(evidenceId);
  }

  /** Execute one validated model action (list/find/grep/read). */
  async execute(
    action:
      | { action: "list"; path: string }
      | { action: "find"; path: string; pattern: string }
      | { action: "grep"; path: string; pattern: string; maxHits?: number }
      | { action: "read"; path: string; lineStart?: number; lineEnd?: number },
  ): Promise<IssueAnalysisToolResult> {
    const budgetGate = this.beginOperation();
    if (budgetGate) {
      return {
        ok: false,
        action: action.action,
        reasonCode: budgetGate,
        budget: this.getBudgetSnapshot(),
      };
    }

    try {
      switch (action.action) {
        case "list":
          return await this.list(action.path);
        case "find":
          return await this.find(action.path, action.pattern);
        case "grep":
          return await this.grep(action.path, action.pattern, action.maxHits);
        case "read":
          return await this.read(action.path, action.lineStart, action.lineEnd);
        default: {
          const _exhaustive: never = action;
          void _exhaustive;
          return {
            ok: false,
            action: "unknown",
            reasonCode: "unknown_action",
            budget: this.getBudgetSnapshot(),
          };
        }
      }
    } catch {
      return {
        ok: false,
        action: action.action,
        reasonCode: "path_rejected",
        budget: this.getBudgetSnapshot(),
      };
    }
  }

  // ── operations ─────────────────────────────────────────────────────────────

  private async list(relativePath: string): Promise<IssueAnalysisToolResult> {
    const resolved = await this.resolveContainedPath(relativePath, { allowDirectory: true });
    if (!resolved.ok) {
      return {
        ok: false,
        action: "list",
        reasonCode: resolved.reasonCode,
        budget: this.getBudgetSnapshot(),
      };
    }
    if (resolved.kind !== "directory") {
      return {
        ok: false,
        action: "list",
        reasonCode: "path_rejected",
        budget: this.getBudgetSnapshot(),
      };
    }

    let dirents: Dirent[];
    try {
      dirents = await readdir(resolved.absolutePath, { withFileTypes: true });
    } catch {
      return {
        ok: false,
        action: "list",
        reasonCode: "path_rejected",
        budget: this.getBudgetSnapshot(),
      };
    }

    const names: string[] = [];
    for (const dirent of dirents) {
      if (names.length >= ISSUE_ANALYSIS_LIMITS.maxEnumerationEntries) break;
      const name = dirent.name;
      if (!name || name === "." || name === "..") continue;
      if (name.includes("\0")) continue;
      if (dirent.isSymbolicLink()) continue;
      if (dirent.isDirectory()) {
        if (isExcludedDirName(name)) continue;
        names.push(`${name}/`);
        continue;
      }
      if (dirent.isFile()) {
        if (isSecretLikeBasename(name)) continue;
        names.push(name);
      }
    }
    names.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const capped = names.length >= ISSUE_ANALYSIS_LIMITS.maxEnumerationEntries;

    return {
      ok: true,
      action: "list",
      path: resolved.relativePath,
      entries: names,
      capped,
      budget: this.getBudgetSnapshot(),
    };
  }

  private async find(
    relativePath: string,
    pattern: string,
  ): Promise<IssueAnalysisToolResult> {
    const resolved = await this.resolveContainedPath(relativePath, { allowDirectory: true });
    if (!resolved.ok) {
      return {
        ok: false,
        action: "find",
        reasonCode: resolved.reasonCode,
        budget: this.getBudgetSnapshot(),
      };
    }
    if (resolved.kind !== "directory" && resolved.kind !== "file") {
      return {
        ok: false,
        action: "find",
        reasonCode: "path_rejected",
        budget: this.getBudgetSnapshot(),
      };
    }

    const matcher = compileFindPattern(pattern);
    if (!matcher) {
      return {
        ok: false,
        action: "find",
        reasonCode: "schema_invalid",
        budget: this.getBudgetSnapshot(),
      };
    }

    const entries: string[] = [];
    let capped = false;

    if (resolved.kind === "file") {
      const base = path.posix.basename(resolved.relativePath);
      if (matcher(base) && !isSecretLikeBasename(base)) {
        entries.push(resolved.relativePath);
      }
    } else {
      const walkResult = await this.walkFiles(resolved.absolutePath, resolved.relativePath, {
        maxEntries: ISSUE_ANALYSIS_LIMITS.maxEnumerationEntries,
        onFile: (rel) => {
          const base = path.posix.basename(rel);
          return matcher(base) && !isSecretLikeBasename(base);
        },
      });
      entries.push(...walkResult.entries);
      capped = walkResult.capped;
    }

    entries.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

    return {
      ok: true,
      action: "find",
      path: resolved.relativePath,
      entries,
      capped,
      budget: this.getBudgetSnapshot(),
    };
  }

  private async grep(
    relativePath: string,
    pattern: string,
    maxHits?: number,
  ): Promise<IssueAnalysisToolResult> {
    const resolved = await this.resolveContainedPath(relativePath, {
      allowDirectory: true,
      allowFile: true,
    });
    if (!resolved.ok) {
      return {
        ok: false,
        action: "grep",
        reasonCode: resolved.reasonCode,
        budget: this.getBudgetSnapshot(),
      };
    }

    const regex = compileGrepPattern(pattern);
    if (!regex) {
      return {
        ok: false,
        action: "grep",
        reasonCode: "schema_invalid",
        budget: this.getBudgetSnapshot(),
      };
    }

    const hitLimit = Math.min(
      maxHits ?? ISSUE_ANALYSIS_LIMITS.maxGrepHits,
      ISSUE_ANALYSIS_LIMITS.maxGrepHits,
    );
    const hits: Array<{
      evidenceId: string;
      relativePath: string;
      lineStart: number;
      lineEnd: number;
      preview: string;
    }> = [];
    let textBytes = 0;
    let capped = false;

    const files: Array<{ absolutePath: string; relativePath: string }> = [];
    if (resolved.kind === "file") {
      files.push({
        absolutePath: resolved.absolutePath,
        relativePath: resolved.relativePath,
      });
    } else if (resolved.kind === "directory") {
      const walk = await this.walkFiles(resolved.absolutePath, resolved.relativePath, {
        maxEntries: ISSUE_ANALYSIS_LIMITS.maxEnumerationEntries,
        onFile: (rel) => !isSecretLikeBasename(path.posix.basename(rel)),
      });
      for (const rel of walk.entries) {
        const abs = path.join(this.rootReal, ...rel.split("/"));
        files.push({ absolutePath: abs, relativePath: rel });
      }
      if (walk.capped) capped = true;
    }

    for (const file of files) {
      if (hits.length >= hitLimit || textBytes >= ISSUE_ANALYSIS_LIMITS.maxGrepTextBytes) {
        capped = true;
        break;
      }
      if (this.deadlineAtMs - this.now() <= 0) {
        this.markExhausted("deadline_exceeded");
        capped = true;
        break;
      }

      const content = await this.readTextFileBounded(file.absolutePath);
      if (!content.ok) continue;

      const lines = content.text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (hits.length >= hitLimit || textBytes >= ISSUE_ANALYSIS_LIMITS.maxGrepTextBytes) {
          capped = true;
          break;
        }
        const line = lines[i] ?? "";
        if (!regex.test(line)) continue;
        // Reset lastIndex for global-less safety; patterns are non-global.
        regex.lastIndex = 0;

        const preview = sanitizePreview(line, 200);
        const previewBytes = Buffer.byteLength(preview, "utf8");
        if (textBytes + previewBytes > ISSUE_ANALYSIS_LIMITS.maxGrepTextBytes) {
          capped = true;
          break;
        }

        const lineNo = i + 1;
        const evidenceId = this.allocateEvidenceId();
        const contentHash = sha256Hex(`${file.relativePath}:${lineNo}:${preview}`);
        this.ledger.set(evidenceId, {
          evidenceId,
          relativePath: file.relativePath,
          lineStart: lineNo,
          lineEnd: lineNo,
          contentHash,
          bytes: previewBytes,
          operation: "grep",
          observedAtMs: this.now(),
        });
        hits.push({
          evidenceId,
          relativePath: file.relativePath,
          lineStart: lineNo,
          lineEnd: lineNo,
          preview,
        });
        textBytes += previewBytes;
      }
    }

    return {
      ok: true,
      action: "grep",
      path: resolved.relativePath,
      hits,
      capped,
      budget: this.getBudgetSnapshot(),
    };
  }

  private async read(
    relativePath: string,
    lineStart?: number,
    lineEnd?: number,
  ): Promise<IssueAnalysisToolResult> {
    if (this.filesRead >= ISSUE_ANALYSIS_LIMITS.maxFilesRead) {
      this.markExhausted("read_budget_exceeded");
      return {
        ok: false,
        action: "read",
        reasonCode: "read_budget_exceeded",
        budget: this.getBudgetSnapshot(),
      };
    }
    if (this.bytesRead >= ISSUE_ANALYSIS_LIMITS.maxTotalReadBytes) {
      this.markExhausted("read_budget_exceeded");
      return {
        ok: false,
        action: "read",
        reasonCode: "read_budget_exceeded",
        budget: this.getBudgetSnapshot(),
      };
    }

    const resolved = await this.resolveContainedPath(relativePath, {
      allowFile: true,
      allowDirectory: false,
    });
    if (!resolved.ok) {
      return {
        ok: false,
        action: "read",
        reasonCode: resolved.reasonCode,
        budget: this.getBudgetSnapshot(),
      };
    }
    if (resolved.kind !== "file") {
      return {
        ok: false,
        action: "read",
        reasonCode: "path_rejected",
        budget: this.getBudgetSnapshot(),
      };
    }

    if (isSecretLikeBasename(path.posix.basename(resolved.relativePath))) {
      return {
        ok: false,
        action: "read",
        reasonCode: "secret_like_rejected",
        budget: this.getBudgetSnapshot(),
      };
    }

    if (resolved.size > ISSUE_ANALYSIS_LIMITS.maxFileBytes) {
      return {
        ok: false,
        action: "read",
        reasonCode: "file_too_large",
        budget: this.getBudgetSnapshot(),
      };
    }

    const remainingBytes =
      ISSUE_ANALYSIS_LIMITS.maxTotalReadBytes - this.bytesRead;
    if (resolved.size > remainingBytes) {
      this.markExhausted("read_budget_exceeded");
      return {
        ok: false,
        action: "read",
        reasonCode: "read_budget_exceeded",
        budget: this.getBudgetSnapshot(),
      };
    }

    const content = await this.readTextFileBounded(resolved.absolutePath, resolved.size);
    if (!content.ok) {
      return {
        ok: false,
        action: "read",
        reasonCode: content.reasonCode,
        budget: this.getBudgetSnapshot(),
      };
    }

    const allLines = content.text.split(/\r?\n/);
    const start = lineStart ?? 1;
    const end = lineEnd ?? allLines.length;
    if (start < 1 || end < start) {
      return {
        ok: false,
        action: "read",
        reasonCode: "schema_invalid",
        budget: this.getBudgetSnapshot(),
      };
    }
    const slice = allLines.slice(start - 1, end);
    const text = slice.join("\n");
    const bytes = Buffer.byteLength(text, "utf8");
    if (bytes > ISSUE_ANALYSIS_LIMITS.maxFileBytes) {
      return {
        ok: false,
        action: "read",
        reasonCode: "file_too_large",
        budget: this.getBudgetSnapshot(),
      };
    }
    if (this.bytesRead + bytes > ISSUE_ANALYSIS_LIMITS.maxTotalReadBytes) {
      this.markExhausted("read_budget_exceeded");
      return {
        ok: false,
        action: "read",
        reasonCode: "read_budget_exceeded",
        budget: this.getBudgetSnapshot(),
      };
    }

    this.filesRead += 1;
    this.bytesRead += bytes;

    const evidenceId = this.allocateEvidenceId();
    const contentHash = sha256Hex(text);
    const effectiveEnd = Math.min(end, start + Math.max(slice.length, 1) - 1);
    this.ledger.set(evidenceId, {
      evidenceId,
      relativePath: resolved.relativePath,
      lineStart: start,
      lineEnd: effectiveEnd,
      contentHash,
      bytes,
      operation: "read",
      observedAtMs: this.now(),
    });

    return {
      ok: true,
      action: "read",
      evidenceId,
      relativePath: resolved.relativePath,
      lineStart: start,
      lineEnd: effectiveEnd,
      content: text,
      budget: this.getBudgetSnapshot(),
    };
  }

  // ── path resolution ────────────────────────────────────────────────────────

  private async resolveContainedPath(
    relativePath: string,
    opts: { allowDirectory?: boolean; allowFile?: boolean },
  ): Promise<
    | {
        ok: true;
        kind: "file" | "directory";
        absolutePath: string;
        relativePath: string;
        size: number;
      }
    | { ok: false; reasonCode: IssueAnalysisReasonCode }
  > {
    const normalized = normalizeRelativePath(relativePath);
    if (!normalized.ok) {
      return { ok: false, reasonCode: normalized.reasonCode };
    }

    // Walk each segment via lstat to reject symlink components early.
    let currentAbs = this.rootReal;
    if (normalized.relativePath !== ".") {
      const segments = normalized.relativePath.split("/");
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i]!;
        // Intermediate excluded directories block traversal before I/O.
        if (i < segments.length - 1 && isExcludedDirName(segment)) {
          return { ok: false, reasonCode: "excluded_directory" };
        }
        currentAbs = path.join(currentAbs, segment);
        let st;
        try {
          st = await lstat(currentAbs);
        } catch {
          return { ok: false, reasonCode: "path_rejected" };
        }
        if (st.isSymbolicLink()) {
          return { ok: false, reasonCode: "symlink_rejected" };
        }
        if (i < segments.length - 1 && !st.isDirectory()) {
          return { ok: false, reasonCode: "path_rejected" };
        }
      }
    }

    // Final node
    let finalStat;
    try {
      finalStat = await lstat(currentAbs);
    } catch {
      return { ok: false, reasonCode: "path_rejected" };
    }
    if (finalStat.isSymbolicLink()) {
      return { ok: false, reasonCode: "symlink_rejected" };
    }

    let realAbs: string;
    try {
      realAbs = await realpath(currentAbs);
    } catch {
      return { ok: false, reasonCode: "path_rejected" };
    }
    if (!isPathInsideRoot(this.rootReal, realAbs)) {
      return { ok: false, reasonCode: "path_rejected" };
    }

    // Re-check realpath target is not a symlink escape (TOCTOU narrow).
    let realStat;
    try {
      realStat = await lstat(realAbs);
    } catch {
      return { ok: false, reasonCode: "path_rejected" };
    }
    if (realStat.isSymbolicLink()) {
      return { ok: false, reasonCode: "symlink_rejected" };
    }

    const relOut = normalized.relativePath === "." ? "." : normalized.relativePath;

    // Excluded directory as the target itself
    if (realStat.isDirectory()) {
      const base = path.posix.basename(relOut);
      if (relOut !== "." && isExcludedDirName(base)) {
        return { ok: false, reasonCode: "excluded_directory" };
      }
      // Also reject if any ancestor segment (already checked) — extra: path under excluded
      if (hasExcludedAncestor(relOut)) {
        return { ok: false, reasonCode: "excluded_directory" };
      }
      if (opts.allowDirectory === false) {
        return { ok: false, reasonCode: "path_rejected" };
      }
      return {
        ok: true,
        kind: "directory",
        absolutePath: realAbs,
        relativePath: relOut,
        size: 0,
      };
    }

    if (realStat.isFile()) {
      if (hasExcludedAncestor(relOut)) {
        return { ok: false, reasonCode: "excluded_directory" };
      }
      if (isSecretLikeBasename(path.posix.basename(relOut))) {
        return { ok: false, reasonCode: "secret_like_rejected" };
      }
      if (opts.allowFile === false) {
        return { ok: false, reasonCode: "path_rejected" };
      }
      return {
        ok: true,
        kind: "file",
        absolutePath: realAbs,
        relativePath: relOut,
        size: realStat.size,
      };
    }

    return { ok: false, reasonCode: "path_rejected" };
  }

  private async walkFiles(
    absoluteDir: string,
    relativeDir: string,
    opts: {
      maxEntries: number;
      onFile: (relativePath: string) => boolean;
    },
  ): Promise<{ entries: string[]; capped: boolean }> {
    const entries: string[] = [];
    const stack: Array<{ abs: string; rel: string }> = [
      { abs: absoluteDir, rel: relativeDir },
    ];
    let capped = false;

    while (stack.length > 0) {
      if (entries.length >= opts.maxEntries) {
        capped = true;
        break;
      }
      if (this.deadlineAtMs - this.now() <= 0) {
        this.markExhausted("deadline_exceeded");
        capped = true;
        break;
      }

      const current = stack.pop()!;
      let dirents: Dirent[];
      try {
        dirents = await readdir(current.abs, { withFileTypes: true });
      } catch {
        continue;
      }
      // Deterministic order
      dirents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

      for (const dirent of dirents) {
        if (entries.length >= opts.maxEntries) {
          capped = true;
          break;
        }
        const name = dirent.name;
        if (!name || name === "." || name === ".." || name.includes("\0")) continue;
        if (dirent.isSymbolicLink()) continue;

        const childAbs = path.join(current.abs, name);
        const childRel =
          current.rel === "." ? name : `${current.rel}/${name}`;

        if (dirent.isDirectory()) {
          if (isExcludedDirName(name)) continue;
          // Confirm no symlink race
          try {
            const st = await lstat(childAbs);
            if (st.isSymbolicLink() || !st.isDirectory()) continue;
          } catch {
            continue;
          }
          stack.push({ abs: childAbs, rel: childRel });
          continue;
        }

        if (dirent.isFile()) {
          if (isSecretLikeBasename(name)) continue;
          if (!opts.onFile(childRel)) continue;
          entries.push(childRel);
        }
      }
    }

    return { entries, capped };
  }

  private async readTextFileBounded(
    absolutePath: string,
    knownSize?: number,
  ): Promise<
    | { ok: true; text: string }
    | { ok: false; reasonCode: IssueAnalysisReasonCode }
  > {
    let handle: Awaited<ReturnType<typeof open>> | null = null;
    try {
      // lstat again to reject symlink swap
      const st = await lstat(absolutePath);
      if (st.isSymbolicLink()) {
        return { ok: false, reasonCode: "symlink_rejected" };
      }
      if (!st.isFile()) {
        return { ok: false, reasonCode: "path_rejected" };
      }
      const size = knownSize ?? st.size;
      if (size > ISSUE_ANALYSIS_LIMITS.maxFileBytes) {
        return { ok: false, reasonCode: "file_too_large" };
      }

      handle = await open(absolutePath, "r");
      const fhStat = await handle.stat();
      if (!fhStat.isFile()) {
        return { ok: false, reasonCode: "path_rejected" };
      }
      if (fhStat.size > ISSUE_ANALYSIS_LIMITS.maxFileBytes) {
        return { ok: false, reasonCode: "file_too_large" };
      }

      const buf = Buffer.alloc(Math.min(fhStat.size, ISSUE_ANALYSIS_LIMITS.maxFileBytes));
      const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
      const slice = buf.subarray(0, bytesRead);
      // Binary / NUL reject
      if (slice.includes(0)) {
        return { ok: false, reasonCode: "binary_rejected" };
      }
      const text = slice.toString("utf8");
      // Also reject if decoding produced replacement-heavy binary-ish content
      if (text.includes("\uFFFD") && hasHighBinaryRatio(slice)) {
        return { ok: false, reasonCode: "binary_rejected" };
      }
      return { ok: true, text };
    } catch {
      return { ok: false, reasonCode: "path_rejected" };
    } finally {
      if (handle) {
        try {
          await handle.close();
        } catch {
          /* ignore */
        }
      }
    }
  }

  private beginOperation(): IssueAnalysisReasonCode | null {
    if (this.deadlineAtMs - this.now() <= 0) {
      this.markExhausted("deadline_exceeded");
      return "deadline_exceeded";
    }
    if (this.exhausted) {
      return this.exhaustReason ?? "budget_exhausted";
    }
    if (this.operationsUsed >= ISSUE_ANALYSIS_LIMITS.maxEvidenceOperations) {
      this.markExhausted("operation_budget_exceeded");
      return "operation_budget_exceeded";
    }
    this.operationsUsed += 1;
    return null;
  }

  private markExhausted(reason: IssueAnalysisReasonCode): void {
    this.exhausted = true;
    if (!this.exhaustReason) this.exhaustReason = reason;
  }

  private allocateEvidenceId(): string {
    this.evidenceSeq += 1;
    const rand = randomBytes(4).toString("hex");
    return `ev_${rand}${this.evidenceSeq.toString(16).padStart(2, "0")}`;
  }
}

// ─── Claim bounding (no filesystem) ──────────────────────────────────────────

export function boundIssueAnalysisClaim(
  input: IssueAnalysisClaimInput,
): IssueAnalysisBoundedClaim {
  const titleRaw = typeof input.title === "string" ? input.title : "";
  const bodyRaw = typeof input.body === "string" ? input.body : "";
  const titleTruncated = titleRaw.length > ISSUE_ANALYSIS_LIMITS.maxIssueTitleChars;
  const bodyTruncated = bodyRaw.length > ISSUE_ANALYSIS_LIMITS.maxIssueBodyChars;
  const title = titleRaw.slice(0, ISSUE_ANALYSIS_LIMITS.maxIssueTitleChars);
  const body = bodyRaw.slice(0, ISSUE_ANALYSIS_LIMITS.maxIssueBodyChars);
  const contentHash = sha256Hex(
    stableStringify({
      title: titleRaw,
      body: bodyRaw,
      repositoryId: input.repositoryId,
      issueNumber: input.issueNumber,
    }),
  );
  return {
    title,
    body,
    titleTruncated,
    bodyTruncated,
    truncated: titleTruncated || bodyTruncated,
    contentHash,
    issueUpdatedAt: input.issueUpdatedAt,
    repositoryId: input.repositoryId,
    issueNumber: input.issueNumber,
  };
}

// ─── Path helpers ────────────────────────────────────────────────────────────

export function normalizeRelativePath(
  input: string,
):
  | { ok: true; relativePath: string }
  | { ok: false; reasonCode: IssueAnalysisReasonCode } {
  if (typeof input !== "string") {
    return { ok: false, reasonCode: "path_rejected" };
  }
  if (input.length === 0 || input.length > 512) {
    return { ok: false, reasonCode: "path_rejected" };
  }
  if (input.includes("\0")) {
    return { ok: false, reasonCode: "path_rejected" };
  }
  // Reject URL / scheme / absolute / Windows / backslash escapes.
  if (
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(input) ||
    input.startsWith("/") ||
    input.startsWith("\\") ||
    /^[a-zA-Z]:[\\/]/.test(input) ||
    input.includes("\\") ||
    input.includes("//")
  ) {
    return { ok: false, reasonCode: "path_rejected" };
  }

  const trimmed = input.replace(/^\.\/+/, "");
  if (trimmed === "" || trimmed === ".") {
    return { ok: true, relativePath: "." };
  }

  const segments = trimmed.split("/");
  const out: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      return { ok: false, reasonCode: "path_rejected" };
    }
    if (segment.includes("\0")) {
      return { ok: false, reasonCode: "path_rejected" };
    }
    out.push(segment);
  }
  if (out.length === 0) {
    return { ok: true, relativePath: "." };
  }
  return { ok: true, relativePath: out.join("/") };
}

export function isSecretLikeBasename(name: string): boolean {
  if (!name) return true;
  if (SECRET_BASENAME_EXACT.has(name)) return true;
  for (const pattern of SECRET_BASENAME_PATTERNS) {
    if (pattern.test(name)) return true;
  }
  return false;
}

export function isExcludedDirName(name: string): boolean {
  return EXCLUDED_DIR_NAMES.has(name);
}

function hasExcludedAncestor(relativePath: string): boolean {
  if (relativePath === "." || relativePath === "") return false;
  const parts = relativePath.split("/");
  // Any directory segment except the final file name
  for (let i = 0; i < parts.length - 1; i++) {
    if (isExcludedDirName(parts[i]!)) return true;
  }
  return false;
}

function isPathInsideRoot(rootReal: string, candidateReal: string): boolean {
  const root = rootReal.endsWith(path.sep) ? rootReal.slice(0, -1) : rootReal;
  if (candidateReal === root) return true;
  const prefix = root + path.sep;
  return candidateReal.startsWith(prefix);
}

function compileFindPattern(pattern: string): ((name: string) => boolean) | null {
  if (!pattern || pattern.length > 200) return null;
  // Glob-lite: only * and ? ; everything else literal.
  let body = "";
  for (const ch of pattern) {
    if (ch === "*") body += ".*";
    else if (ch === "?") body += ".";
    else if (/[.^$+{}()|\[\]\\]/.test(ch)) body += `\\${ch}`;
    else body += ch;
  }
  try {
    const re = new RegExp(`^${body}$`, "i");
    return (name: string) => re.test(name);
  } catch {
    return null;
  }
}

function compileGrepPattern(pattern: string): RegExp | null {
  if (!pattern || pattern.length > 200) return null;
  try {
    // Literal substring search by default (escape regex metacharacters).
    // Models may request simple regex via /pattern/ form.
    if (pattern.startsWith("/") && pattern.lastIndexOf("/") > 0) {
      const last = pattern.lastIndexOf("/");
      const body = pattern.slice(1, last);
      const flags = pattern.slice(last + 1);
      if (!/^[ims]*$/.test(flags)) return null;
      // Reject catastrophic-looking unbounded quantifiers on large classes lightly
      if (body.length > 120) return null;
      return new RegExp(body, flags.includes("i") ? flags : `${flags}`);
    }
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(escaped);
  } catch {
    return null;
  }
}

function sanitizePreview(line: string, max: number): string {
  return sanitizeAnalysisProse(line).slice(0, max);
}

function hasHighBinaryRatio(buf: Buffer): boolean {
  if (buf.length === 0) return false;
  let nonText = 0;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i]!;
    // Allow common whitespace + printable ASCII + high UTF-8 bytes.
    if (b === 9 || b === 10 || b === 13) continue;
    if (b < 32) nonText += 1;
  }
  return nonText / buf.length > 0.1;
}

function sha256Hex(material: string): string {
  return createHash("sha256").update(material, "utf8").digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

/** Test-only: expose exclusion helpers without widening the public mutation surface. */
export const __issueAnalysisEvidenceTestUtils = {
  isPathInsideRoot,
  hasExcludedAncestor,
  compileFindPattern,
  compileGrepPattern,
};
