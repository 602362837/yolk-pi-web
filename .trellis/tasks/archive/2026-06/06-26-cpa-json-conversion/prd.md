# CPA JSON conversion support

## Goal

Support importing ChatGPT Plus/Pro accounts from CPA auth-file JSON by converting it into pi-web's existing raw OAuth credential format before saving.

## Confirmed Facts

- Existing raw account import accepts JSON with `type: "oauth"`, `access`, `refresh`, and numeric `expires`; `accountId` is optional.
- CPA auth-file JSON uses `type: "codex"` with fields such as `access_token`, `refresh_token`, `expired`, `account_id` / `chatgpt_account_id`, and optional metadata (`email`, `id_token`, etc.).
- The UI already has raw/cpa/sub2api mode buttons, but CPA and SUB2API are disabled.
- Backend `importOAuthAccountCredential()` currently rejects `cpa` and `sub2api` modes; this task can preserve backend raw import by submitting the converted final JSON.

## Requirements

- Enable CPA mode in the ChatGPT Plus/Pro “输入授权 JSON” dialog.
- For raw mode, keep the current single JSON editor behavior.
- For CPA mode, the right-hand editor area uses a reusable conversion layout:
  - upper textarea for source CPA JSON;
  - a conversion button between source and output;
  - lower textarea for converted final raw OAuth JSON.
- Conversion maps CPA fields to pi-web raw OAuth credential fields:
  - `access_token` / `accessToken` -> `access`;
  - `refresh_token` / `refreshToken` -> `refresh`;
  - `expired` / `expires` / `expires_at` / `expiresAt` -> numeric millisecond `expires`;
  - `account_id` / `chatgpt_account_id` / `accountId` -> `accountId`;
  - preserve optional token metadata when useful and non-empty.
- Add a validation action that validates the final JSON that will be submitted, not only the source JSON.
- Saving a CPA import submits the converted final raw OAuth JSON through the existing raw account import path.
- Structure conversion logic so a future SUB2API converter can reuse the same UI layout and validation pipeline with a different conversion rule.

## Acceptance Criteria

- [ ] Raw import still works as before.
- [ ] CPA mode is selectable and no longer marked as disabled/future support.
- [ ] CPA mode displays source and converted JSON textareas with a conversion button between them.
- [ ] Clicking convert with valid CPA JSON fills the lower textarea with pretty-printed raw OAuth JSON.
- [ ] Validation reports success for valid final raw OAuth JSON and clear errors for invalid JSON or missing required fields.
- [ ] Save is disabled until the final JSON is non-empty and submits the converted credential successfully through `/api/auth/accounts/openai-codex`.
- [ ] SUB2API remains disabled/out of scope, but adding it later only requires adding a converter entry and enabling the mode.

## Out of Scope

- Implementing SUB2API conversion.
- Calling CPA management APIs.
- Changing persisted account storage format.
