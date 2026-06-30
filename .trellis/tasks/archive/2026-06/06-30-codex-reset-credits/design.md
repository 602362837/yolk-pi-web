# Design — Codex reset credits

## Boundaries

- `lib/subscription-quota.ts` remains the server-side owner of OpenAI Codex quota HTTP calls, response normalization, consume logic, and quota cache updates.
- `app/api/auth/quota/[provider]/route.ts` remains the browser-facing quota route. Add `POST` for reset consumption instead of adding a separate route tree.
- `lib/oauth-accounts.ts` remains the saved-account metadata/cache owner. Extend its quota cache shape in a backward-compatible way.
- `components/ModelsConfig.tsx` and `components/ChatGptUsagePanel.tsx` format shared quota/reset-credit fields; they do not call ChatGPT directly.

## Server Contracts

### SubscriptionQuota additions

Add fields to the existing quota result:

```ts
interface CodexRateLimitResetCredit {
  id: string;
  status: string;
  grantedAt: string;
  expiresAt: string;
}

interface SubscriptionQuota {
  // existing fields...
  resetCreditsAvailableCount: number | null;
  resetCredits: CodexRateLimitResetCredit[];
  resetCreditsError: string | null;
}
```

All success and error constructors populate these fields so callers can depend on the shape.

### Saved quota cache additions

Extend `OAuthAccountQuotaCache` with optional-compatible fields normalized to defaults when missing:

```ts
resetCreditsAvailableCount: number | null;
resetCredits: CodexRateLimitResetCredit[];
resetCreditsError: string | null;
```

Existing metadata files continue to parse because missing fields normalize to `null`, `[]`, and `null`.

### `GET /api/auth/quota/[provider]`

No request contract change. Response includes reset-credit fields for `openai-codex`.

### `POST /api/auth/quota/[provider]`

Request body:

```json
{ "accountId": "optional saved account id" }
```

Behavior:

1. Resolve active provider credential when `accountId` is missing.
2. Resolve saved account credential when `accountId` is non-empty.
3. Consume one reset credit via ChatGPT `/consume` endpoint with a generated `redeem_request_id`.
4. Re-query quota through the same path as `GET`, which updates saved account cache when an account id is known.
5. Return a `SubscriptionQuota` response. Consume failure returns a `SubscriptionQuota` failure payload with a readable `error`.

## ChatGPT API Calls

### Shared headers

Build OpenAI Codex quota headers in one helper so usage, reset-credit query, and consume stay consistent:

- `Authorization: Bearer <access token>`
- `Content-Type: application/json`
- `User-Agent: codex_cli_rs/0.76.0 (Debian 13.0.0; x86_64) WindowsTerminal`
- `ChatGPT-Account-Id` only when account id is known.

Reset-credit query additionally sends:

- `Accept: application/json`
- `OpenAI-Beta: codex-1`
- `Originator: Codex Desktop`

### Reset-credit query degradation

`queryOpenAICodexQuota()` calls `/wham/usage` first. If that succeeds, it calls reset-credit query with an 8s timeout. Any reset-credit failure returns:

- `resetCreditsAvailableCount`: fallback from usage `rate_limit_reset_credits.available_count/availableCount` when present, otherwise `null`
- `resetCredits`: `[]`
- `resetCreditsError`: readable error string or invalid payload marker

The main quota `success` remains true.

### Reset-credit consume

Consume uses `POST /backend-api/wham/rate-limit-reset-credits/consume` with JSON body:

```json
{ "redeem_request_id": "<uuid>" }
```

Use Node `randomUUID()`, with a local fallback if unavailable.

## UI Design

### Models quota detail

- Add reset-credit count below/near the usage title or tier bars.
- Show earliest credit expiration in the button/title when credit details are available.
- Render a `Reset limit` button only when `resetCreditsAvailableCount > 0` and an account is selected.
- Confirm with `window.confirm("将消耗一次 Codex 重置机会，确认继续？")`.
- `POST /api/auth/quota/openai-codex` with selected account id, set returned quota into local state, reload accounts, and show existing success/error login state.

### Top-bar ChatGPT usage panel

- Add active-account reset-credit count to the expanded account detail.
- Render `Reset limit` for the active account only when `resetCreditsAvailableCount > 0`.
- Confirm before POST.
- Refresh accounts after POST so compact/cached displays update.

## Compatibility / Migration

- Existing quota cache files without reset-credit fields remain valid.
- Existing consumers that ignore extra fields continue to work.
- Non-`openai-codex` quota requests still return not-found shaped results with reset-credit fields at default values.

## Rollback

- Removing the `POST` route and UI buttons restores read-only quota behavior.
- Extra quota cache fields are harmless if left in metadata; older normalizers ignore unknown fields or current normalizer can default missing values.
