# Add account JSON auth path

## Goal

Allow ChatGPT Plus/Pro (`openai-codex`) users to add a saved account either through the existing Codex OAuth authorization flow or by pasting an authorization JSON payload.

## User Value

Users who already have a compatible ChatGPT/Codex credential JSON can add accounts without repeating browser authorization, while the existing OAuth flow remains available and unchanged.

## Confirmed Facts

- ChatGPT Plus/Pro is represented by provider id `openai-codex` and displayed as `ChatGPT Plus/Pro`.
- Existing add-account behavior lives in `components/ModelsConfig.tsx` inside `OAuthDetail`.
- The current `Add Account` button is shown only when `provider.id === "openai-codex" && provider.loggedIn` and calls `handleLogin("add")`.
- The existing add-account authorization path uses `GET /api/auth/login/openai-codex?accountMode=add`, creates an in-memory `AuthStorage`, then saves the resulting credential through `saveOAuthAccountCredential()` without replacing the active account.
- Saved account persistence and validation live in `lib/oauth-accounts.ts`; credentials must currently match `{ type: "oauth", access: string, refresh: string, expires: number }`, with optional `accountId`.
- `saveOAuthAccountCredential()` normalizes or derives `accountId`, writes a per-account JSON file under the account store, and updates account metadata.
- Existing account label backfill currently tries to resolve email-like labels from access token claims or OpenAI userinfo-style APIs.
- Account list, remark, delete, and activate operations are exposed by `/api/auth/accounts/[provider]`.

## Requirements

- Clicking `Add Account` for ChatGPT Plus/Pro opens a method-selection modal instead of immediately starting OAuth.
- The modal offers at least two choices:
  - `Codex authorization`: continues the existing `handleLogin("add")` path unchanged.
  - `Authorization JSON`: opens a JSON-input flow.
- The JSON-input flow uses a left/right layout:
  - left side: example JSON and format guidance;
  - right side: user input area and format mode controls.
- The right side exposes three input modes:
  - Raw/original JSON: enabled for this task.
  - CPA format: visible but disabled/greyed out; reserved for future conversion support.
  - SUB2API format: visible but disabled/greyed out; reserved for future conversion support.
- Raw JSON submission validates server-side and saves the account using the same account store as OAuth add-account.
- When saving/listing an account without a custom remark, the system should try to auto-fill a useful label from account info, with priority: email, then phone number, then accountId fallback.
- A successful JSON add refreshes the account list and leaves the active account unchanged.
- Invalid JSON or invalid credential shape returns a clear error and does not write account files.
- CPA and SUB2API formats are explicitly out of scope beyond UI placeholders and internal extensibility hooks.

## Acceptance Criteria

- [ ] `Add Account` no longer immediately starts OAuth; it first shows a choice between Codex authorization and authorization JSON.
- [ ] Choosing Codex authorization behaves like the current add-account path.
- [ ] Choosing authorization JSON shows a two-column modal with an example on the left and input controls on the right.
- [ ] Raw/original JSON mode accepts compatible OAuth credential JSON and saves it as a non-active saved account.
- [ ] Imported/saved accounts without a custom remark display the best available auto label in priority order: email, phone number, then accountId fallback.
- [ ] CPA and SUB2API modes are visible but disabled with copy indicating they are not available yet.
- [ ] The backend rejects malformed JSON, unsupported provider ids, and missing required OAuth fields.
- [ ] On success, the account appears in the saved account list without activating/replacing the current account.
- [ ] Existing login, logout, activate, remark, delete, and quota behavior are not regressed.

## Out of Scope

- CPA credential-file parsing and conversion.
- SUB2API credential parsing and conversion.
- Automatically activating the pasted account.
- Changing the existing OAuth authorization implementation.

## Decisions

- Raw JSON supports only the canonical saved account credential shape: `{ "type": "oauth", "access": string, "refresh": string, "expires": number, "accountId"?: string }`.
- Wrapper/import convenience shapes such as `{ "openai-codex": { ... } }` or `{ "credential": { ... } }` are intentionally out of scope for this iteration.
