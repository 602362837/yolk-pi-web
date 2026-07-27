/**
 * github-owner-intent — owner actor gates + Phase 1 exact command grammar (GHA-03 / CMD-03).
 *
 * Product rules:
 * - Owner identity is checked BEFORE broad natural-language parsing.
 * - User-owned repos: sender id must equal repository.owner.id.
 * - Org-owned repos: sender id must be in explicit ownerActorIds.
 * - Bots never authorize.
 * - Strip quote / fenced code / HTML comments before intent matching.
 * - Phase 1 commands target @AppBot or leading /ypi (not machine assignee).
 * - Parser returns only enum commands — never free text for agent/task/config.
 * - Awaiting-owner adoption remains compatible without mention (historical).
 * - Incomplete claim must never produce ownerAuthorization for implementation.
 * - P0 records accepted_waiting_automation only — never creates WorkTree here.
 */

import { createHash } from "node:crypto";
import type { GithubAutomationRepositoryConfig } from "./github-automation-types";

// ─── Types ───────────────────────────────────────────────────────────────────

export type GithubOwnerIntentKind =
  | "affirmative"
  | "negative"
  | "defer"
  | "question"
  | "unclear"
  | "empty";

/** Phase 1 owner commands (CMD-03). Enum only — never free text. */
export type GithubOwnerCommandKind =
  | "status"
  | "re_evaluate"
  | "adopt"
  | "pause"
  | "continue";

export type GithubOwnerCommandTargetKind =
  | "app_bot_mention"
  | "ypi_slash"
  | "legacy_awaiting_owner"
  | "none";

export type GithubOwnerCommandParseDisposition =
  | "command"
  | "unsupported"
  | "no_command"
  | "empty";

export interface GithubOwnerCommandParseResult {
  disposition: GithubOwnerCommandParseDisposition;
  command: GithubOwnerCommandKind | null;
  target: GithubOwnerCommandTargetKind;
  /** Safe matched phrase only (enum-side), never full free text. */
  matchedPhrase: string | null;
  normalizedText: string;
  /** True when a target was present but the residual text is not a known command. */
  unsupportedTargeted: boolean;
}

export type GithubOwnerAuthorizationDecision =
  | "authorized"
  | "not_owner"
  | "bot_sender"
  | "missing_sender"
  | "incomplete_claim"
  | "issue_not_open"
  | "recommendation_not_yes"
  | "intent_negative"
  | "intent_defer"
  | "intent_question"
  | "intent_unclear"
  | "intent_empty";

export interface GithubOwnerActorContext {
  senderId: number | null;
  senderLogin: string | null;
  senderType: string | null;
  /** repository.owner.id from fresh Issue/repo payload */
  repositoryOwnerId: number | null;
  repositoryOwnerLogin: string | null;
  repositoryOwnerType: string | null;
  /** Explicit org owner actor ids from automation config */
  ownerActorIds: number[];
}

export interface GithubOwnerIntentParseResult {
  kind: GithubOwnerIntentKind;
  /** True only for clear affirmative after strip. */
  isAffirmative: boolean;
  normalizedText: string;
  matchedPhrase: string | null;
}

export interface GithubOwnerAuthorizationResult {
  decision: GithubOwnerAuthorizationDecision;
  authorized: boolean;
  isOwner: boolean;
  intent: GithubOwnerIntentParseResult;
  reasonCode: string;
}

// ─── Text normalization ─────────────────────────────────────────────────────

/**
 * Remove quoted reply lines, fenced code, inline code, and HTML comments so
 * nested "可以做" inside quotes/code cannot authorize.
 */
export function stripUntrustedCommentDecorations(raw: string): string {
  let text = raw.replace(/\r\n/g, "\n");

  // HTML comments
  text = text.replace(/<!--[\s\S]*?-->/g, " ");

  // Fenced code blocks
  text = text.replace(/```[\s\S]*?```/g, " ");
  text = text.replace(/~~~[\s\S]*?~~~/g, " ");

  // Inline code
  text = text.replace(/`[^`]*`/g, " ");

  // Markdown quote lines
  text = text
    .split("\n")
    .filter((line) => !/^\s{0,3}>\s?/.test(line))
    .join("\n");

  // Collapse whitespace
  return text.replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
}

const AFFIRMATIVE_PHRASES: Array<{ re: RegExp; phrase: string }> = [
  { re: /按建议处理/, phrase: "按建议处理" },
  { re: /开始实现/, phrase: "开始实现" },
  { re: /可以做/, phrase: "可以做" },
  { re: /同意(?:采纳|实现|处理)?/, phrase: "同意" },
  { re: /采纳/, phrase: "采纳" },
  { re: /批准/, phrase: "批准" },
  { re: /请(?:开始|继续)?(?:实现|处理)/, phrase: "请实现" },
  { re: /\bgo\s*ahead\b/i, phrase: "go ahead" },
  { re: /\bapproved?\b/i, phrase: "approve" },
  { re: /\baccept(?:ed|ance)?\b/i, phrase: "accept" },
  { re: /\blgtm\b/i, phrase: "lgtm" },
  { re: /\bship\s*it\b/i, phrase: "ship it" },
  { re: /\bplease\s+(?:implement|proceed|do\s+it)\b/i, phrase: "please implement" },
  { re: /^(?:ok|okay|yes)\b/i, phrase: "yes" },
  { re: /^好的?[。.!！]?$/, phrase: "好的" },
  { re: /^行[。.!！]?$/, phrase: "行" },
  { re: /^可以[。.!！]?$/, phrase: "可以" },
  { re: /^做吧[。.!！]?$/, phrase: "做吧" },
];

const NEGATIVE_PHRASES: Array<{ re: RegExp; phrase: string }> = [
  { re: /不要/, phrase: "不要" },
  { re: /别做/, phrase: "别做" },
  { re: /拒绝/, phrase: "拒绝" },
  { re: /不采纳/, phrase: "不采纳" },
  { re: /不同意/, phrase: "不同意" },
  { re: /先不要/, phrase: "先不要" },
  { re: /取消/, phrase: "取消" },
  { re: /\bdo\s+not\b/i, phrase: "do not" },
  { re: /\bdon'?t\b/i, phrase: "don't" },
  { re: /\breject(?:ed)?\b/i, phrase: "reject" },
  { re: /\bdeny|denied\b/i, phrase: "deny" },
  { re: /\bno\b/i, phrase: "no" },
  { re: /^否[。.!！]?$/, phrase: "否" },
];

const DEFER_PHRASES: Array<{ re: RegExp; phrase: string }> = [
  { re: /暂缓/, phrase: "暂缓" },
  { re: /以后再说/, phrase: "以后再说" },
  { re: /先等等/, phrase: "先等等" },
  { re: /再看看/, phrase: "再看看" },
  { re: /稍后/, phrase: "稍后" },
  { re: /\blater\b/i, phrase: "later" },
  { re: /\bdefer(?:red)?\b/i, phrase: "defer" },
  { re: /\bhold\b/i, phrase: "hold" },
  { re: /\bnot\s+now\b/i, phrase: "not now" },
  { re: /\bwait\b/i, phrase: "wait" },
];

function firstMatch(
  text: string,
  list: Array<{ re: RegExp; phrase: string }>,
): string | null {
  for (const item of list) {
    if (item.re.test(text)) return item.phrase;
  }
  return null;
}

function looksLikeQuestion(text: string): boolean {
  if (/[?？]/.test(text)) return true;
  if (/^(?:为什么|为何|是否|能不能|可不可以|怎么|如何)/.test(text)) return true;
  if (/^(?:why|how|what|when|where|can\s+we|should\s+we)\b/i.test(text)) return true;
  return false;
}

/**
 * Parse owner intent from a comment body after decoration strip.
 * Negation / defer win over affirmative when both appear.
 */
export function parseGithubOwnerIntent(
  rawBody: string | null | undefined,
): GithubOwnerIntentParseResult {
  if (typeof rawBody !== "string" || !rawBody.trim()) {
    return {
      kind: "empty",
      isAffirmative: false,
      normalizedText: "",
      matchedPhrase: null,
    };
  }

  const normalizedText = stripUntrustedCommentDecorations(rawBody);
  if (!normalizedText) {
    return {
      kind: "empty",
      isAffirmative: false,
      normalizedText: "",
      matchedPhrase: null,
    };
  }

  const negative = firstMatch(normalizedText, NEGATIVE_PHRASES);
  if (negative) {
    return {
      kind: "negative",
      isAffirmative: false,
      normalizedText,
      matchedPhrase: negative,
    };
  }

  const defer = firstMatch(normalizedText, DEFER_PHRASES);
  if (defer) {
    return {
      kind: "defer",
      isAffirmative: false,
      normalizedText,
      matchedPhrase: defer,
    };
  }

  if (looksLikeQuestion(normalizedText)) {
    return {
      kind: "question",
      isAffirmative: false,
      normalizedText,
      matchedPhrase: null,
    };
  }

  const affirmative = firstMatch(normalizedText, AFFIRMATIVE_PHRASES);
  if (affirmative) {
    return {
      kind: "affirmative",
      isAffirmative: true,
      normalizedText,
      matchedPhrase: affirmative,
    };
  }

  return {
    kind: "unclear",
    isAffirmative: false,
    normalizedText,
    matchedPhrase: null,
  };
}

// ─── Owner actor ─────────────────────────────────────────────────────────────

export function isBotSenderType(senderType: string | null | undefined): boolean {
  if (!senderType) return false;
  const t = senderType.toLowerCase();
  return t === "bot" || t === "app";
}

/**
 * Determine whether the sender is the repository owner for automation purposes.
 */
export function isGithubRepositoryOwnerActor(
  context: GithubOwnerActorContext,
): boolean {
  if (context.senderId === null) return false;
  if (isBotSenderType(context.senderType)) return false;

  const ownerType = (context.repositoryOwnerType ?? "").toLowerCase();
  const isOrg = ownerType === "organization" || ownerType === "org";

  if (isOrg) {
    return context.ownerActorIds.includes(context.senderId);
  }

  // User-owned: sender id must match repository.owner.id.
  if (context.repositoryOwnerId !== null) {
    if (context.senderId === context.repositoryOwnerId) return true;
  }

  // Explicit allowlist still applies for user-owned when configured.
  if (context.ownerActorIds.includes(context.senderId)) return true;

  return false;
}

export function buildOwnerActorContextFromRepoConfig(
  repo: Pick<GithubAutomationRepositoryConfig, "ownerActorIds">,
  parts: {
    senderId: number | null;
    senderLogin: string | null;
    senderType: string | null;
    repositoryOwnerId: number | null;
    repositoryOwnerLogin: string | null;
    repositoryOwnerType: string | null;
  },
): GithubOwnerActorContext {
  return {
    senderId: parts.senderId,
    senderLogin: parts.senderLogin,
    senderType: parts.senderType,
    repositoryOwnerId: parts.repositoryOwnerId,
    repositoryOwnerLogin: parts.repositoryOwnerLogin,
    repositoryOwnerType: parts.repositoryOwnerType,
    ownerActorIds: Array.isArray(repo.ownerActorIds) ? repo.ownerActorIds : [],
  };
}

// ─── Authorization gate ──────────────────────────────────────────────────────

export interface EvaluateOwnerAuthorizationInput {
  actor: GithubOwnerActorContext;
  commentBody: string | null | undefined;
  /** Complete label+assignee claim already confirmed. */
  claimComplete: boolean;
  issueOpen: boolean;
  /** Triage recommended adoption (yes). needs_info/no cannot authorize implementation. */
  recommendation: "yes" | "no" | "needs_info" | null;
}

/**
 * Full owner-authorization evaluation for P0.
 * authorized=true only means "owner adoption accepted" for automation bookkeeping.
 * P0 maps this to accepted_waiting_automation — never WorkTree.
 */
export function evaluateGithubOwnerAuthorization(
  input: EvaluateOwnerAuthorizationInput,
): GithubOwnerAuthorizationResult {
  const intent = parseGithubOwnerIntent(input.commentBody);

  if (input.actor.senderId === null) {
    return {
      decision: "missing_sender",
      authorized: false,
      isOwner: false,
      intent,
      reasonCode: "missing_sender",
    };
  }

  if (isBotSenderType(input.actor.senderType)) {
    return {
      decision: "bot_sender",
      authorized: false,
      isOwner: false,
      intent,
      reasonCode: "bot_sender",
    };
  }

  const isOwner = isGithubRepositoryOwnerActor(input.actor);
  if (!isOwner) {
    return {
      decision: "not_owner",
      authorized: false,
      isOwner: false,
      intent,
      reasonCode: "not_owner",
    };
  }

  if (!input.claimComplete) {
    return {
      decision: "incomplete_claim",
      authorized: false,
      isOwner: true,
      intent,
      reasonCode: "incomplete_claim",
    };
  }

  if (!input.issueOpen) {
    return {
      decision: "issue_not_open",
      authorized: false,
      isOwner: true,
      intent,
      reasonCode: "issue_not_open",
    };
  }

  if (input.recommendation !== "yes") {
    return {
      decision: "recommendation_not_yes",
      authorized: false,
      isOwner: true,
      intent,
      reasonCode: "recommendation_not_yes",
    };
  }

  if (intent.kind === "negative") {
    return {
      decision: "intent_negative",
      authorized: false,
      isOwner: true,
      intent,
      reasonCode: "intent_negative",
    };
  }
  if (intent.kind === "defer") {
    return {
      decision: "intent_defer",
      authorized: false,
      isOwner: true,
      intent,
      reasonCode: "intent_defer",
    };
  }
  if (intent.kind === "question") {
    return {
      decision: "intent_question",
      authorized: false,
      isOwner: true,
      intent,
      reasonCode: "intent_question",
    };
  }
  if (intent.kind === "empty") {
    return {
      decision: "intent_empty",
      authorized: false,
      isOwner: true,
      intent,
      reasonCode: "intent_empty",
    };
  }
  if (intent.kind === "unclear" || !intent.isAffirmative) {
    return {
      decision: "intent_unclear",
      authorized: false,
      isOwner: true,
      intent,
      reasonCode: "intent_unclear",
    };
  }

  return {
    decision: "authorized",
    authorized: true,
    isOwner: true,
    intent,
    reasonCode: "owner_authorized",
  };
}

/**
 * Lightweight helper: does this comment text look like an adoption attempt worth evaluating?
 * Used to avoid treating every owner comment as an authorization event.
 */
export function commentMayExpressOwnerDecision(rawBody: string | null | undefined): boolean {
  const intent = parseGithubOwnerIntent(rawBody);
  return (
    intent.kind === "affirmative" ||
    intent.kind === "negative" ||
    intent.kind === "defer" ||
    intent.kind === "question"
  );
}

// ─── Phase 1 exact command grammar (CMD-03) ──────────────────────────────────

const COMMAND_PHRASES: Array<{
  command: GithubOwnerCommandKind;
  re: RegExp;
  phrase: string;
}> = [
  // Longer / multi-word first.
  { command: "re_evaluate", re: /^重新评估$/, phrase: "重新评估" },
  { command: "re_evaluate", re: /^重新评估[。.!！]?$/, phrase: "重新评估" },
  { command: "re_evaluate", re: /^re[-_]?evaluate$/i, phrase: "re-evaluate" },
  { command: "re_evaluate", re: /^reevaluate$/i, phrase: "reevaluate" },
  { command: "status", re: /^状态$/, phrase: "状态" },
  { command: "status", re: /^状态[。.!！]?$/, phrase: "状态" },
  { command: "status", re: /^status$/i, phrase: "status" },
  { command: "pause", re: /^暂停$/, phrase: "暂停" },
  { command: "pause", re: /^暂停[。.!！]?$/, phrase: "暂停" },
  { command: "pause", re: /^pause$/i, phrase: "pause" },
  { command: "continue", re: /^继续$/, phrase: "继续" },
  { command: "continue", re: /^继续[。.!！]?$/, phrase: "继续" },
  { command: "continue", re: /^continue$/i, phrase: "continue" },
  { command: "continue", re: /^resume$/i, phrase: "resume" },
  { command: "adopt", re: /^采纳$/, phrase: "采纳" },
  { command: "adopt", re: /^采纳[。.!！]?$/, phrase: "采纳" },
  { command: "adopt", re: /^开始实现$/, phrase: "开始实现" },
  { command: "adopt", re: /^可以做$/, phrase: "可以做" },
  { command: "adopt", re: /^批准$/, phrase: "批准" },
  { command: "adopt", re: /^go\s*ahead$/i, phrase: "go ahead" },
  { command: "adopt", re: /^lgtm$/i, phrase: "lgtm" },
  { command: "adopt", re: /^approved?$/i, phrase: "approve" },
  { command: "adopt", re: /^accept(?:ed)?$/i, phrase: "accept" },
];

function matchAnchoredCommand(
  residual: string,
): { command: GithubOwnerCommandKind; phrase: string } | null {
  const text = residual.trim().replace(/[。.!！]+$/u, "").trim();
  if (!text) return null;
  // Single-token / short phrase only — reject free-form tails.
  if (/\s/.test(text) && !/^(go\s+ahead)$/i.test(text)) {
    // Allow short multi-word adopt phrases only.
    if (!/^(go\s+ahead|please\s+implement|ship\s+it)$/i.test(text)) {
      // Still allow Chinese commands that are exact single phrases without spaces.
      // Multi-word with spaces: only the English allowlist above.
      return null;
    }
  }
  for (const item of COMMAND_PHRASES) {
    if (item.re.test(text) || item.re.test(residual.trim())) {
      return { command: item.command, phrase: item.phrase };
    }
  }
  // Fallback: bare affirmative adopt words via existing intent (no target required path).
  return null;
}

function stripCommandTarget(
  normalized: string,
  appBotLogin: string | null | undefined,
): {
  residual: string;
  target: GithubOwnerCommandTargetKind;
} {
  const lines = normalized
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return { residual: "", target: "none" };
  }

  // Prefer first non-empty line for slash / mention targeting.
  const first = lines[0] ?? "";

  // Leading /ypi (case-insensitive)
  const slash = first.match(/^\/ypi(?:@[^\s]+)?(?:\s+|$)(.*)$/i);
  if (slash) {
    const restFirst = (slash[1] ?? "").trim();
    const residual = [restFirst, ...lines.slice(1)].join("\n").trim();
    return { residual, target: "ypi_slash" };
  }

  // @AppBot mention — optional configured login, else generic @...[bot] or literal @AppBot.
  const login =
    typeof appBotLogin === "string" && appBotLogin.trim()
      ? appBotLogin.trim().replace(/^@/, "")
      : null;
  const mentionPattern = login
    ? new RegExp(
        `^@${login.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b(?:\\s+|$)([\\s\\S]*)$`,
        "i",
      )
    : /^@(?:AppBot|[A-Za-z0-9_-]+\[bot\])\b(?:\s+|$)([\s\S]*)$/i;

  // Mention may appear on any line (prototype allows prose then @AppBot 采纳).
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const m = line.match(mentionPattern);
    if (m) {
      const restThis = (m[1] ?? "").trim();
      const residual = [restThis, ...lines.slice(i + 1)].join("\n").trim();
      return { residual, target: "app_bot_mention" };
    }
  }

  return { residual: normalized.trim(), target: "none" };
}

/**
 * Pure Phase 1 command parser over stripped text.
 * Returns enum command only — never residual free text for agent injection.
 *
 * Targeting:
 * - @AppBot / configured app bot login
 * - leading /ypi
 * - legacy awaiting-owner adoption without mention (allowLegacyAdoption)
 */
export function parseGithubOwnerCommand(
  rawBody: string | null | undefined,
  options?: {
    appBotLogin?: string | null;
    /** When true, bare affirmative adoption is accepted without @AppBot//ypi. */
    allowLegacyAdoption?: boolean;
  },
): GithubOwnerCommandParseResult {
  if (typeof rawBody !== "string" || !rawBody.trim()) {
    return {
      disposition: "empty",
      command: null,
      target: "none",
      matchedPhrase: null,
      normalizedText: "",
      unsupportedTargeted: false,
    };
  }

  const normalizedText = stripUntrustedCommentDecorations(rawBody);
  if (!normalizedText) {
    return {
      disposition: "empty",
      command: null,
      target: "none",
      matchedPhrase: null,
      normalizedText: "",
      unsupportedTargeted: false,
    };
  }

  // Negation / question on full text win before command matching.
  const negative = firstMatch(normalizedText, NEGATIVE_PHRASES);
  if (negative) {
    return {
      disposition: "no_command",
      command: null,
      target: "none",
      matchedPhrase: negative,
      normalizedText,
      unsupportedTargeted: false,
    };
  }
  if (looksLikeQuestion(normalizedText)) {
    return {
      disposition: "no_command",
      command: null,
      target: "none",
      matchedPhrase: null,
      normalizedText,
      unsupportedTargeted: false,
    };
  }

  const stripped = stripCommandTarget(normalizedText, options?.appBotLogin);
  if (stripped.target !== "none") {
    const matched = matchAnchoredCommand(stripped.residual);
    if (matched) {
      return {
        disposition: "command",
        command: matched.command,
        target: stripped.target,
        matchedPhrase: matched.phrase,
        normalizedText,
        unsupportedTargeted: false,
      };
    }
    // Targeted but residual empty or unknown → unsupported (owner gets receipt).
    if (!stripped.residual.trim()) {
      return {
        disposition: "unsupported",
        command: null,
        target: stripped.target,
        matchedPhrase: null,
        normalizedText,
        unsupportedTargeted: true,
      };
    }
    return {
      disposition: "unsupported",
      command: null,
      target: stripped.target,
      matchedPhrase: null,
      normalizedText,
      unsupportedTargeted: true,
    };
  }

  // No target: legacy awaiting-owner adoption only when enabled.
  if (options?.allowLegacyAdoption) {
    const intent = parseGithubOwnerIntent(rawBody);
    if (intent.isAffirmative) {
      return {
        disposition: "command",
        command: "adopt",
        target: "legacy_awaiting_owner",
        matchedPhrase: intent.matchedPhrase,
        normalizedText,
        unsupportedTargeted: false,
      };
    }
  }

  return {
    disposition: "no_command",
    command: null,
    target: "none",
    matchedPhrase: null,
    normalizedText,
    unsupportedTargeted: false,
  };
}

/**
 * Durable opaque command key for one comment version + command enum.
 * Never includes body text — only ids + opaque hash + command.
 */
export function buildGithubOwnerCommandKey(parts: {
  repositoryId: number;
  issueNumber: number;
  generation: number;
  commentId: number;
  bodySha256: string;
  command: GithubOwnerCommandKind | "unsupported";
}): string {
  const material = [
    String(parts.repositoryId),
    String(parts.issueNumber),
    String(parts.generation),
    String(parts.commentId),
    parts.bodySha256,
    parts.command,
  ].join("|");
  return createHash("sha256").update(material, "utf8").digest("hex");
}

export function githubOwnerCommandLabel(
  command: GithubOwnerCommandKind | null,
): string {
  switch (command) {
    case "status":
      return "状态";
    case "re_evaluate":
      return "重新评估";
    case "adopt":
      return "采纳";
    case "pause":
      return "暂停";
    case "continue":
      return "继续";
    default:
      return "（未识别）";
  }
}
