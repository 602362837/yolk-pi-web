# Account selection for models subscription panel

## Goal

Improve the Models → ChatGPT Plus/Pro subscription panel so the upper subscription/usage area clearly reflects an account, and users can temporarily inspect another saved account's usage without changing the globally active account used by pi.

## Confirmed Facts

- The UI lives in `components/ModelsConfig.tsx`.
- Saved OAuth accounts are fetched from `GET /api/auth/accounts/openai-codex` and each account includes `active`, `displayName`, `maskedAccountId`, optional `extraInfo`, and cached quota metadata.
- The upper usage panel currently calls `GET /api/auth/quota/openai-codex` without `accountId`, so it reflects the active account only.
- The quota API already supports temporary account-scoped reads with `GET /api/auth/quota/openai-codex?accountId=<id>` and does not require account activation.
- Activating an account is a separate explicit mutation via `POST /api/auth/accounts/openai-codex/activate`.

## Requirements

- The Subscription/Usage area must show which account it is displaying.
- By default, the displayed account should be the currently active saved account when one exists.
- Users must be able to select another saved account for the upper Usage panel without changing the active account.
- The saved accounts list must continue to show the active account distinctly and retain the existing Activate action for changing the global active account.
- Temporary selection must use the account-scoped quota endpoint and must not call the activate endpoint.
- Refreshing the upper Usage panel should refresh the currently displayed/selected account.
- Account list refresh, quota refresh, activation, deletion, and metadata edits should keep the selected/displayed account state coherent.

## Acceptance Criteria

- [x] When ChatGPT Plus/Pro has saved accounts, the upper section displays the active account's name/id/details by default.
- [x] Selecting a non-active account in the accounts list changes the upper Usage panel to that account's quota without changing the active marker.
- [x] The non-active account remains eligible for the existing Activate action.
- [x] Manual refresh in the upper Usage panel queries the selected account when one is selected.
- [x] Refreshing an individual account quota updates the upper panel if that account is currently displayed.
- [x] If the selected account is deleted or no longer exists, the upper panel falls back to the active account or no selection.
- [x] Existing login, add account, disconnect, remark, details, activate, delete, and per-account refresh flows continue to work.

## Out of Scope

- Changing the backend account activation semantics.
- Persisting the temporary selection outside the current modal/session unless explicitly requested.
- Changing which account is used for model inference/chat calls except through the existing Activate button.
