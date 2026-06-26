# ChatGPT multi-account display and deletion

## Goal

Make saved ChatGPT Plus/Pro (`openai-codex`) accounts understandable and manageable in pi-web by adding a human-readable account remark and allowing inactive saved accounts to be soft-deleted without permanently destroying credential files.

## Confirmed Facts

- Previous task `06-25-chatgpt-multi-account-switcher` intentionally shipped masked account-id display as the MVP and left labels/delete out of scope.
- `lib/oauth-accounts.ts` already stores saved accounts under `getAgentDir()/auth-accounts/openai-codex/` with:
  - `accounts.json` non-secret metadata containing `activeAccountId` and account entries.
  - `<encodeURIComponent(accountId)>.json` secret credential files containing one OAuth credential.
- Account metadata already supports an optional `label`; `OAuthAccountSummary.displayName` already uses `label ?? Account <maskedAccountId>`, but there is no API or UI for editing labels.
- `GET /api/auth/accounts/[provider]` lists sanitized account summaries and never returns access/refresh tokens.
- `POST /api/auth/accounts/[provider]/activate` switches the active account and calls `reloadRpcAuthState()`.
- `components/ModelsConfig.tsx` renders the ChatGPT account list, active marker, and inactive `Activate` button.
- `lib/subscription-quota.ts` already calls ChatGPT's quota endpoint for the active account, but there is no existing reliable profile/account-info endpoint in the codebase.

## Requirements

- Preserve the existing single-active-account model: only one `openai-codex` account is active at a time.
- Add account remark editing for saved ChatGPT accounts.
  - Remarks must be stored as non-secret metadata in `accounts.json` using the existing `label` field.
  - Empty remarks should clear the label and fall back to masked account-id display.
  - API responses must continue to return sanitized summaries only.
- Improve account-list display so the primary label is the remark when present, with masked account id still visible as secondary text.
- Add a delete action only for accounts that are not active.
  - Active account deletion must be rejected server-side even if the UI hides the button.
  - Delete must be a soft delete: move the credential file into a separate deleted/archive folder instead of unlinking it.
  - Soft-deleted accounts should disappear from the normal saved-account list.
  - No restore UI is required for this task.
- Keep token synchronization behavior intact: listing/activation may sync refreshed active credentials back into the account store, but label/delete responses must not expose tokens.
- Update API/frontend/library docs if routes or helper behavior change.

## Out of Scope

- True concurrent multi-account routing.
- Automatic account rotation/load balancing.
- Ongoing remote label syncing after a user manually edits a remark.
- Restore UI for soft-deleted credentials.
- Delete support for OAuth providers other than `openai-codex`.

## Acceptance Criteria

- [ ] ChatGPT Accounts section lets the user add/edit/clear a remark for each saved account.
- [ ] Accounts with remarks display the remark first and masked account id second.
- [ ] Accounts without remarks retain the existing masked account-id fallback.
- [ ] Inactive accounts show a delete action; the active account does not.
- [ ] Server rejects deleting the active account with a clear error.
- [ ] Deleting an inactive account moves its credential file from `auth-accounts/openai-codex/` to a deleted/archive subfolder and removes it from `accounts.json` / normal list.
- [ ] Deleted account credentials are not returned by `GET /api/auth/accounts/openai-codex`.
- [ ] API responses never include raw `access` or `refresh` token values.
- [ ] `npm run lint` and `node_modules/.bin/tsc --noEmit` pass if implementation proceeds.

## Product Decision

- Use manual remarks as the primary display strategy, with masked account id fallback.
- Best-effort one-time email backfill is allowed for unlabeled existing accounts so current saved credentials can be identified. User-edited remarks are not overwritten by backfill.
