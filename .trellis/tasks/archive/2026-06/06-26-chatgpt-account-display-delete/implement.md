# Implementation Plan

## Read First

- `docs/modules/api.md`
- `docs/modules/frontend.md`
- `docs/modules/library.md`
- `docs/architecture/overview.md`
- `docs/standards/code-style.md`
- `.trellis/spec/frontend/index.md`
- `.trellis/spec/guides/index.md`
- `.trellis/spec/guides/cross-layer-thinking-guide.md`
- `.trellis/spec/guides/code-reuse-thinking-guide.md`
- `.trellis/tasks/archive/2026-06/06-25-chatgpt-multi-account-switcher/design.md`

## Steps

1. Extend `lib/oauth-accounts.ts`.
   - Add `rename` import and deleted-dir path helpers.
   - Add best-effort email backfill for unlabeled existing credentials.
   - Add `updateOAuthAccountLabel(provider, accountId, label)`.
   - Add `deleteOAuthAccount(provider, accountId)`.
   - Keep path construction, active-account validation, metadata normalization, and sanitized return shape centralized in this module.

2. Extend `app/api/auth/accounts/[provider]/route.ts`.
   - Keep `GET` unchanged.
   - Add `PATCH` for label update.
   - Add `DELETE` for inactive-account soft delete.
   - Map `OAuthAccountStoreError.status` to HTTP status.

3. Update `components/ModelsConfig.tsx` types and account UI.
   - Keep `OAuthAccountSummary` in sync with library response.
   - Add label edit controls.
   - Add inactive delete button and working state.
   - Add API calls for PATCH/DELETE and update account state from responses.
   - Ensure active account has no delete action.

4. Update docs.
   - `docs/modules/api.md`: add PATCH/DELETE to `auth/accounts/[provider]/` route row.
   - `docs/modules/frontend.md`: clarify ChatGPT account remarks/delete if needed.
   - `docs/modules/library.md`: clarify `lib/oauth-accounts.ts` handles labels and soft delete.

5. Validate.
   - `npm run lint`
   - `node_modules/.bin/tsc --noEmit`

## Rollback Points

- If inline label editing becomes too complex for the modal layout, first ship a simple prompt-based rename action using the same PATCH API.
- If DELETE with a request body causes browser/proxy issues, switch to a small dedicated route such as `app/api/auth/accounts/[provider]/delete/route.ts` with `POST` while keeping the library helper unchanged.

## Acceptance Checks

- Existing saved accounts still list and activate.
- Label edit persists after refresh.
- Clearing label falls back to masked account id.
- Active account cannot be deleted by UI or direct API call.
- Inactive delete moves the credential into `auth-accounts/openai-codex/deleted/` and removes it from normal list.
- No response includes OAuth tokens.
