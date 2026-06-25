# Design: ChatGPT Plus/Pro multiple account switcher

## Summary

Implement a lightweight single-active-account switcher for `openai-codex`. Saved account credentials live in a separate pi-web-managed account store. Activating an account writes only the `openai-codex` provider entry into pi's active `auth.json`, preserving all other provider credentials.

## Storage Layout

Use a provider-scoped directory under the agent dir:

```text
~/.pi/agent/auth-accounts/
  openai-codex/
    accounts.json
    <accountId>.json
```

- `<accountId>.json` contains only the provider credential object for one `openai-codex` account, not a full `auth.json` object.
- `accounts.json` contains non-secret metadata:
  - `activeAccountId?: string`
  - account list entries: `accountId`, optional `label`, `createdAt`, `updatedAt`, `lastActivatedAt`
- File writes should create parent directories and keep secret credential files at `0600` where possible.

## Server Helper

Add a helper module, likely `lib/oauth-accounts.ts`, responsible for:

- resolving the account store path from `getAgentDir()`
- reading/writing metadata and credential files
- deriving `accountId` from the OAuth credential (`credential.accountId`, falling back to access-token JWT extraction)
- migrating the current active `AuthStorage.create().get("openai-codex")` into the store
- listing sanitized accounts
- saving a newly logged-in credential
- activating an account by updating only `auth.json` provider key `openai-codex`
- syncing the current active credential back into the store before activation or listing

The helper should never return raw `access` or `refresh` fields from API-facing functions.

## Auth Flow

Current route `/api/auth/login/[provider]` runs `authStorage.login(provider)` directly against the active file. For Add Account, use a mode that avoids immediately replacing the active credential until the credential is captured and saved.

Recommended implementation:

- Extend login GET with a query such as `?accountMode=add` for `openai-codex`.
- In account-add mode, use `AuthStorage.inMemory()` to run `login("openai-codex", callbacks)`.
- After success, read the in-memory `openai-codex` credential and save it through `lib/oauth-accounts.ts`.
- Do not activate automatically unless product scope later requests it.
- Normal login/re-login remains current behavior and writes active `auth.json`.

## API Surface

Add provider-specific account routes, for example:

- `GET /api/auth/accounts/openai-codex`
  - migrates/syncs active credential
  - returns sanitized accounts and `activeAccountId`
- `POST /api/auth/accounts/openai-codex/activate`
  - body: `{ accountId: string }`
  - syncs current active credential first
  - activates requested credential
  - reloads active in-process auth state
- Optional later: label update/delete endpoints. Not required for MVP unless labels are in scope.

## Reloading Active Sessions

Existing `AgentSessionWrapper` instances keep an inner `modelRegistry`, whose `authStorage` is available on the real `ModelRegistry` instance. Add a reload function in `lib/rpc-manager.ts`, e.g.:

```ts
export function reloadRpcAuthState(): void {
  for (const wrapper of getRegistry().values()) {
    wrapper.inner.modelRegistry.authStorage?.reload?.();
    wrapper.inner.modelRegistry.refresh?.();
  }
}
```

Type interfaces may need to expose `authStorage.reload()` and `refresh()` in `lib/pi-types.ts` without importing concrete SDK classes into UI-facing code.

Call this after account activation so subsequent prompts use fresh credentials. In-flight requests are not interrupted.

## Frontend Changes

In `components/ModelsConfig.tsx`:

- Extend `OAuthProvider` or detail state with saved account list data for `openai-codex`.
- Load accounts when the ChatGPT provider detail opens and after login/activation.
- Add an `Add Account` button beside existing Login/Re-login/Disconnect actions.
- Render an Accounts section below Subscription or Usage:
  - active marker
  - display label or masked account id
  - Activate button for inactive accounts
- Use Add Account EventSource URL with `accountMode=add`.
- After Add Account succeeds, reload provider/account/quota state.

## Compatibility Notes

- Existing sessions continue to use provider `openai-codex` and existing model IDs, so JSONL session compatibility is preserved.
- Existing single-account users are migrated automatically by copying the active credential into the account store.
- Disconnect should keep current behavior for active auth. Whether it deletes saved account credentials is out of MVP scope; the UI can leave saved accounts intact unless an explicit delete action is added.

## Risks and Mitigations

- **Token refresh drift**: pi may refresh active tokens into `auth.json`; sync active credential to account store before list/switch operations.
- **Cached AuthStorage in running sessions**: reload active wrapper auth/model registries after activation.
- **Duplicate accounts**: de-duplicate by `accountId` after login.
- **Token exposure**: route responses must be sanitized and never include OAuth token fields.
