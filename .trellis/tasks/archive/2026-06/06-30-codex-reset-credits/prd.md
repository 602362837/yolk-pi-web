# Codex reset credits

## Goal

Expose ChatGPT/Codex rate-limit reset credits in the existing quota UI and let users intentionally consume one available reset credit to reset Codex rate limits without leaving pi-web.

## User Value

- Users can see whether an OpenAI Codex account has reset credits before they hit a rate-limit wall.
- Users can recover a rate-limited account from the same account-management and usage-panel surfaces they already use.
- Failed reset-credit lookup does not break normal quota visibility.

## Confirmed Facts

- Existing quota fetching is implemented in `lib/subscription-quota.ts` by calling `GET https://chatgpt.com/backend-api/wham/usage`.
- Existing quota API route is `GET /api/auth/quota/[provider]`, with optional `?accountId=...` for saved `openai-codex` accounts.
- Saved OpenAI Codex account quota cache is stored by `lib/oauth-accounts.ts` and displayed in `components/ModelsConfig.tsx` and `components/ChatGptUsagePanel.tsx`.
- The implementation note in `codex-reset-credits-implementation.md` defines:
  - reset-credit query: `GET /backend-api/wham/rate-limit-reset-credits`
  - reset-credit consume: `POST /backend-api/wham/rate-limit-reset-credits/consume`
  - query failures should degrade and not block normal quota results.

## Requirements

1. Quota responses for `openai-codex` include reset-credit summary fields:
   - available reset credit count as `number | null`
   - normalized available credit details
   - reset-credit lookup error as `string | null`
2. Reset-credit query must:
   - send the account id header when an account id is known
   - use the extra `Accept: application/json`, `OpenAI-Beta: codex-1`, and `Originator: Codex Desktop` headers
   - time out independently from the main quota request
   - tolerate `snake_case` and `camelCase` response fields
   - filter credits to `reset_type/resetType === "codex_rate_limits"` and `status === "available"`
   - not fail the whole quota query when the reset-credit endpoint fails or returns invalid payload.
3. Reset-credit consume must:
   - be exposed through a server route; browser code must not call ChatGPT directly or receive tokens
   - generate a unique `redeem_request_id` for each consume attempt
   - use the same active-account or selected saved-account credential semantics as quota refresh
   - throw or return a user-visible failure when the consume request returns a non-2xx response
   - refresh quota and saved account cache after successful consume.
4. UI must:
   - show available reset-credit count near quota information when known
   - show the reset action only when available count is greater than zero
   - confirm with the user before consuming a credit
   - disable duplicate reset/refresh actions while a reset is in flight
   - refresh displayed quota/account cache after reset succeeds
   - display a readable error when reset fails.
5. Documentation must stay in sync for changed API/lib/frontend behavior.

## Acceptance Criteria

- [ ] `GET /api/auth/quota/openai-codex` returns normal tiers and reset-credit fields for the active account.
- [ ] `GET /api/auth/quota/openai-codex?accountId=<id>` returns normal tiers and reset-credit fields for that saved account.
- [ ] Reset-credit lookup failure returns a successful quota response when `/wham/usage` succeeds, with reset count `null`, empty credits, and a reset-credit error.
- [ ] `POST /api/auth/quota/openai-codex` consumes one reset credit for the active account and returns freshly queried quota.
- [ ] `POST /api/auth/quota/openai-codex` with `{ "accountId": "<id>" }` consumes one reset credit for that saved account and returns freshly queried quota.
- [ ] Models quota detail shows reset-credit count and a confirmed reset button only when count > 0.
- [ ] Top-bar ChatGPT usage panel shows active-account reset-credit count and a confirmed reset button only when count > 0.
- [ ] Saved account quota caches preserve reset-credit fields so account lists can display cached reset availability.
- [ ] `npm run lint` and `node_modules/.bin/tsc --noEmit` pass.

## Out of Scope

- Scheduling automatic reset-credit consumption.
- Reset-credit support for non-`openai-codex` providers.
- Persisting the full consume history beyond the refreshed quota cache.
- Changing ChatGPT warmup scheduling semantics.

## Open Questions

None. Scope assumption: implement reset display/action in both existing ChatGPT/Codex quota surfaces (`ModelsConfig` and `ChatGptUsagePanel`).
