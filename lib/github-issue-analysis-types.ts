/**
 * github-issue-analysis-types — strict contracts for opened-Issue read-only analysis (GIA-02).
 *
 * Security boundary:
 * - Issue title/body are untrusted claims only; they never control root, model, budget, or schema.
 * - Durable/API/comment projections must not carry absolute paths, secrets, prompts, transcripts,
 *   raw model output, tool payloads, or evidence excerpts.
 * - Model actions are a closed union; unknown keys or actions fail closed to inconclusive.
 */

import { createHash } from "node:crypto";

// ─── Categories / verdicts ───────────────────────────────────────────────────

export const ISSUE_ANALYSIS_CATEGORIES = [
  "bug",
  "feature",
  "docs",
  "question",
  "other",
] as const;

export type IssueAnalysisCategory = (typeof ISSUE_ANALYSIS_CATEGORIES)[number];

export const ISSUE_ANALYSIS_VERDICTS = [
  "confirmed",
  "not_exists",
  "inconclusive",
  "not_applicable",
] as const;

export type IssueAnalysisVerdict = (typeof ISSUE_ANALYSIS_VERDICTS)[number];

export const ISSUE_ANALYSIS_CONFIDENCE = ["high", "medium", "low"] as const;
export type IssueAnalysisConfidence = (typeof ISSUE_ANALYSIS_CONFIDENCE)[number];

export const ISSUE_ANALYSIS_EVIDENCE_RELATIONS = [
  "supports",
  "contradicts",
  "context",
] as const;

export type IssueAnalysisEvidenceRelation =
  (typeof ISSUE_ANALYSIS_EVIDENCE_RELATIONS)[number];

export const ISSUE_ANALYSIS_COVERAGE = [
  "complete",
  "partial",
  "insufficient",
] as const;

export type IssueAnalysisCoverage = (typeof ISSUE_ANALYSIS_COVERAGE)[number];

// ─── Budgets (server-owned; not Issue- or browser-configurable) ───────────────

export const ISSUE_ANALYSIS_LIMITS = {
  /** Total wall-clock for evidence + model rounds. */
  totalDurationMs: 120_000,
  /** Max controller evidence operations (list/find/grep/read). */
  maxEvidenceOperations: 20,
  /** Max entries returned from a single list/find enumeration. */
  maxEnumerationEntries: 200,
  /** Max grep hits returned to the model. */
  maxGrepHits: 200,
  /** Max total text bytes returned from a single grep. */
  maxGrepTextBytes: 64 * 1024,
  /** Max files successfully read into the ledger. */
  maxFilesRead: 12,
  /** Max bytes per file read (truncated beyond this is not accepted as full read). */
  maxFileBytes: 64 * 1024,
  /** Max total bytes across all successful file reads. */
  maxTotalReadBytes: 384 * 1024,
  /** Max evidence rows accepted in a final result. */
  maxFinalEvidence: 16,
  /** Max characters for a single evidence note / reason / direction string. */
  maxProseChars: 500,
  /** Issue title bound kept in memory for the model. */
  maxIssueTitleChars: 512,
  /** Issue body bound kept in memory for the model. */
  maxIssueBodyChars: 16 * 1024,
  /** Max model turns (each turn is one action or one final). */
  maxModelTurns: 24,
  /** Max characters accepted from a single model response before reject. */
  maxModelResponseChars: 32 * 1024,
  /**
   * High-confidence not_exists requires this many independent contradicts refs
   * after ledger reconciliation (design residual risk threshold).
   */
  minNotExistsContradictions: 2,
} as const;

// ─── Safe reason codes ───────────────────────────────────────────────────────

export const ISSUE_ANALYSIS_REASON_CODES = [
  "ok",
  "model_unavailable",
  "model_error",
  "model_timeout",
  "invalid_model_output",
  "unknown_action",
  "budget_exhausted",
  "deadline_exceeded",
  "path_rejected",
  "symlink_rejected",
  "binary_rejected",
  "secret_like_rejected",
  "excluded_directory",
  "file_too_large",
  "read_budget_exceeded",
  "operation_budget_exceeded",
  "enumeration_capped",
  "issue_truncated",
  "evidence_unknown",
  "evidence_missing_supports",
  "evidence_missing_contradicts",
  "category_verdict_mismatch",
  "confidence_insufficient",
  "coverage_incomplete",
  "schema_invalid",
  "project_root_unavailable",
  "analysis_aborted",
  "inconclusive_default",
] as const;

export type IssueAnalysisReasonCode =
  (typeof ISSUE_ANALYSIS_REASON_CODES)[number];

// ─── Claim / ledger / result shapes ──────────────────────────────────────────

export interface IssueAnalysisClaimInput {
  title: string;
  body: string;
  /** GitHub Issue updated_at at analysis input capture (ISO). */
  issueUpdatedAt: string;
  repositoryId: number;
  issueNumber: number;
}

export interface IssueAnalysisBoundedClaim {
  title: string;
  body: string;
  titleTruncated: boolean;
  bodyTruncated: boolean;
  /** True when either field was truncated — close is permanently forbidden. */
  truncated: boolean;
  contentHash: string;
  issueUpdatedAt: string;
  repositoryId: number;
  issueNumber: number;
}

export interface IssueAnalysisEvidenceRef {
  evidenceId: string;
  relation: IssueAnalysisEvidenceRelation;
  /** Relative path only; never absolute. */
  relativePath: string;
  lineStart: number | null;
  lineEnd: number | null;
  /** Bounded product note for comment projection (not file excerpt). */
  note: string;
}

export interface IssueAnalysisLedgerEntry {
  evidenceId: string;
  relativePath: string;
  lineStart: number | null;
  lineEnd: number | null;
  /** sha256 of observed content slice. */
  contentHash: string;
  bytes: number;
  operation: "read" | "grep";
  /** Optional operation-local relation hint; final relation is chosen in final.evidence. */
  observedAtMs: number;
}

export interface IssueAnalysisBudgetSnapshot {
  operationsUsed: number;
  operationsRemaining: number;
  filesRead: number;
  filesRemaining: number;
  bytesRead: number;
  bytesRemaining: number;
  deadlineRemainingMs: number;
  exhausted: boolean;
}

export interface IssueAnalysisValidatedResult {
  category: IssueAnalysisCategory;
  verdict: IssueAnalysisVerdict;
  confidence: IssueAnalysisConfidence;
  coverage: IssueAnalysisCoverage;
  complete: boolean;
  truncatedInput: boolean;
  budgetExhausted: boolean;
  /** Close eligibility after controller post-validation (never true for non-bugs). */
  mayClose: boolean;
  reasonCode: IssueAnalysisReasonCode;
  /** Bounded Chinese/English product prose for comment sections. */
  reasonSummary: string;
  directionSummary: string;
  evidence: IssueAnalysisEvidenceRef[];
  /** Opaque result hash over safe fields (no excerpts / absolute paths). */
  resultHash: string;
}

// ─── Model action union ──────────────────────────────────────────────────────

export type IssueAnalysisModelAction =
  | { action: "list"; path: string }
  | { action: "find"; path: string; pattern: string }
  | { action: "grep"; path: string; pattern: string; maxHits?: number }
  | { action: "read"; path: string; lineStart?: number; lineEnd?: number }
  | {
      action: "final";
      category: IssueAnalysisCategory;
      verdict: IssueAnalysisVerdict;
      confidence: IssueAnalysisConfidence;
      coverage: IssueAnalysisCoverage;
      reasonSummary: string;
      directionSummary: string;
      evidence: Array<{
        evidenceId: string;
        relation: IssueAnalysisEvidenceRelation;
        note: string;
      }>;
    };

export type IssueAnalysisToolResult =
  | {
      ok: true;
      action: "list" | "find";
      path: string;
      entries: string[];
      capped: boolean;
      budget: IssueAnalysisBudgetSnapshot;
    }
  | {
      ok: true;
      action: "grep";
      path: string;
      hits: Array<{
        evidenceId: string;
        relativePath: string;
        lineStart: number;
        lineEnd: number;
        /** Bounded single-line preview already sanitized (no absolute paths). */
        preview: string;
      }>;
      capped: boolean;
      budget: IssueAnalysisBudgetSnapshot;
    }
  | {
      ok: true;
      action: "read";
      evidenceId: string;
      relativePath: string;
      lineStart: number;
      lineEnd: number;
      /** Bounded text content already size-capped. */
      content: string;
      budget: IssueAnalysisBudgetSnapshot;
    }
  | {
      ok: false;
      action: string;
      reasonCode: IssueAnalysisReasonCode;
      budget: IssueAnalysisBudgetSnapshot;
    };

// ─── Parsers ─────────────────────────────────────────────────────────────────

const CATEGORY_SET = new Set<string>(ISSUE_ANALYSIS_CATEGORIES);
const VERDICT_SET = new Set<string>(ISSUE_ANALYSIS_VERDICTS);
const CONFIDENCE_SET = new Set<string>(ISSUE_ANALYSIS_CONFIDENCE);
const RELATION_SET = new Set<string>(ISSUE_ANALYSIS_EVIDENCE_RELATIONS);
const COVERAGE_SET = new Set<string>(ISSUE_ANALYSIS_COVERAGE);
const REASON_SET = new Set<string>(ISSUE_ANALYSIS_REASON_CODES);

export function isIssueAnalysisCategory(
  value: unknown,
): value is IssueAnalysisCategory {
  return typeof value === "string" && CATEGORY_SET.has(value);
}

export function isIssueAnalysisVerdict(
  value: unknown,
): value is IssueAnalysisVerdict {
  return typeof value === "string" && VERDICT_SET.has(value);
}

export function isIssueAnalysisConfidence(
  value: unknown,
): value is IssueAnalysisConfidence {
  return typeof value === "string" && CONFIDENCE_SET.has(value);
}

export function isIssueAnalysisEvidenceRelation(
  value: unknown,
): value is IssueAnalysisEvidenceRelation {
  return typeof value === "string" && RELATION_SET.has(value);
}

export function isIssueAnalysisCoverage(
  value: unknown,
): value is IssueAnalysisCoverage {
  return typeof value === "string" && COVERAGE_SET.has(value);
}

export function isIssueAnalysisReasonCode(
  value: unknown,
): value is IssueAnalysisReasonCode {
  return typeof value === "string" && REASON_SET.has(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  if (actual.length !== keys.length) return false;
  return keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function isOptionalPositiveInt(value: unknown): value is number | undefined {
  if (value === undefined) return true;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

/**
 * Parse a single model turn. Rejects extra keys, unknown actions, empty paths,
 * and overlong prose. Does not execute anything.
 */
export function parseIssueAnalysisModelAction(
  value: unknown,
): IssueAnalysisModelAction | null {
  if (!isRecord(value)) return null;
  const action = value.action;
  if (typeof action !== "string") return null;

  if (action === "list") {
    if (!exactKeys(value, ["action", "path"])) return null;
    if (typeof value.path !== "string" || value.path.length === 0 || value.path.length > 512) {
      return null;
    }
    return { action: "list", path: value.path };
  }

  if (action === "find") {
    if (!exactKeys(value, ["action", "path", "pattern"])) return null;
    if (typeof value.path !== "string" || value.path.length === 0 || value.path.length > 512) {
      return null;
    }
    if (
      typeof value.pattern !== "string" ||
      value.pattern.length === 0 ||
      value.pattern.length > 200
    ) {
      return null;
    }
    return { action: "find", path: value.path, pattern: value.pattern };
  }

  if (action === "grep") {
    const keys = Object.keys(value);
    if (
      !(
        exactKeys(value, ["action", "path", "pattern"]) ||
        exactKeys(value, ["action", "path", "pattern", "maxHits"])
      )
    ) {
      return null;
    }
    if (typeof value.path !== "string" || value.path.length === 0 || value.path.length > 512) {
      return null;
    }
    if (
      typeof value.pattern !== "string" ||
      value.pattern.length === 0 ||
      value.pattern.length > 200
    ) {
      return null;
    }
    if (!isOptionalPositiveInt(value.maxHits)) return null;
    if (value.maxHits !== undefined && value.maxHits > ISSUE_ANALYSIS_LIMITS.maxGrepHits) {
      return null;
    }
    // Silence unused when keys only used for exactKeys branch clarity.
    void keys;
    return {
      action: "grep",
      path: value.path,
      pattern: value.pattern,
      ...(value.maxHits !== undefined ? { maxHits: value.maxHits } : {}),
    };
  }

  if (action === "read") {
    const allowed =
      exactKeys(value, ["action", "path"]) ||
      exactKeys(value, ["action", "path", "lineStart"]) ||
      exactKeys(value, ["action", "path", "lineEnd"]) ||
      exactKeys(value, ["action", "path", "lineStart", "lineEnd"]);
    if (!allowed) return null;
    if (typeof value.path !== "string" || value.path.length === 0 || value.path.length > 512) {
      return null;
    }
    if (value.lineStart !== undefined) {
      if (
        typeof value.lineStart !== "number" ||
        !Number.isSafeInteger(value.lineStart) ||
        value.lineStart < 1
      ) {
        return null;
      }
    }
    if (value.lineEnd !== undefined) {
      if (
        typeof value.lineEnd !== "number" ||
        !Number.isSafeInteger(value.lineEnd) ||
        value.lineEnd < 1
      ) {
        return null;
      }
    }
    if (
      value.lineStart !== undefined &&
      value.lineEnd !== undefined &&
      value.lineEnd < value.lineStart
    ) {
      return null;
    }
    return {
      action: "read",
      path: value.path,
      ...(value.lineStart !== undefined ? { lineStart: value.lineStart } : {}),
      ...(value.lineEnd !== undefined ? { lineEnd: value.lineEnd } : {}),
    };
  }

  if (action === "final") {
    if (
      !exactKeys(value, [
        "action",
        "category",
        "verdict",
        "confidence",
        "coverage",
        "reasonSummary",
        "directionSummary",
        "evidence",
      ])
    ) {
      return null;
    }
    if (!isIssueAnalysisCategory(value.category)) return null;
    if (!isIssueAnalysisVerdict(value.verdict)) return null;
    if (!isIssueAnalysisConfidence(value.confidence)) return null;
    if (!isIssueAnalysisCoverage(value.coverage)) return null;
    if (!isBoundedString(value.reasonSummary, ISSUE_ANALYSIS_LIMITS.maxProseChars)) {
      return null;
    }
    if (!isBoundedString(value.directionSummary, ISSUE_ANALYSIS_LIMITS.maxProseChars)) {
      return null;
    }
    if (!Array.isArray(value.evidence)) return null;
    if (value.evidence.length > ISSUE_ANALYSIS_LIMITS.maxFinalEvidence) return null;

    const evidence: Array<{
      evidenceId: string;
      relation: IssueAnalysisEvidenceRelation;
      note: string;
    }> = [];
    for (const item of value.evidence) {
      if (!isRecord(item)) return null;
      if (!exactKeys(item, ["evidenceId", "relation", "note"])) return null;
      if (
        typeof item.evidenceId !== "string" ||
        !/^ev_[a-f0-9]{8,32}$/.test(item.evidenceId)
      ) {
        return null;
      }
      if (!isIssueAnalysisEvidenceRelation(item.relation)) return null;
      if (!isBoundedString(item.note, ISSUE_ANALYSIS_LIMITS.maxProseChars)) return null;
      evidence.push({
        evidenceId: item.evidenceId,
        relation: item.relation,
        note: item.note,
      });
    }

    return {
      action: "final",
      category: value.category,
      verdict: value.verdict,
      confidence: value.confidence,
      coverage: value.coverage,
      reasonSummary: value.reasonSummary,
      directionSummary: value.directionSummary,
      evidence,
    };
  }

  return null;
}

/**
 * Strip a single markdown JSON fence if present; otherwise return trimmed text.
 * Does not attempt to "repair" partial JSON.
 */
export function stripIssueAnalysisJsonFence(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

/**
 * Extract one top-level JSON object from a model response. Returns null when
 * no single object can be located.
 */
export function extractIssueAnalysisJsonObject(raw: string): string | null {
  if (raw.length > ISSUE_ANALYSIS_LIMITS.maxModelResponseChars) return null;
  const stripped = stripIssueAnalysisJsonFence(raw);
  if (stripped.startsWith("{") && stripped.endsWith("}")) return stripped;
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  return stripped.slice(start, end + 1);
}

export function parseIssueAnalysisModelActionFromText(
  raw: string,
): IssueAnalysisModelAction | null {
  const jsonText = extractIssueAnalysisJsonObject(raw);
  if (!jsonText) return null;
  try {
    return parseIssueAnalysisModelAction(JSON.parse(jsonText) as unknown);
  } catch {
    return null;
  }
}

/**
 * Force category/verdict product rules and evidence ledger consistency.
 * Any failure becomes a safe inconclusive result (never close-eligible).
 */
export function postValidateIssueAnalysisFinal(input: {
  final: Extract<IssueAnalysisModelAction, { action: "final" }>;
  ledger: ReadonlyMap<string, IssueAnalysisLedgerEntry>;
  truncatedInput: boolean;
  budgetExhausted: boolean;
  complete: boolean;
}): IssueAnalysisValidatedResult {
  const { final, ledger, truncatedInput, budgetExhausted, complete } = input;

  const resolvedEvidence: IssueAnalysisEvidenceRef[] = [];
  let unknownEvidence = false;
  for (const ref of final.evidence) {
    const entry = ledger.get(ref.evidenceId);
    if (!entry) {
      unknownEvidence = true;
      continue;
    }
    resolvedEvidence.push({
      evidenceId: entry.evidenceId,
      relation: ref.relation,
      relativePath: entry.relativePath,
      lineStart: entry.lineStart,
      lineEnd: entry.lineEnd,
      note: sanitizeAnalysisProse(ref.note),
    });
  }

  const supports = resolvedEvidence.filter((e) => e.relation === "supports");
  const contradicts = resolvedEvidence.filter((e) => e.relation === "contradicts");

  const category = final.category;
  let verdict = final.verdict;
  let confidence = final.confidence;
  const coverage = final.coverage;
  let reasonCode: IssueAnalysisReasonCode = "ok";
  let reasonSummary = sanitizeAnalysisProse(final.reasonSummary);
  let directionSummary = sanitizeAnalysisProse(final.directionSummary);

  // Non-bug categories never claim defect truth.
  if (category === "feature" || category === "docs" || category === "question") {
    if (verdict !== "not_applicable") {
      verdict = "not_applicable";
      reasonCode = "category_verdict_mismatch";
    }
  } else if (category === "other") {
    // "other" may be not_applicable or inconclusive; never auto-close.
    if (verdict === "not_exists" || verdict === "confirmed") {
      verdict = "inconclusive";
      reasonCode = "category_verdict_mismatch";
    }
  } else if (category === "bug") {
    if (verdict === "not_applicable") {
      verdict = "inconclusive";
      reasonCode = "category_verdict_mismatch";
    }
  }

  if (unknownEvidence) {
    verdict = "inconclusive";
    confidence = confidence === "high" ? "medium" : confidence;
    reasonCode = "evidence_unknown";
  }

  if (truncatedInput) {
    // Truncation forbids close; force open-safe outcome when model claimed not_exists.
    if (verdict === "not_exists") {
      verdict = "inconclusive";
      reasonCode = "issue_truncated";
    }
  }

  if (budgetExhausted && verdict === "not_exists") {
    verdict = "inconclusive";
    reasonCode = "budget_exhausted";
  }

  if (!complete && verdict === "not_exists") {
    verdict = "inconclusive";
    reasonCode = "coverage_incomplete";
  }

  if (coverage !== "complete" && verdict === "not_exists") {
    verdict = "inconclusive";
    reasonCode = "coverage_incomplete";
  }

  if (verdict === "confirmed" && supports.length === 0) {
    verdict = "inconclusive";
    reasonCode = "evidence_missing_supports";
  }

  if (verdict === "not_exists") {
    if (confidence !== "high") {
      verdict = "inconclusive";
      reasonCode = "confidence_insufficient";
    } else if (contradicts.length < ISSUE_ANALYSIS_LIMITS.minNotExistsContradictions) {
      // Grep miss / zero hits never appear as ledger contradicts; this also
      // rejects single-weak-ref not_exists claims.
      verdict = "inconclusive";
      reasonCode = "evidence_missing_contradicts";
    }
  }

  // Feature "not implemented" must never become not_exists (already forced above).
  const mayClose =
    category === "bug" &&
    verdict === "not_exists" &&
    confidence === "high" &&
    coverage === "complete" &&
    complete &&
    !truncatedInput &&
    !budgetExhausted &&
    reasonCode === "ok" &&
    contradicts.length >= ISSUE_ANALYSIS_LIMITS.minNotExistsContradictions;

  if (!mayClose && verdict === "not_exists" && reasonCode === "ok") {
    // Defensive: should be unreachable, but never emit close-eligible without mayClose.
    verdict = "inconclusive";
    reasonCode = "inconclusive_default";
  }

  if (verdict === "inconclusive" && reasonSummary.length === 0) {
    reasonSummary = "Evidence is insufficient for a high-confidence truth verdict.";
  }
  if (directionSummary.length === 0) {
    directionSummary =
      verdict === "not_applicable"
        ? "Treat this as a product request; no defect truth claim applies."
        : "Provide more concrete reproduction details or repository pointers.";
  }

  const result: IssueAnalysisValidatedResult = {
    category,
    verdict,
    confidence,
    coverage,
    complete: complete && !budgetExhausted && !truncatedInput,
    truncatedInput,
    budgetExhausted,
    mayClose,
    reasonCode,
    reasonSummary,
    directionSummary,
    evidence: resolvedEvidence,
    resultHash: "",
  };
  result.resultHash = hashIssueAnalysisValidatedResult(result);
  return result;
}

/** Build a durable-safe inconclusive result without model participation. */
export function buildInconclusiveIssueAnalysisResult(input: {
  category?: IssueAnalysisCategory;
  reasonCode: IssueAnalysisReasonCode;
  reasonSummary: string;
  directionSummary?: string;
  truncatedInput?: boolean;
  budgetExhausted?: boolean;
}): IssueAnalysisValidatedResult {
  const result: IssueAnalysisValidatedResult = {
    category: input.category ?? "other",
    verdict: "inconclusive",
    confidence: "low",
    coverage: "insufficient",
    complete: false,
    truncatedInput: input.truncatedInput === true,
    budgetExhausted: input.budgetExhausted === true,
    mayClose: false,
    reasonCode: input.reasonCode,
    reasonSummary: sanitizeAnalysisProse(input.reasonSummary),
    directionSummary: sanitizeAnalysisProse(
      input.directionSummary ??
        "Provide more concrete reproduction details or repository pointers.",
    ),
    evidence: [],
    resultHash: "",
  };
  result.resultHash = hashIssueAnalysisValidatedResult(result);
  return result;
}

export function sanitizeAnalysisProse(value: string): string {
  // Drop control chars and collapse whitespace; bound length.
  const cleaned = value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= ISSUE_ANALYSIS_LIMITS.maxProseChars) return cleaned;
  return cleaned.slice(0, ISSUE_ANALYSIS_LIMITS.maxProseChars);
}

export function hashIssueAnalysisValidatedResult(
  result: Omit<IssueAnalysisValidatedResult, "resultHash"> & { resultHash?: string },
): string {
  // Lazy import avoided: keep this module free of Node crypto at type-layer by
  // using a tiny pure digest via global crypto when available, else a stable
  // JSON fallback hash implemented below.
  const payload = {
    category: result.category,
    verdict: result.verdict,
    confidence: result.confidence,
    coverage: result.coverage,
    complete: result.complete,
    truncatedInput: result.truncatedInput,
    budgetExhausted: result.budgetExhausted,
    mayClose: result.mayClose,
    reasonCode: result.reasonCode,
    reasonSummary: result.reasonSummary,
    directionSummary: result.directionSummary,
    evidence: result.evidence.map((e) => ({
      evidenceId: e.evidenceId,
      relation: e.relation,
      relativePath: e.relativePath,
      lineStart: e.lineStart,
      lineEnd: e.lineEnd,
      note: e.note,
    })),
  };
  return sha256Hex(stableStringify(payload));
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

function sha256Hex(material: string): string {
  return createHash("sha256").update(material, "utf8").digest("hex");
}
