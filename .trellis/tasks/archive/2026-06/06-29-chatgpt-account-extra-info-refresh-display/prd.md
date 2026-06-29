# ChatGPT provider account extra info and quota refresh display

## Goal

Improve the ChatGPT Plus/Pro (`openai-codex`) multi-account management UI so users can store more account-specific helper information and see quota reset timing directly in the saved account list.

## Confirmed Facts

- The provider id is `openai-codex`, displayed as `ChatGPT Plus/Pro`.
- Saved account metadata is persisted in `~/.pi/agent/auth-accounts/openai-codex/accounts.json` by `lib/oauth-accounts.ts`.
- Saved account credentials are stored separately per account id; metadata currently includes label/remark, creation/update times, and activation time.
- The account list UI lives in `components/ModelsConfig.tsx` (`OAuthAccountsView`) and currently supports refresh, activate, edit remark, and delete inactive accounts.
- The accounts API `app/api/auth/accounts/[provider]/route.ts` supports `GET`, `POST`, `PATCH`, and `DELETE`; `PATCH` currently updates only the remark label.
- Subscription quota data is queried by `lib/subscription-quota.ts` and already includes tier reset timestamps (`resetsAt`) in the quota detail panel, but the current API queries only the active OAuth credential.

## Requirements

- Add a persisted optional account-level extra information field for ChatGPT Plus/Pro saved accounts.
- The extra information field must be editable from the account management UI.
- Existing remark/name editing must continue to work.
- Account API responses must include the extra information field so the UI can display it without reading raw metadata directly.
- Account metadata normalization must be backward compatible with existing `accounts.json` files that do not include the new field.
- Account list rows should show quota reset timing for ChatGPT Plus/Pro accounts when quota data is available.
- Only the active account quota should be fetched automatically in real time.
- Inactive accounts should show their last fetched quota reset information if present; if no prior data exists, they should show a quiet empty/fallback state.
- Each account row should provide a manual refresh action that fetches that account's current quota on demand without requiring the user to activate it.
- Quota reset display must reuse the quota API/service contract instead of duplicating raw ChatGPT response parsing in components.
- Documentation for changed API behavior must be updated.

## Acceptance Criteria

- [x] A saved account can store and later retrieve an optional extra information value.
- [x] Editing or clearing extra information persists to `accounts.json` and updates `updatedAt`.
- [x] Existing accounts without extra information still list successfully.
- [x] Existing remark editing, activation, import, and inactive-account deletion still work.
- [x] The account list visibly displays quota reset timing for the relevant account(s) when the quota query returns reset times.
- [x] If quota reset timing is unavailable, the account list shows a non-disruptive empty/fallback state rather than an error-only row.
- [x] `npm run lint` and `node_modules/.bin/tsc --noEmit` pass.

## Out of Scope

- Changing ChatGPT quota semantics or adding new quota windows beyond what the ChatGPT usage endpoint returns.
- Storing raw quota response payloads in account metadata.
- Supporting extra information for non-`openai-codex` OAuth providers unless they later adopt the same account store.

## Product Decision

- Account list quota reset display uses a hybrid model: fetch the active account automatically, show cached last quota data for inactive accounts, and let the user manually refresh any account row on demand.
