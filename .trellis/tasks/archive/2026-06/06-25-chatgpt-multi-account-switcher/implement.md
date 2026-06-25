# Implementation Plan

## Read First

- `docs/modules/api.md`
- `docs/modules/frontend.md`
- `docs/modules/library.md`
- `docs/integrations/README.md`
- `.trellis/spec/frontend/index.md`
- `.trellis/spec/guides/index.md`

## Steps

1. Add account-store helper in `lib/oauth-accounts.ts`.
   - Path resolution under `getAgentDir()/auth-accounts/openai-codex`.
   - Read/write metadata and credential files.
   - Migrate/sync active `openai-codex` credential from `auth.json`.
   - Save account credential from login.
   - Activate selected account by replacing only `openai-codex` in active `AuthStorage`.
   - Return sanitized account summaries only.

2. Add auth reload support.
   - Extend `lib/pi-types.ts` model registry type to include optional `authStorage.reload()` and `refresh()`.
   - Add exported reload helper in `lib/rpc-manager.ts` that reloads auth/model registry for all live wrappers.

3. Add account API routes.
   - `GET /api/auth/accounts/[provider]` for `openai-codex` account list.
   - `POST /api/auth/accounts/[provider]/activate` for activation and auth reload.
   - Validate provider and accountId; return clear errors.

4. Extend OAuth login route for Add Account mode.
   - Support `GET /api/auth/login/openai-codex?accountMode=add`.
   - In add mode, run login with `AuthStorage.inMemory()`.
   - Save captured credential into account store after successful login.
   - Keep existing login behavior unchanged for normal login/re-login.

5. Update quota helper if needed.
   - Existing quota route reads active `openai-codex`; after activation it should work unchanged.
   - Ensure account-list sync does not expose tokens.

6. Update `components/ModelsConfig.tsx`.
   - Add types for account summaries.
   - Load account list for `openai-codex` detail panel.
   - Add `Add Account` action using account-mode OAuth flow.
   - Render account list and Activate buttons.
   - Refresh account list, provider state, and quota after add/activate/disconnect/re-login.

7. Update docs.
   - Add/adjust route descriptions in `docs/modules/api.md`.
   - Add library helper note in `docs/modules/library.md` if a new `lib/oauth-accounts.ts` module is added.
   - Add frontend note in `docs/modules/frontend.md` only if the component behavior summary needs it.

8. Validate.
   - `npm run lint`
   - `node_modules/.bin/tsc --noEmit`

## Rollback Points

- If account-mode login proves unreliable, keep account list/activation helper but temporarily make Add Account use active login then immediately save/migrate the result; document that it replaces active account.
- If active session reload type access is unsafe, fall back to documented behavior that switching affects newly-created sessions only, but this should be avoided per requirement.

## Acceptance Checks

- Existing `auth.json` with `openai-codex` is migrated into account store.
- Adding an account creates/updates a saved account file without leaking tokens in responses.
- Activating account preserves other provider keys in `auth.json`.
- Existing live session wrappers reload auth/model state after activation.
- Quota refresh reflects the active account.
