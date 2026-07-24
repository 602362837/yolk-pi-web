/**
 * github-owner-intent — authenticate owner actor, then parse affirmative adoption (GHA-03).
 *
 * Product rules:
 * - Owner identity is checked BEFORE broad natural-language parsing.
 * - User-owned repos: sender id must equal repository.owner.id.
 * - Org-owned repos: sender id must be in explicit ownerActorIds.
 * - Bots never authorize.
 * - Strip quote / fenced code / HTML comments before intent matching.
 * - Only clear affirmative language authorizes; negation / defer / question do not.
 * - Incomplete claim must never produce ownerAuthorization for implementation.
 * - P0 records accepted_waiting_automation only — never creates WorkTree here.
 */

import type { GithubAutomationRepositoryConfig } from "./github-automation-types";

// ─── Types ───────────────────────────────────────────────────────────────────

export type GithubOwnerIntentKind =
  | "affirmative"
  | "negative"
  | "defer"
  | "question"
  | "unclear"
  | "empty";

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
