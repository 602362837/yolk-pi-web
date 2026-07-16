/**
 * kiro-account-token unit + production-path race tests
 *
 * 1) Inline isolation contracts (single-flight, 0600, CAS semantics).
 * 2) Production-path shared provider lock race: concurrent real
 *    getKiroAccessToken (via registered OAuth fixture) vs real
 *    activateOAuthAccount() cannot overwrite the new Active mirror.
 * 3) Source contract: no Turbopack-rejected package.json export subpath and
 *    no proper-lockfile static resolution in the cold Auth graph.
 */

import { ok, rejects, strictEqual } from "node:assert";
import { chmod, mkdtemp, readFile, rm, writeFile, mkdir, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

type AccessToken = {
  accessToken: string;
  refreshed: boolean;
  expiresAt: number;
};

async function atomicWriteJson(dir: string, filename: string, data: unknown): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const target = join(dir, filename);
  const tmp = `${target}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(tmp, target);
  await chmod(target, 0o600).catch(() => {});
}

/** Simple process-local mutex used by the inlined unit-test implementation. */
function createProcessMutex() {
  let lock: Promise<void> | null = null;
  return async function withLock<T>(fn: () => Promise<T>): Promise<T> {
    while (lock) await lock.catch(() => {});
    let release!: () => void;
    lock = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      return await fn();
    } finally {
      release();
      lock = null;
    }
  };
}

async function getKiroAccessTokenImpl(
  storageId: string,
  agentDir: string,
  opts: {
    minValidityMs?: number;
    forceRefresh?: boolean;
    refresh: (credential: Record<string, unknown>) => Promise<{ apiKey: string; newCredentials: Record<string, unknown> }>;
    getActiveStorageId: () => Promise<string | null>;
    mirrorActive: (credential: Record<string, unknown>) => Promise<void>;
    withLock?: <T>(fn: () => Promise<T>) => Promise<T>;
  },
  inflight: Map<string, Promise<AccessToken>>,
): Promise<AccessToken> {
  const { minValidityMs = 120_000, forceRefresh = false } = opts;
  if (!storageId.trim()) throw new Error("kiroAccountStorageId is required");

  const key = `kiro:${storageId}`;
  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = (async (): Promise<AccessToken> => {
    try {
      const kiroDir = join(agentDir, "auth-accounts", "kiro");
      const credPath = join(kiroDir, `${encodeURIComponent(storageId)}.json`);
      const raw = JSON.parse(await readFile(credPath, "utf8")) as unknown;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error(`Kiro saved account credential is invalid: ${storageId}`);
      }
      const credential = raw as Record<string, unknown>;
      const access = typeof credential.access === "string" ? credential.access.trim() : "";
      const expires = typeof credential.expires === "number" ? credential.expires : 0;
      const needsRefresh = forceRefresh || !access || Date.now() >= expires - minValidityMs;
      if (!needsRefresh) {
        return { accessToken: access, refreshed: false, expiresAt: expires };
      }

      const runLocked = opts.withLock ?? createProcessMutex();

      // Provider lock + re-read + Active CAS under lock (mirrors production).
      return await runLocked(async () => {
        const lockedRaw = JSON.parse(await readFile(credPath, "utf8")) as unknown;
        if (!lockedRaw || typeof lockedRaw !== "object" || Array.isArray(lockedRaw)) {
          throw new Error(`Kiro saved account credential is invalid: ${storageId}`);
        }
        const locked = lockedRaw as Record<string, unknown>;
        const lockedAccess = typeof locked.access === "string" ? locked.access.trim() : "";
        const lockedExpires = typeof locked.expires === "number" ? locked.expires : 0;
        const stillNeedsRefresh =
          forceRefresh || !lockedAccess || Date.now() >= lockedExpires - minValidityMs;
        if (!stillNeedsRefresh) {
          return { accessToken: lockedAccess, refreshed: false, expiresAt: lockedExpires };
        }

        const result = await opts.refresh(locked);
        await atomicWriteJson(
          kiroDir,
          `${encodeURIComponent(storageId)}.json`,
          result.newCredentials,
        );

        // Active-mirror compare-and-set under the lock: re-read Active.
        const activeId = await opts.getActiveStorageId();
        if (activeId === storageId) {
          await opts.mirrorActive(result.newCredentials);
        }

        return {
          accessToken: result.apiKey,
          refreshed: true,
          expiresAt: typeof result.newCredentials.expires === "number"
            ? result.newCredentials.expires
            : Date.now() + 3_600_000,
        };
      });
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

async function main(): Promise<void> {
  const agentDir = await mkdtemp(join(tmpdir(), "ypi-kiro-token-"));
  const inflight = new Map<string, Promise<AccessToken>>();
  let refreshCalls = 0;
  let activeStorageId = "acct_active";
  let authMirror: Record<string, unknown> = {};

  const refresh = async (credential: Record<string, unknown>) => {
    refreshCalls += 1;
    // Simulate a slow upstream so concurrent callers share one flight / wait on lock.
    await new Promise((resolve) => setTimeout(resolve, 40));
    return {
      apiKey: `refreshed-access-${refreshCalls}`,
      newCredentials: {
        ...credential,
        access: `refreshed-access-${refreshCalls}`,
        expires: Date.now() + 3_600_000,
      },
    };
  };

  try {
    const kiroDir = join(agentDir, "auth-accounts", "kiro");
    await mkdir(kiroDir, { recursive: true, mode: 0o700 });

    await atomicWriteJson(kiroDir, `${encodeURIComponent("acct_active")}.json`, {
      access: "active-access",
      refresh: "active-refresh",
      expires: Date.now() + 3_600_000,
      clientId: "client-active",
      clientSecret: "secret-active",
      region: "us-east-1",
      authMethod: "builder-id",
    });
    await atomicWriteJson(kiroDir, `${encodeURIComponent("acct_inactive")}.json`, {
      access: "inactive-access",
      refresh: "inactive-refresh",
      expires: Date.now() + 3_600_000,
      clientId: "client-inactive",
      clientSecret: "secret-inactive",
      region: "us-west-2",
      authMethod: "builder-id",
    });

    // accounts.json used by production Active re-read path.
    await atomicWriteJson(kiroDir, "accounts.json", {
      version: 2,
      activeAccountId: "acct_active",
      accounts: [
        { accountId: "acct_active", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        { accountId: "acct_inactive", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      ],
    });

    const opts = {
      refresh,
      getActiveStorageId: async () => activeStorageId,
      mirrorActive: async (credential: Record<string, unknown>) => {
        authMirror = { ...credential, type: "oauth" as const };
      },
    };

    // Valid token should not refresh.
    refreshCalls = 0;
    const cached = await getKiroAccessTokenImpl("acct_active", agentDir, opts, inflight);
    strictEqual(cached.accessToken, "active-access");
    strictEqual(cached.refreshed, false);
    strictEqual(refreshCalls, 0);

    // forceRefresh refreshes even when still valid and preserves Builder metadata.
    const forced = await getKiroAccessTokenImpl("acct_active", agentDir, { ...opts, forceRefresh: true }, inflight);
    strictEqual(forced.refreshed, true);
    strictEqual(forced.accessToken, "refreshed-access-1");
    strictEqual(refreshCalls, 1);
    strictEqual(authMirror.clientSecret, "secret-active");
    strictEqual(authMirror.region, "us-east-1");
    strictEqual(authMirror.access, "refreshed-access-1");

    const activeCred = JSON.parse(
      await readFile(join(kiroDir, `${encodeURIComponent("acct_active")}.json`), "utf8"),
    ) as Record<string, unknown>;
    strictEqual(activeCred.access, "refreshed-access-1");
    strictEqual(activeCred.clientSecret, "secret-active");
    strictEqual(activeCred.clientId, "client-active");

    // File mode 0600 after atomic write.
    const { stat } = await import("node:fs/promises");
    const mode = (await stat(join(kiroDir, `${encodeURIComponent("acct_active")}.json`))).mode & 0o777;
    strictEqual(mode, 0o600, "credential file mode must be 0600");

    // Non-active refresh must not overwrite the active mirror.
    const inactiveForced = await getKiroAccessTokenImpl("acct_inactive", agentDir, { ...opts, forceRefresh: true }, inflight);
    strictEqual(inactiveForced.refreshed, true);
    strictEqual(inactiveForced.accessToken, "refreshed-access-2");
    strictEqual(authMirror.access, "refreshed-access-1", "non-active refresh must not overwrite active mirror");
    strictEqual(authMirror.refresh, "active-refresh");

    // Single-flight: concurrent force refreshes share one upstream call.
    refreshCalls = 0;
    const [a, b, c] = await Promise.all([
      getKiroAccessTokenImpl("acct_active", agentDir, { ...opts, forceRefresh: true }, inflight),
      getKiroAccessTokenImpl("acct_active", agentDir, { ...opts, forceRefresh: true }, inflight),
      getKiroAccessTokenImpl("acct_active", agentDir, { ...opts, forceRefresh: true }, inflight),
    ]);
    strictEqual(refreshCalls, 1, "concurrent refreshes must single-flight");
    strictEqual(a.accessToken, b.accessToken);
    strictEqual(b.accessToken, c.accessToken);
    strictEqual(a.accessToken, "refreshed-access-1");

    // Activate race: Active flips under the lock before mirror write.
    refreshCalls = 0;
    authMirror = { access: "pre-race-active", refresh: "active-refresh" };
    let midRefreshFlip = false;
    const raceRefresh = async (credential: Record<string, unknown>) => {
      // Flip Active while refresh is in flight (Activate race).
      activeStorageId = "acct_inactive";
      midRefreshFlip = true;
      refreshCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return {
        apiKey: "race-access",
        newCredentials: {
          ...credential,
          access: "race-access",
          expires: Date.now() + 3_600_000,
        },
      };
    };
    const raced = await getKiroAccessTokenImpl(
      "acct_active",
      agentDir,
      {
        ...opts,
        forceRefresh: true,
        refresh: raceRefresh,
        getActiveStorageId: async () => activeStorageId,
      },
      inflight,
    );
    ok(midRefreshFlip, "Activate race simulation must flip Active mid-refresh");
    strictEqual(raced.accessToken, "race-access");
    strictEqual(
      authMirror.access,
      "pre-race-active",
      "CAS must skip auth.json mirror when Active changed mid-refresh",
    );

    // Restore Active for remaining checks.
    activeStorageId = "acct_active";

    // Empty storage id fails safely.
    await rejects(
      () => getKiroAccessTokenImpl("", agentDir, opts, inflight),
      /kiroAccountStorageId is required/,
    );

    // Invalid credential file shape.
    await writeFile(join(kiroDir, `${encodeURIComponent("acct_bogus")}.json`), "null\n", { mode: 0o600 });
    await rejects(
      () => getKiroAccessTokenImpl("acct_bogus", agentDir, opts, inflight),
      /credential is invalid/,
    );

    // Source contract: production module keeps provider lock, CAS and forceRefresh semantics.
    const productionSource = await readFile(new URL("./kiro-account-token.ts", import.meta.url), "utf8");
    ok(productionSource.includes("forceRefresh || !access || epochNow() >= expires - minValidityMs"));
    ok(productionSource.includes("currentActiveStorageId !== storageId") || productionSource.includes("readActiveStorageId"));
    ok(productionSource.includes("atomicWriteJson("));
    ok(productionSource.includes("`kiro:${storageId}`"));
    ok(productionSource.includes("withKiroProviderLock"), "production must use provider-level lock");
    ok(productionSource.includes("./kiro-account-lock"), "lock lives in dedicated module");
    ok(
      !/require(?:FromHere)?\.resolve\(\s*["']@earendil-works\/pi-coding-agent\/package\.json["']\s*\)/.test(productionSource),
      "must not resolve package.json export subpath",
    );
    ok(!productionSource.includes("requireFromHere.resolve(\"@earendil-works/pi-coding-agent/package.json\")"));
    ok(productionSource.includes("JSON_FILE_MODE = 0o600"), "0600 mode");
    ok(!productionSource.includes("console.log(credential"));
    ok(!productionSource.includes("console.log(raw"));

    const lockSource = await readFile(new URL("./kiro-account-lock.ts", import.meta.url), "utf8");
    ok(lockSource.includes("withKiroProviderLock"), "exports provider lock");
    ok(lockSource.includes("provider.refresh-activate.lock"), "provider lock path");
    ok(
      !/require(?:FromHere)?\.resolve\(\s*["']@earendil-works\/pi-coding-agent\/package\.json["']\s*\)/.test(lockSource),
      "lock module avoids package.json subpath resolve",
    );
    ok(!/require(?:FromHere)?\(\s*["']proper-lockfile["']\s*\)/.test(lockSource), "no proper-lockfile require");
    ok(!/\bcreateRequire\b/.test(lockSource), "no createRequire in lock module");
    ok(lockSource.includes("mkdir"), "fs mkdir exclusive lock");
    ok(lockSource.includes("owner.json"), "owner metadata for stale recovery");

    const oauthSource = await readFile(new URL("./oauth-accounts.ts", import.meta.url), "utf8");
    ok(oauthSource.includes("withKiroProviderLock"), "Activate participates in Kiro provider lock");
    ok(oauthSource.includes("provider === KIRO_PROVIDER_ID"), "Kiro-only lock wrap on Activate");

    // ── Production-path race: real getKiroAccessToken + real activateOAuthAccount ──
    const prodAgentDir = await mkdtemp(join(tmpdir(), "ypi-kiro-token-prod-race-"));
    const prevAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = prodAgentDir;
    try {
      const {
        registerOAuthProvider,
        unregisterOAuthProvider,
        getOAuthProvider,
      } = await import("@earendil-works/pi-ai/oauth");

      let refreshTokenCalls = 0;
      const previous = getOAuthProvider("kiro");
      registerOAuthProvider({
        id: "kiro",
        name: "Kiro (unit race fixture)",
        async login() {
          throw new Error("login not used");
        },
        async refreshToken(credentials) {
          refreshTokenCalls += 1;
          await new Promise((resolve) => setTimeout(resolve, 40));
          return {
            ...credentials,
            access: `prod-refreshed-access-${refreshTokenCalls}`,
            expires: Date.now() + 3_600_000,
            type: "oauth" as const,
          };
        },
        getApiKey(credentials) {
          return typeof credentials.access === "string" ? credentials.access : "";
        },
      });

      try {
        // Dynamic import after env is set so getAgentDir() sees the temp dir.
        const { withKiroProviderLock, __kiroLockUsesFsPrimitivesForTests } = await import(
          pathToFileURL(join(process.cwd(), "lib/kiro-account-lock.ts")).href
        );
        const {
          KIRO_PROVIDER_ID,
          saveOAuthAccountCredential,
          activateOAuthAccount,
          listOAuthAccounts,
        } = await import(pathToFileURL(join(process.cwd(), "lib/oauth-accounts.ts")).href);
        const { getKiroAccessToken } = await import(
          pathToFileURL(join(process.cwd(), "lib/kiro-account-token.ts")).href
        );
        const { AuthStorage } = await import("@earendil-works/pi-coding-agent");

        ok(__kiroLockUsesFsPrimitivesForTests(), "lock uses fs mkdir primitives");

        // expires in the past so production getOAuthApiKey invokes refreshToken.
        const first = await saveOAuthAccountCredential(KIRO_PROVIDER_ID, {
          access: "prod-access-a",
          refresh: "prod-refresh-a",
          expires: Date.now() - 60_000,
          clientId: "prod-client-a",
          clientSecret: "prod-secret-a",
          region: "us-east-1",
          authMethod: "builder-id",
        });
        const second = await saveOAuthAccountCredential(KIRO_PROVIDER_ID, {
          access: "prod-access-b",
          refresh: "prod-refresh-b",
          expires: Date.now() - 60_000,
          clientId: "prod-client-b",
          clientSecret: "prod-secret-b",
          region: "us-west-2",
          authMethod: "builder-id",
        });

        await activateOAuthAccount(KIRO_PROVIDER_ID, first.accountId);
        let listed = await listOAuthAccounts(KIRO_PROVIDER_ID);
        strictEqual(listed.activeAccountId, first.accountId);

        const kiroProdDir = join(prodAgentDir, "auth-accounts", "kiro");

        // Race A: concurrent production refresh(A) + Activate(B).
        // Final Active/mirror must be B; refresh of A must not leave A as auth.json.
        const refreshA = getKiroAccessToken(first.accountId, { forceRefresh: true });
        const activateB = (async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return activateOAuthAccount(KIRO_PROVIDER_ID, second.accountId);
        })();
        const [tokenA] = await Promise.all([refreshA, activateB]);
        ok(tokenA.refreshed, "production getKiroAccessToken refreshed A");
        ok(String(tokenA.accessToken).startsWith("prod-refreshed-access-"));

        listed = await listOAuthAccounts(KIRO_PROVIDER_ID);
        strictEqual(listed.activeAccountId, second.accountId, "Activate must win Active metadata");
        const mirroredB = AuthStorage.create().get(KIRO_PROVIDER_ID) as Record<string, unknown> | null;
        ok(mirroredB, "auth.json must have kiro credential");
        const mirroredBAccess = String(mirroredB?.access ?? "");
        strictEqual(String(mirroredB?.refresh ?? ""), "prod-refresh-b", "auth.json mirror must be newly activated account");
        ok(!mirroredBAccess.includes("prod-access-a"), "refresh of previous Active must not remain as pre-refresh A mirror");
        ok(!String(mirroredB?.refresh ?? "").includes("prod-refresh-a"));

        // Credential file for A may still be refreshed even when mirror is skipped.
        const aCred = JSON.parse(
          await readFile(join(kiroProdDir, `${encodeURIComponent(first.accountId)}.json`), "utf8"),
        ) as Record<string, unknown>;
        ok(String(aCred.access).startsWith("prod-refreshed-access-"), "refresh always persists account credential");
        strictEqual(aCred.clientSecret, "prod-secret-a", "Builder secret preserved on disk only");

        // Race B: Active is B; concurrent Activate(A) + production refresh(B).
        // Final Active/mirror must be A; refresh of B must not clobber A's mirror.
        const refreshB = getKiroAccessToken(second.accountId, { forceRefresh: true });
        const activateA = (async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return activateOAuthAccount(KIRO_PROVIDER_ID, first.accountId);
        })();
        const [tokenB] = await Promise.all([refreshB, activateA]);
        ok(tokenB.refreshed, "production getKiroAccessToken refreshed B");

        listed = await listOAuthAccounts(KIRO_PROVIDER_ID);
        strictEqual(listed.activeAccountId, first.accountId, "Activate A must win Active metadata");
        const mirroredA = AuthStorage.create().get(KIRO_PROVIDER_ID) as Record<string, unknown> | null;
        ok(mirroredA, "auth.json must have kiro credential after Activate A");
        const mirroredAAccess = String(mirroredA?.access ?? "");
        strictEqual(String(mirroredA?.refresh ?? ""), "prod-refresh-a", "auth.json must mirror activated A credential");
        ok(!mirroredAAccess.includes("prod-access-b"), "refresh of previous Active must not overwrite new Active with B original");
        ok(!String(mirroredA?.refresh ?? "").includes("prod-refresh-b"));

        // Shared lock is usable independently.
        let lockRan = false;
        await withKiroProviderLock(async () => {
          lockRan = true;
        });
        ok(lockRan, "withKiroProviderLock runs under fs primitives");

        // Privacy: projections must not dump secrets.
        const serializedList = JSON.stringify(listed);
        ok(!serializedList.includes("prod-secret-"), "account list must not leak clientSecret");
        ok(!serializedList.includes("prod-refresh-"), "account list must not leak refresh token");
        ok(!serializedList.includes("prod-refreshed-access-"), "account list must not leak access token");
      } finally {
        try {
          unregisterOAuthProvider("kiro");
        } catch {
          // ignore
        }
        if (previous) {
          try {
            registerOAuthProvider(previous);
          } catch {
            // ignore
          }
        }
      }
    } finally {
      if (prevAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = prevAgentDir;
      await rm(prodAgentDir, { recursive: true, force: true }).catch(() => {});
    }

    console.log("Kiro account token tests passed");
  } finally {
    await rm(agentDir, { recursive: true, force: true }).catch(() => {});
  }
}

await main();
