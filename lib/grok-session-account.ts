/**
 * grok-session-account — deprecated session pin helpers + active account lookup
 *
 * Session Authorization pinning is retired. Main inference uses the global
 * Active Grok account via auth.json and live reload after Activate/failover.
 *
 * Kept for compatibility:
 * - `getActiveGrokAccountId()` — used by quota and failover adapters
 * - `readGrokSessionAccountFromHeader()` — historical header parsing only
 * - bind/unbind/restore helpers remain callable but are no longer wired into
 *   main inference / resume / fork / Studio child paths
 *
 * Historical `SessionHeader.grokAccountStorageId` is deprecated and ignored
 * at runtime; JSONL files are never rewritten.
 *
 * ## Security
 *
 * Only opaque storage ids (the file-system key) are stored; no tokens,
 * account ids, or credentials.
 */

import { readFileSync, writeFileSync } from "node:fs";
import type { SessionHeader } from "./types";
import { GROK_CLI_PROVIDER_ID, isSupportedOAuthAccountProvider } from "./oauth-account-providers";
import { listOAuthAccounts } from "./oauth-accounts";
import { invalidateGrokTokenFlight } from "./grok-account-token";

// ─── Runtime registry ────────────────────────────────────────────────────────

/** sessionId → opaque grok storage id */
const sessionBindings = new Map<string, string>();

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Read the first line of a JSONL session file and return the header object,
 * or null if the file does not exist or the header is invalid.
 */
function readSessionHeaderFromFile(filePath: string): SessionHeader | null {
  try {
    const firstLine = readFileSync(filePath, "utf8").split("\n")[0];
    const header = JSON.parse(firstLine) as SessionHeader;
    return header?.type === "session" ? header : null;
  } catch {
    return null;
  }
}

/**
 * Write an additive grokAccountStorageId field into the session JSONL header
 * without reordering or mutating existing fields.
 */
function writeGrokAccountToHeaderFile(filePath: string, storageId: string): void {
  try {
    const content = readFileSync(filePath, "utf8");
    const newlineIndex = content.indexOf("\n");
    const firstLine = newlineIndex >= 0 ? content.slice(0, newlineIndex) : content;
    const rest = newlineIndex >= 0 ? content.slice(newlineIndex) : "\n";
    const header = JSON.parse(firstLine) as SessionHeader;
    if (header.type !== "session") return;
    header.grokAccountStorageId = storageId;
    writeFileSync(filePath, `${JSON.stringify(header)}${rest}`, "utf8");
  } catch {
    // Best-effort; the binding is already in the runtime registry.
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Register a session-account binding in the runtime registry and, if a
 * sessionFile is provided, persist it to the JSONL header.
 */
export function bindGrokSessionAccount(
  sessionId: string,
  storageId: string,
  sessionFile?: string,
): void {
  if (!storageId.trim()) return;
  sessionBindings.set(sessionId, storageId);
  if (sessionFile) {
    writeGrokAccountToHeaderFile(sessionFile, storageId);
  }
}

/**
 * Remove a session-account binding from the runtime registry and cancel
 * any in-flight token refresh for the bound account.
 */
export function unbindGrokSessionAccount(sessionId: string): void {
  const storageId = sessionBindings.get(sessionId);
  sessionBindings.delete(sessionId);
  if (storageId) invalidateGrokTokenFlight(storageId);
}

/**
 * Look up the Grok storage id bound to `sessionId` in the runtime registry.
 */
export function getGrokSessionAccount(sessionId: string): string | undefined {
  return sessionBindings.get(sessionId);
}

/**
 * Read the grokAccountStorageId from a session JSONL file header without
 * registering it in the runtime registry.  Returns undefined if the file
 * does not exist or the header has no binding.
 */
export function readGrokSessionAccountFromHeader(filePath: string): string | undefined {
  if (!filePath) return undefined;
  const header = readSessionHeaderFromFile(filePath);
  const id = header?.grokAccountStorageId?.trim();
  return id || undefined;
}

/**
 * Get the currently active Grok account storage id, or null if no active
 * account exists or the provider is not supported.
 */
export async function getActiveGrokAccountId(): Promise<string | null> {
  if (!isSupportedOAuthAccountProvider(GROK_CLI_PROVIDER_ID)) return null;
  try {
    const list = await listOAuthAccounts(GROK_CLI_PROVIDER_ID);
    return list.activeAccountId;
  } catch {
    return null;
  }
}

/**
 * Restore a session's Grok account binding from its JSONL header into the
 * runtime registry.  No-op if the header has no binding or the file does
 * not exist.
 */
export function restoreGrokSessionAccountBinding(
  sessionId: string,
  sessionFile?: string,
): void {
  if (!sessionFile) return;
  const storageId = readGrokSessionAccountFromHeader(sessionFile);
  if (storageId) {
    sessionBindings.set(sessionId, storageId);
  }
}
