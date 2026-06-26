# Design: ChatGPT account remarks and soft delete

## Summary

Extend the existing `openai-codex` account store instead of introducing a new storage model. Use the already-present metadata `label` field for human-readable remarks, and add a soft-delete helper that archives inactive account credential files under a deleted subdirectory.

Recommended account display behavior:

```text
primary: account.label || `Account ${account.maskedAccountId}`
secondary: account.maskedAccountId
```

This is deterministic after labels are stored locally. For existing unlabeled credentials, the account list performs a best-effort one-time email backfill and stores the email as the initial label when available.

## Storage

Existing layout:

```text
~/.pi/agent/auth-accounts/openai-codex/
  accounts.json
  <encoded-account-id>.json
```

Add deleted credential archive:

```text
~/.pi/agent/auth-accounts/openai-codex/deleted/
  <timestamp>_<encoded-account-id>.json
```

Notes:

- `accounts.json` remains non-secret metadata.
- `label` stays on account entries and is trimmed on write.
- Clearing a label records a non-secret `labelBackfillDisabledAt` timestamp so best-effort email backfill does not immediately repopulate a user-cleared remark.
- Credential files remain `0600` where possible; the deleted directory should be created with `0700`.
- The normal list only includes metadata entries whose live credential file exists.
- Deleted credentials are not listed unless a future restore feature intentionally scans `deleted/`.

## Library Contract

Extend `lib/oauth-accounts.ts` with shared helpers:

- `updateOAuthAccountLabel(provider, accountId, label): Promise<OAuthAccountsList>`
  - supports `openai-codex` only via existing provider guard.
  - validates `accountId` and verifies the live credential file exists.
  - trims label; empty/null clears it.
  - updates `updatedAt`.
  - returns `listOAuthAccounts(provider)` so the client receives a normalized/sorted list.
- `deleteOAuthAccount(provider, accountId): Promise<OAuthAccountsList>`
  - supports `openai-codex` only.
  - syncs/reads metadata enough to know the current `activeAccountId`.
  - rejects the active account with `409`.
  - verifies live credential file exists.
  - creates `deleted/`, moves the credential file there with a timestamped filename, then removes the account metadata entry.
  - returns `listOAuthAccounts(provider)`.

Keep all account file path construction in `lib/oauth-accounts.ts`; route/component code must not duplicate file naming or metadata parsing.

## API Surface

Reuse the existing provider account collection route:

- `GET /api/auth/accounts/[provider]`
  - unchanged: returns sanitized list.
- `PATCH /api/auth/accounts/[provider]`
  - body: `{ accountId: string, label?: string | null }`
  - updates/clears the account remark.
  - returns `OAuthAccountsList`.
- `DELETE /api/auth/accounts/[provider]`
  - body: `{ accountId: string }`
  - soft-deletes an inactive account.
  - returns `OAuthAccountsList`.
  - returns `409` for active account delete attempts.

`POST /api/auth/accounts/[provider]/activate` remains unchanged for activation.

## Frontend

Update `components/ModelsConfig.tsx` account section:

- Add `onLabelChange` / `onDelete` callbacks to `OAuthAccountsView`.
- Track UI working states in `OAuthDetail`:
  - `editingAccountId`, `labelDraft`, or an inline edit state map.
  - `savingLabelAccountId`.
  - `deletingAccountId`.
- Render each account row with:
  - active status dot.
  - primary `account.displayName`.
  - secondary `account.maskedAccountId`.
  - edit/save/cancel controls for remark.
  - inactive `Activate` button.
  - inactive red `Delete` button.
- Confirm before delete using the existing component style; browser `confirm()` is acceptable for MVP unless a local modal pattern already exists nearby.
- After label save/delete, replace local `accounts` state from the returned sanitized list.
- Do not refresh quota for label edits or inactive deletes because active auth does not change.

## Data Flow

### Label update

```text
UI label draft
  -> PATCH /api/auth/accounts/openai-codex
  -> lib/oauth-accounts.updateOAuthAccountLabel()
  -> accounts.json label + updatedAt
  -> sanitized OAuthAccountsList
  -> UI state replacement
```

### Soft delete

```text
UI inactive Delete
  -> DELETE /api/auth/accounts/openai-codex
  -> lib/oauth-accounts.deleteOAuthAccount()
  -> reject if activeAccountId matches
  -> rename live credential file to deleted/<timestamp>_<encoded>.json
  -> remove metadata entry from accounts.json
  -> sanitized OAuthAccountsList
  -> UI state replacement
```

## Compatibility and Risks

- Existing `accounts.json` files already normalize optional `label`; no schema version bump is required.
- Existing labels, if manually added, are preserved by `upsertMetadataAccount()`.
- Soft delete is intentionally not a permanent deletion; credentials remain on disk in the deleted folder.
- If metadata write fails after moving a credential, the next list call will prune the missing live credential entry. This is acceptable, but the route should still surface the write error when it occurs.
- Email backfill is best-effort only. Network/API failures must not make account listing fail; users can still set remarks manually.
