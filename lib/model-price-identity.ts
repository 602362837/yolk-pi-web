/**
 * Model identity normalization for third-party / routed provider IDs.
 *
 * Goal: turn aliases like `cpa/claude-opus-4-6-thinking` or `any/gpt-5.5`
 * into stable vendor + family + version tokens that can match public catalogs.
 *
 * Pure functions only — no network, no filesystem.
 */

export interface ModelIdentity {
  /** Original provider string from the registry. */
  provider: string;
  /** Original model id from the registry. */
  model: string;
  /** Optional display name. */
  displayName?: string;
  /** Inferred official vendor (openai/anthropic/google/...) when known. */
  inferredVendor: string | null;
  /** Core model id after stripping routing/thinking/date suffixes. */
  coreModelId: string;
  /** Compact token used for fuzzy comparison (letters/digits only, lowercased). */
  compactKey: string;
  /** Human-readable match labels used in UI/evidence. */
  candidateKeys: string[];
  /** Deterministic notes describing what was stripped/inferred. */
  reasons: string[];
}

const VENDOR_FROM_PREFIX: Record<string, string> = {
  openai: "openai",
  anthropic: "anthropic",
  google: "google",
  gemini: "google",
  deepseek: "deepseek",
  meta: "meta-llama",
  "meta-llama": "meta-llama",
  llama: "meta-llama",
  mistral: "mistralai",
  mistralai: "mistralai",
  cohere: "cohere",
  qwen: "qwen",
  alibaba: "qwen",
  xai: "x-ai",
  "x-ai": "x-ai",
  grok: "x-ai",
  moonshot: "moonshotai",
  kimi: "moonshotai",
  zhipu: "z-ai",
  glm: "z-ai",
};

/** Tokens that usually indicate the official model family inside a free-form id. */
const FAMILY_HINTS: Array<{ re: RegExp; vendor: string }> = [
  { re: /\bclaude\b/i, vendor: "anthropic" },
  { re: /\bgpt\b/i, vendor: "openai" },
  { re: /\bo[1-9]\b/i, vendor: "openai" },
  { re: /\bgemini\b/i, vendor: "google" },
  { re: /\bdeepseek\b/i, vendor: "deepseek" },
  { re: /\bllama\b/i, vendor: "meta-llama" },
  { re: /\bmistral\b/i, vendor: "mistralai" },
  { re: /\bcommand[-_]?r\b/i, vendor: "cohere" },
  { re: /\bqwen\b/i, vendor: "qwen" },
  { re: /\bgrok\b/i, vendor: "x-ai" },
  { re: /\bkimi\b/i, vendor: "moonshotai" },
  { re: /\bglm\b/i, vendor: "z-ai" },
];

/** Suffix / routing noise commonly appended by proxies and custom providers. */
const STRIP_SUFFIX_RE =
  /(?:^|[-_.:])(?:thinking|think|reasoning|reason|high|medium|low|mini|nano|lite|flash|pro|max|image|vision|audio|video|search|tools?|router|proxy|free|paid|beta|preview|exp|experimental|latest|stable|fast|slow|turbo|chat|instruct|it)(?=$|[-_.:])/gi;

const STRIP_DATE_RE = /(?:^|[-_.:])(?:20\d{2}[-_.]?\d{2}[-_.]?\d{2}|20\d{6})(?=$|[-_.:])/g;

const STRIP_PROVIDER_PREFIX_RE =
  /^(?:aitob[-_]?|cpa[-_]?|any[-_]?|openrouter[-_]?|router[-_]?|proxy[-_]?|custom[-_]?)(?:claude|oai|openai|anthropic|google|gemini|deepseek)?[-_]?/i;

function collapseSeparators(value: string): string {
  return value
    .toLowerCase()
    .replace(/[/:|]+/g, "-")
    .replace(/[_\s.]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function compactKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function inferVendorFromText(text: string): string | null {
  const lower = text.toLowerCase();
  for (const [key, vendor] of Object.entries(VENDOR_FROM_PREFIX)) {
    if (lower === key || lower.startsWith(`${key}/`) || lower.startsWith(`${key}-`)) {
      return vendor;
    }
  }
  for (const hint of FAMILY_HINTS) {
    if (hint.re.test(text)) return hint.vendor;
  }
  return null;
}

/**
 * Strip known routing/noise tokens while preserving model family + major version.
 */
export function stripModelNoise(modelId: string): { cleaned: string; reasons: string[] } {
  const reasons: string[] = [];
  let cleaned = modelId.trim();

  // Drop accidental provider/model composites like "openai/gpt-4o"
  if (cleaned.includes("/")) {
    const parts = cleaned.split("/").filter(Boolean);
    if (parts.length >= 2) {
      cleaned = parts[parts.length - 1]!;
      reasons.push("removed embedded provider path");
    }
  }

  const beforePrefix = cleaned;
  cleaned = cleaned.replace(STRIP_PROVIDER_PREFIX_RE, "");
  if (cleaned !== beforePrefix) reasons.push("removed custom provider prefix");

  const beforeDate = cleaned;
  cleaned = cleaned.replace(STRIP_DATE_RE, "");
  if (cleaned !== beforeDate) reasons.push("removed date suffix");

  // Iteratively strip known noise suffixes (thinking, high/low, image, etc.)
  let guard = 0;
  while (guard < 8) {
    const next = cleaned.replace(STRIP_SUFFIX_RE, "");
    if (next === cleaned) break;
    cleaned = next;
    guard += 1;
  }
  if (guard > 0) reasons.push("removed routing/mode suffixes");

  cleaned = collapseSeparators(cleaned);
  if (!cleaned) cleaned = collapseSeparators(modelId);

  return { cleaned, reasons };
}

/**
 * Build a normalized identity for pricing match attempts.
 */
export function normalizeModelIdentity(
  provider: string,
  model: string,
  displayName?: string,
): ModelIdentity {
  const reasons: string[] = [];
  const providerClean = provider.trim();
  const modelClean = model.trim();
  const display = displayName?.trim() || undefined;

  const fromProvider = inferVendorFromText(providerClean);
  const fromModel = inferVendorFromText(modelClean);
  const fromDisplay = display ? inferVendorFromText(display) : null;
  const inferredVendor = fromModel ?? fromDisplay ?? fromProvider;

  if (fromModel) reasons.push(`inferred vendor from model name: ${fromModel}`);
  else if (fromDisplay) reasons.push(`inferred vendor from display name: ${fromDisplay}`);
  else if (fromProvider) reasons.push(`inferred vendor from provider: ${fromProvider}`);
  else reasons.push("vendor unknown; matching by model tokens only");

  const stripped = stripModelNoise(modelClean);
  reasons.push(...stripped.reasons);

  const coreModelId = stripped.cleaned;
  const compact = compactKey(coreModelId);

  const candidateKeys = new Set<string>();
  candidateKeys.add(coreModelId);
  candidateKeys.add(compact);
  if (inferredVendor) {
    candidateKeys.add(`${inferredVendor}/${coreModelId}`);
    candidateKeys.add(`${inferredVendor}${coreModelId}`);
  }
  if (display) {
    const displayStripped = stripModelNoise(display);
    candidateKeys.add(displayStripped.cleaned);
    candidateKeys.add(compactKey(displayStripped.cleaned));
  }

  // Also keep a version-tolerant compact form: collapse consecutive digits groups lightly
  // e.g. claudeopus46 / claudeopus4.6 / claude-opus-4-6
  const digitSoft = compact.replace(/(\d)\./g, "$1");
  if (digitSoft) candidateKeys.add(digitSoft);

  return {
    provider: providerClean,
    model: modelClean,
    displayName: display,
    inferredVendor,
    coreModelId,
    compactKey: compact,
    candidateKeys: [...candidateKeys].filter(Boolean),
    reasons,
  };
}

/**
 * Score how well a catalog entry id/name matches a normalized identity.
 * Higher is better. 0 means no useful match.
 */
function familyPrefix(compact: string): string {
  const m = compact.match(/^(claude|gpt|o[1-9]|gemini|deepseek|llama|mistral|qwen|grok|kimi|glm|commandr)/);
  return m?.[1] ?? compact.slice(0, Math.min(8, compact.length));
}

export function scoreCatalogMatch(
  identity: ModelIdentity,
  entryId: string,
  entryName?: string,
): number {
  const entryCore = stripModelNoise(entryId.includes("/") ? entryId.split("/").slice(1).join("/") : entryId).cleaned;
  const entryCompact = compactKey(entryCore);
  const entryFullCompact = compactKey(entryId);
  const nameCompact = entryName ? compactKey(stripModelNoise(entryName).cleaned) : "";

  let score = 0;
  const idCompact = identity.compactKey;

  if (idCompact && entryCompact === idCompact) score += 100;
  else if (idCompact && entryFullCompact.endsWith(idCompact)) score += 90;
  else if (idCompact && entryCompact.includes(idCompact)) score += 70;
  else if (idCompact && idCompact.includes(entryCompact) && entryCompact.length >= 6) score += 75;
  else if (nameCompact && idCompact && nameCompact.includes(idCompact)) score += 60;
  else if (nameCompact && idCompact && idCompact.includes(nameCompact) && nameCompact.length >= 6) {
    score += 55;
  } else if (idCompact && entryCompact) {
    const a = idCompact;
    const b = entryCompact || entryFullCompact;
    if (a.length >= 6 && b.length >= 6) {
      const shorter = a.length <= b.length ? a : b;
      const longer = a.length <= b.length ? b : a;
      if (longer.includes(shorter)) score += 50;
    }
    // Same model family with different minor version still useful.
    if (familyPrefix(a) && familyPrefix(a) === familyPrefix(b)) {
      score += 45;
    }
  }

  if (identity.inferredVendor) {
    const vendor = identity.inferredVendor.toLowerCase();
    const entryVendor = entryId.split("/")[0]?.toLowerCase() ?? "";
    if (entryVendor === vendor || entryId.toLowerCase().startsWith(`${vendor}/`)) {
      score += 25;
    } else if (entryVendor && vendor && entryVendor !== vendor) {
      score -= 20;
    }
  }

  // Prefer entries that still look like the same major version digits.
  const idDigits = idCompact.match(/\d+/g)?.join("") ?? "";
  const entryDigits = entryCompact.match(/\d+/g)?.join("") ?? "";
  if (idDigits && entryDigits) {
    if (idDigits === entryDigits) score += 15;
    else if (entryDigits.startsWith(idDigits) || idDigits.startsWith(entryDigits)) score += 10;
    else if (idDigits[0] && idDigits[0] === entryDigits[0]) score += 5;
  }

  return score;
}
