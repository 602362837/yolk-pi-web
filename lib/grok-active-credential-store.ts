/**
 * CredentialStore decorator that makes the managed Grok Active slot the
 * authority for ModelRuntime OAuth refreshes.
 *
 * Only file-backed WebCredentialStores may be wrapped. Account lifecycle code
 * keeps using the raw store while it owns the Grok provider lock, preventing a
 * provider-lock -> provider-lock nested acquisition.
 */

import type { Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";
import { withGrokProviderLock } from "./grok-account-lock";
import { GROK_CLI_PROVIDER_ID } from "./oauth-account-providers";
import {
  commitGrokCredentialUnderLock,
  readGrokActiveSnapshot,
  readGrokActiveSnapshotUnderLock,
} from "./grok-credential-transaction";
import type { WebCredentialStore } from "./web-credential-store";

const coordinatedStoreMarker = Symbol("grokCoordinatedCredentialStore");

type MarkedCredentialStore = CredentialStore & {
  [coordinatedStoreMarker]?: true;
};

function isCredential(value: unknown): value is Credential {
  return typeof value === "object" && value !== null
    && "type" in value
    && ((value as { type?: unknown }).type === "oauth" || (value as { type?: unknown }).type === "api_key");
}

class GrokCoordinatedCredentialStore implements CredentialStore {
  readonly [coordinatedStoreMarker] = true;

  constructor(private readonly raw: WebCredentialStore) {}

  async read(providerId: string): Promise<Credential | undefined> {
    if (providerId !== GROK_CLI_PROVIDER_ID) return this.raw.read(providerId);

    // Optimistic read: ModelRuntime calls modify after it observes expiry, and
    // modify re-reads this same slot under the provider lock before refreshing.
    const snapshot = await readGrokActiveSnapshot(this.raw);
    return snapshot?.credential ?? this.raw.read(providerId);
  }

  async list(): Promise<readonly CredentialInfo[]> {
    return this.raw.list();
  }

  async modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    if (providerId !== GROK_CLI_PROVIDER_ID) return this.raw.modify(providerId, fn);

    return withGrokProviderLock(async () => {
      // Lock-time reread is the GPT-style double-check boundary: a waiting
      // resolver sees the first refresh's slot rather than stale auth.json.
      const snapshot = await readGrokActiveSnapshotUnderLock(this.raw);
      if (!snapshot) {
        // There is no managed Active slot yet. Retain the raw auth.json path for
        // first-login compatibility; account reconciliation establishes a slot.
        return this.raw.modify(providerId, fn);
      }

      const next = await fn(snapshot.credential);
      if (next === undefined) return snapshot.credential;
      if (!isCredential(next) || next.type !== "oauth") {
        throw new Error("Grok credential modify produced an invalid OAuth credential");
      }

      // Slot write is durable before auth.json. If the mirror fails, let the
      // error surface without ever restoring the old rotating refresh token.
      await commitGrokCredentialUnderLock({
        rawStore: this.raw,
        storageId: snapshot.storageId,
        credential: next,
      });
      return next;
    });
  }

  delete(providerId: string): Promise<void> {
    return this.raw.delete(providerId);
  }
}

/** Wrap a raw file-backed WebCredentialStore once for ModelRuntime use. */
export function createGrokCoordinatedCredentialStore(raw: WebCredentialStore): CredentialStore {
  return new GrokCoordinatedCredentialStore(raw);
}

export function isGrokCoordinatedCredentialStore(store: CredentialStore): boolean {
  return (store as MarkedCredentialStore)[coordinatedStoreMarker] === true;
}
