# Code Survey — Codex reset credits

## Existing quota flow

- `app/api/auth/quota/[provider]/route.ts` exposes `GET /api/auth/quota/openai-codex` and optional `?accountId=...` for saved-account quota queries.
- `lib/subscription-quota.ts` owns the ChatGPT `/backend-api/wham/usage` call, normalizes quota tiers, and updates saved-account `quotaCache`.
- `lib/oauth-accounts.ts` owns saved-account metadata and currently persists `quotaCache` with `success`, `tiers`, `error`, and `queriedAt` only.
- `components/ModelsConfig.tsx` renders the full OAuth quota area and saved-account list, including per-account refresh.
- `components/ChatGptUsagePanel.tsx` renders the optional top-bar ChatGPT usage panel, reads cached accounts, and refreshes the active account through the same quota API.
- `lib/chatgpt-usage-refresh-scheduler.ts` periodically refreshes saved account quota caches via `getOAuthAccountSubscriptionQuota()`.

## Required integration points

- Extend the shared subscription quota result and saved account quota cache with reset-credit fields so both live quota responses and cached account summaries can display reset availability.
- Keep reset-credit query non-blocking for normal usage queries; normal quota data should still render when the reset-credit endpoint fails or returns an unexpected payload.
- Add a mutation endpoint for consuming one reset credit and then refreshing quota. Reusing `POST /api/auth/quota/[provider]` keeps quota actions grouped under the existing route.
- Update the API docs route table from `GET` to `GET/POST` for `auth/quota/[provider]/`.

## UI scope assumption

Implement the reset button in both places that already show ChatGPT/Codex quota:

1. Models → OAuth quota detail, including temporary saved-account views.
2. Optional top-bar ChatGPT usage panel for the active account.

Both should use `window.confirm()` before consuming a reset credit and should refresh quota/account caches after success.
