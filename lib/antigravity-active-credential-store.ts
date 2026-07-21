/**
 * CredentialStore decorator that makes the managed Antigravity Active slot the
 * authority for ModelRuntime OAuth refreshes.
 *
 * Only file-backed WebCredentialStores may be coordinated. Account lifecycle
 * code keeps using the raw store while it owns the Antigravity provider lock,
 * preventing a provider-lock -> provider-lock nested acquisition.
 *
 * Composition: wrap after the Grok decorator so each provider only intercepts
 * its own id and both use the same raw WebCredentialStore for slot transactions.
 */

import type { Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";
import { withAntigravityProviderLock } from "./antigravity-account-lock";
import {
  commitAntigravityCredentialUnderLock,
  readAntigravityActiveSnapshot,
  readAntigravityActiveSnapshotUnderLock,
} from "./antigravity-credential-transaction";
import { ANTIGRAVITY_PROVIDER_ID } from "./oauth-account-providers";
import type { WebCredentialStore } from "./web-credential-store";

const coordinatedStoreMarker = Symbol("antigravityCoordinatedCredentialStore");

type MarkedCredentialStore = CredentialStore & {
  [coordinatedStoreMarker]?: true;
};

function isCredential(value: unknown): value is Credential {
  return typeof value === "object" && value !== null
    && "type" in value
    && ((value as { type?: unknown }).type === "oauth" || (value as { type?: unknown }).type === "api_key");
}

class AntigravityCoordinatedCredentialStore implements CredentialStore {
  readonly [coordinatedStoreMarker] = true;

  constructor(
    /** Raw file-backed store used for slot-first transactions. */
    private readonly raw: WebCredentialStore,
    /** Next store in the decorator chain (Grok coordinated or raw). */
    private readonly next: CredentialStore,
  ) {}

  async read(providerId: string): Promise<Credential | undefined> {
    if (providerId !== ANTIGRAVITY_PROVIDER_ID) return this.next.read(providerId);

    // Optimistic read: ModelRuntime calls modify after it observes expiry, and
    // modify re-reads this same slot under the provider lock before refreshing.
    const snapshot = await readAntigravityActiveSnapshot(this.raw);
    return snapshot?.credential ?? this.next.read(providerId);
  }

  async list(): Promise<readonly CredentialInfo[]> {
    return this.next.list();
  }

  async modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    if (providerId !== ANTIGRAVITY_PROVIDER_ID) return this.next.modify(providerId, fn);

    return withAntigravityProviderLock(async () => {
      // Lock-time reread is the double-check boundary: a waiting resolver sees
      // the first refresh's slot rather than stale auth.json.
      const snapshot = await readAntigravityActiveSnapshotUnderLock(this.raw);
      if (!snapshot) {
        // There is no managed Active slot yet. Retain the raw auth.json path for
        // first-login compatibility; account reconciliation establishes a slot.
        return this.raw.modify(providerId, fn);
      }

      const next = await fn(snapshot.credential);
      if (next === undefined) return snapshot.credential;
      if (!isCredential(next) || next.type !== "oauth") {
        throw new Error("Antigravity credential modify produced an invalid OAuth credential");
      }

      // Slot write is durable before auth.json. If the mirror fails, let the
      // error surface without ever restoring the old rotating refresh token.
      await commitAntigravityCredentialUnderLock({
        rawStore: this.raw,
        storageId: snapshot.storageId,
        credential: next,
      });
      return next;
    });
  }

  delete(providerId: string): Promise<void> {
    return this.next.delete(providerId);
  }
}

/**
 * Wrap a raw file-backed WebCredentialStore (optionally already Grok-wrapped)
 * for ModelRuntime use. `next` receives non-Antigravity provider traffic.
 */
export function createAntigravityCoordinatedCredentialStore(
  raw: WebCredentialStore,
  next: CredentialStore = raw,
): CredentialStore {
  return new AntigravityCoordinatedCredentialStore(raw, next);
}

export function isAntigravityCoordinatedCredentialStore(store: CredentialStore): boolean {
  return (store as MarkedCredentialStore)[coordinatedStoreMarker] === true;
}
