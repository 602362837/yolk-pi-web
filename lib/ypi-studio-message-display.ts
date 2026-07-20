/**
 * Pure display helpers for YPI Studio Context Integrity (SCI L0).
 *
 * Strips known Studio injection blocks from user-message text for Chat bubbles,
 * Copy/Edit, and title seeds. Also retains complete stripped blocks for
 * historical injection preview (IMP-001). No fs/network side effects.
 */

export const YPI_STUDIO_INJECTION_TAGS = [
  "ypi-studio-state",
  "ypi-studio-knowledge",
  "ypi-studio-context",
  "ypi-studio-first-reply",
] as const;

export type YpiStudioInjectionTag = (typeof YPI_STUDIO_INJECTION_TAGS)[number];

/** Soft cap for popover mono preview; Copy still uses full injectionText. */
export const YPI_STUDIO_INJECTION_PREVIEW_MAX_CHARS = 64 * 1024;

/** Status labels shown on compact Chat tags (and CSS data-status). */
export type YpiStudioInjectionStatus =
  | "no_task"
  | "intake"
  | "planning"
  | "awaiting_approval"
  | "implementing"
  | "checking"
  | "review"
  | "user_acceptance"
  | "waiting_for_improvements"
  | "completed"
  | "cancelled"
  | "failed"
  | "context"
  | "unknown";

export type YpiStudioStripConfidence = "full" | "partial" | "none";

/** One complete closed whitelist injection block, in document order. */
export interface YpiStudioInjectionBlock {
  /** Tag name without brackets, e.g. ypi-studio-state */
  tag: YpiStudioInjectionTag;
  /** Inner body only (between open/close) */
  body: string;
  /** Full matched substring including tags */
  raw: string;
  /** 0-based start index in original rawText */
  start: number;
  /** 0-based end index (exclusive) in original rawText */
  end: number;
}

export interface YpiStudioUserDisplayContent {
  /** Text for bubble / copy / edit */
  displayText: string;
  /** Original input */
  rawText: string;
  /** True if any complete injection block was removed */
  hadInjection: boolean;
  /** Parsed from state block when possible; null when no injection */
  studioStatus: YpiStudioInjectionStatus | null;
  /** full = only complete blocks; partial = incomplete open/close residue; none = clean */
  stripConfidence: YpiStudioStripConfidence;
  /**
   * Complete closed whitelist blocks in document order.
   * Empty when none. Half-open tags are never listed.
   * Present even when stripConfidence is partial (UI still gates on full).
   */
  injectionBlocks: YpiStudioInjectionBlock[];
  /**
   * Full raw blocks joined with blank lines for mono preview / Copy injection.
   * Empty string when none.
   */
  injectionText: string;
}

const TAG_ALT = YPI_STUDIO_INJECTION_TAGS.join("|");

/** Complete closed injection blocks only (same open/close name, non-greedy body). */
const COMPLETE_BLOCK_RE = new RegExp(
  `<(${TAG_ALT})>([\\s\\S]*?)<\\/\\1>`,
  "g",
);

/** Residual open/close markers after complete blocks are removed. */
const RESIDUAL_TAG_RE = new RegExp(`<\\/?ypi-studio-(?:state|knowledge|context|first-reply)\\b`, "i");

/** Status tokens that map 1:1 onto YpiStudioInjectionStatus (UI data-status matrix). */
const DISPLAY_STATUS_SET = new Set<string>([
  "no_task",
  "intake",
  "planning",
  "awaiting_approval",
  "implementing",
  "checking",
  "review",
  "user_acceptance",
  "waiting_for_improvements",
  "completed",
  "cancelled",
  "failed",
  "context",
  "unknown",
]);

function normalizeStatusToken(raw: string): YpiStudioInjectionStatus {
  const token = raw.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  if (!token) return "unknown";
  // Known display statuses pass through; other task-store tokens (e.g. blocked) → unknown.
  if (DISPLAY_STATUS_SET.has(token)) return token as YpiStudioInjectionStatus;
  return "unknown";
}

function extractStatusFromStateBody(body: string): YpiStudioInjectionStatus | null {
  const statusLine = body.match(/^\s*Status:\s*(\S+)/m);
  if (statusLine?.[1]) return normalizeStatusToken(statusLine[1]);

  const taskLine = body.match(/^\s*Task:\s*.+?\s*\(([^)]+)\)/m);
  if (taskLine?.[1]) return normalizeStatusToken(taskLine[1]);

  return null;
}

function tidyDisplayText(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function hasResidualInjectionMarkers(text: string): boolean {
  return RESIDUAL_TAG_RE.test(text);
}

function emptyInjectionFields(): Pick<YpiStudioUserDisplayContent, "injectionBlocks" | "injectionText"> {
  return {
    injectionBlocks: [],
    injectionText: "",
  };
}

function joinInjectionText(blocks: YpiStudioInjectionBlock[]): string {
  return blocks.map((b) => b.raw).join("\n\n");
}

/**
 * Parse a user message that may contain historical Studio injection blocks.
 * Only complete closed tags are removed; half-open tags stay (partial confidence).
 * Complete blocks are also exported for historical injection preview.
 */
export function parseYpiStudioUserMessage(raw: string): YpiStudioUserDisplayContent {
  const rawText = typeof raw === "string" ? raw : String(raw ?? "");
  if (!rawText) {
    return {
      displayText: "",
      rawText: "",
      hadInjection: false,
      studioStatus: null,
      stripConfidence: "none",
      ...emptyInjectionFields(),
    };
  }

  let studioStatus: YpiStudioInjectionStatus | null = null;
  const injectionBlocks: YpiStudioInjectionBlock[] = [];

  // Collect complete blocks with indices, then strip for display.
  // matchAll requires lastIndex reset; COMPLETE_BLOCK_RE is global.
  COMPLETE_BLOCK_RE.lastIndex = 0;
  for (const match of rawText.matchAll(COMPLETE_BLOCK_RE)) {
    const full = match[0];
    const tagName = match[1] as YpiStudioInjectionTag;
    const body = match[2] ?? "";
    const start = match.index ?? 0;
    const end = start + full.length;
    injectionBlocks.push({
      tag: tagName,
      body,
      raw: full,
      start,
      end,
    });
    if (studioStatus == null && tagName === "ypi-studio-state") {
      studioStatus = extractStatusFromStateBody(body);
    }
  }

  COMPLETE_BLOCK_RE.lastIndex = 0;
  const withoutBlocks = rawText.replace(COMPLETE_BLOCK_RE, "");

  const hadInjection = injectionBlocks.length > 0;
  const residual = hasResidualInjectionMarkers(withoutBlocks);

  let stripConfidence: YpiStudioStripConfidence = "none";
  if (residual) stripConfidence = "partial";
  else if (hadInjection) stripConfidence = "full";

  if (!hadInjection) {
    studioStatus = null;
  } else if (studioStatus == null) {
    studioStatus = "context";
  }

  return {
    displayText: tidyDisplayText(withoutBlocks),
    rawText,
    hadInjection,
    studioStatus,
    stripConfidence,
    injectionBlocks,
    injectionText: joinInjectionText(injectionBlocks),
  };
}

/**
 * Soft-truncate injection text for popover mono preview.
 * Copy injection should still use full injectionText when possible.
 */
export function formatYpiStudioInjectionPreview(injectionText: string): {
  text: string;
  truncated: boolean;
} {
  const text = typeof injectionText === "string" ? injectionText : String(injectionText ?? "");
  if (text.length <= YPI_STUDIO_INJECTION_PREVIEW_MAX_CHARS) {
    return { text, truncated: false };
  }
  return {
    text: text.slice(0, YPI_STUDIO_INJECTION_PREVIEW_MAX_CHARS) + "\n…",
    truncated: true,
  };
}

/** Convenience: cleaned display text only. */
export function stripYpiStudioInjections(raw: string): string {
  return parseYpiStudioUserMessage(raw).displayText;
}

/** Compact tag label, e.g. `Studio · implementing`. Empty when status is null. */
export function formatYpiStudioMessageTag(status: YpiStudioInjectionStatus | null | undefined): string {
  if (status == null) return "";
  return `Studio · ${status}`;
}
