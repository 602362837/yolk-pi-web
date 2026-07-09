# handoff

## Status: `docs-checks` complete

All six implementation subtasks are now done. The `docs-checks` subtask has verified the full chain: lint (ESLint), type-check (tsc --noEmit), and documentation alignment.

## Completed subtasks

| ID | Title | Status |
| --- | --- | --- |
| `ui-gate` | HTML 原型 + 审批 | ✅ done (earlier step) |
| `account-store` | `lib/api-key-accounts.ts` 服务层 | ✅ done (earlier step) |
| `api-summary-compat` | Provider summary + legacy 兼容路由演进 | ✅ done (earlier step) |
| `api-managed-routes` | opencode-go 多账号管理路由族 | ✅ done (earlier step) |
| `models-config-opencode-go` | `ModelsConfig.tsx` 多账号 UI | ✅ done (earlier step) |
| `docs-checks` | 文档同步 + 最终验证 | ✅ **this subtask** |

## Files changed in this subtask

- `docs/modules/api.md` — Added four new route table entries for managed-account CRUD (`accounts/`, `accounts/[accountId]/`, `activate/`, `reveal/`); updated `auth/all-providers/` and `auth/api-key/[provider]/` rows with managed-account enrichment notes.
- `docs/modules/frontend.md` — Updated `ModelsConfig.tsx` table row to mention `ApiKeyAccountsDetail`; added a dedicated sub-component row for `ApiKeyAccountsDetail` with full capability coverage.
- `docs/modules/library.md` — Added `lib/api-key-accounts.ts` entry describing the service layer's storage model, permissions, allowlist, exported functions, security boundaries, and active-mirror behaviour.
- `.ypi/tasks/20260709-085311-为-opencode-go-提供商设计多账号-api-key-管理与激活能力/handoff.md` — Replaced TBD with this handoff.

## Verification

```bash
npm run lint       # ✅ zero errors/warnings
node_modules/.bin/tsc --noEmit  # ✅ zero errors
```

All standard checks pass. No low-risk issues were found; no code changes were needed.

## Key implementation facts (for future agents)

### Storage layout
```
~/.pi/agent/auth-api-key-accounts/opencode-go/
  accounts.json     # metadata: version, accounts[], activeAccountId
  <accountId>.json  # one secret per account: { type: "api_key", key: "..." }
```
Permissions: dir `0700`, files `0600`.

### Active mirror mechanism
- `activateApiKeyAccount()` / `createApiKeyAccount()` (when activate=true) / `deleteApiKeyAccount()` (fallback) all write the current active credential to `auth.json` via `AuthStorage.set(provider, {type, key})`.
- Then call `reloadRpcAuthState()` (lazy-imported from `rpc-manager.ts` to avoid circular deps).
- Upstream SDK / `ModelRegistry` never sees multi-account — it only reads the single active key from `auth.json`.

### Security boundaries
- List/summary endpoints: **never** return plaintext keys (masked previews only).
- `POST .../reveal`: only single-account reveal, `Cache-Control: no-store`.
- Frontend `revealedKeys` Map: discarded on provider switch / modal close / refresh.
- Toast messages: never contain keys.
- Error responses: generic messages only.

### Legacy import
- Triggered on first `listApiKeyAccounts()` call (GET accounts list, POST create, etc.).
- Idempotent: uses SHA-256 `keyFingerprint` to detect already-imported keys.
- Does NOT delete the existing key from `auth.json`.
- Provider summary routes (`all-providers`, `api-key/[provider] GET`) do NOT trigger import.

### Provider allowlist
- Only `opencode-go` is in `MANAGED_ACCOUNT_PROVIDERS` set.
- All other API-key providers remain on the single-key path.
- `isManagedApiKeyProvider()` is the gate; expanding to other providers requires adding them to the set and ensuring their credential shape matches.

### DELETE compatibility
- Old `DELETE /api/auth/api-key/[provider]` returns `409 managed_accounts_enabled` when managed accounts exist, preventing accidental mass deletion.
- Per-account `DELETE .../accounts/[accountId]` handles all cases (non-active, active-with-fallback, last-account-disconnect).

## Remaining risks

1. **`opencode` / `opencode-go` confusion**: Both are OpenCode-family providers that share the `OPENCODE_API_KEY` env var name. The current implementation keeps their account pools completely independent (`opencode` stays single-key). Users who expect cross-provider key sharing will need to save the same key in both places.

2. **Active-mirror atomicity**: If `writeMetadata()` succeeds but `AuthStorage.set()` fails (e.g., disk full), UI and runtime can diverge. The current code writes metadata first, then mirrors — a reversal could make it safer but would increase effective write latency. This is a theoretical risk; in practice both writes are local filesystem ops to the same agent directory.

3. **No server-side rate limiting on reveal**: The reveal endpoint trusts the frontend to call it only on explicit user action. A compromised or buggy frontend could call reveal in a loop, though each call is explicitly single-account and `no-store`.

4. **Frontend hard-codes `managed_accounts` mode detection**: `ApiKeyAccountsDetail` is rendered when `p.authMode === "managed_accounts"`. If the backend `getApiKeyProviderSummary()` returns this for providers that don't yet have their managed-account routes, the UI would show an empty broken state. This is mitigated by the provider allowlist on the backend side.
