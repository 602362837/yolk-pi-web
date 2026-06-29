# Implementation Plan

## Checklist

1. Update account metadata types and normalization in `lib/oauth-accounts.ts`.
   - Add `extraInfo` to metadata entries and summaries.
   - Preserve existing metadata without the field.
   - Add/update a shared metadata update function so label and extra info are not handled by divergent code paths.
2. Update `app/api/auth/accounts/[provider]/route.ts` PATCH parsing.
   - Accept `accountId` plus optional `label` and optional `extraInfo`.
   - Keep existing label-only calls working.
3. Update `components/ModelsConfig.tsx` account types and UI.
   - Include `extraInfo` on `OAuthAccountSummary`.
   - Render extra info in account rows when present.
   - Add edit/clear action for extra info with an in-app dialog.
4. Implement quota reset display in the account list.
   - Persist a compact per-account cached quota summary in account metadata.
   - Automatically update the active account's cached quota when the existing quota panel refreshes.
   - Add an account-scoped quota API/action for manual row refresh without activating the account metadata.
   - Refresh expired saved-account OAuth tokens through the shared OAuth helper before querying quota.
   - Prefer shared `SubscriptionQuota` / `QuotaTier` formatting helpers already in `ModelsConfig.tsx`.
   - Avoid duplicating raw ChatGPT quota parsing in the component.
5. Update docs.
   - `docs/modules/api.md` for PATCH account metadata behavior and any quota route changes.
   - `docs/modules/frontend.md` if the component behavior description changes materially.
6. Validate.
   - `npm run lint`
   - `node_modules/.bin/tsc --noEmit`

## Review Gates

- Quota-list behavior decision resolved: active account auto-refreshes, inactive accounts show cached data, and row-level manual refresh fetches that account on demand.
- Before editing any API/service contract, search all consumers of `OAuthAccountSummary`, `updateOAuthAccountLabel`, and `/api/auth/quota`.

## Rollback Points

- Storage/API changes are localized to `lib/oauth-accounts.ts` and `app/api/auth/accounts/[provider]/route.ts`.
- UI changes are localized to `components/ModelsConfig.tsx`.
- If quota list querying proves risky, keep extra info implementation and defer per-account quota display behind the active-only fallback.
