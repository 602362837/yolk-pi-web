# Implementation Plan — Codex reset credits

## Ordered Checklist

1. Extend server types and parsing in `lib/subscription-quota.ts`:
   - Add reset-credit interfaces and default fields on `SubscriptionQuota`.
   - Add shared header helper.
   - Add reset-credit payload parser and credit normalizer.
   - Query reset credits after successful `/wham/usage`, degrading on failure.
   - Add consume helper and exported reset functions for active/saved accounts.
2. Extend saved account quota cache in `lib/oauth-accounts.ts`:
   - Add reset-credit fields to cache tier/credit types.
   - Normalize existing metadata with defaults.
   - Persist reset-credit fields from quota refresh.
3. Extend quota API route:
   - Keep `GET` behavior.
   - Add `POST` to consume/reset active or selected saved account quota.
   - Parse invalid JSON as an empty body for active-account reset.
4. Update UI types and actions:
   - `components/ModelsConfig.tsx`: show reset-credit count/details and add confirmed reset action in OAuth quota detail.
   - `components/ChatGptUsagePanel.tsx`: show active reset-credit count/details and add confirmed reset action.
   - Ensure account reloads after reset so cached account summaries update.
5. Update documentation:
   - `docs/modules/api.md`: `auth/quota/[provider]/` methods/purpose.
   - `docs/modules/frontend.md`: quota UI reset behavior in affected components.
   - `docs/modules/library.md`: `lib/subscription-quota.ts` and `lib/oauth-accounts.ts` cache details if needed.
6. Validate:
   - `npm run lint`
   - `node_modules/.bin/tsc --noEmit`

## Risky Files / Rollback Points

- `lib/subscription-quota.ts`: external API call behavior and credential cache update. Keep reset-credit query non-blocking.
- `lib/oauth-accounts.ts`: metadata normalization must remain backward-compatible with existing account files.
- `components/ModelsConfig.tsx`: large file; use targeted edits and keep callback dependencies accurate.
- `components/ChatGptUsagePanel.tsx`: avoid stale cached active-account state after reset by reloading accounts.

## Manual Review Gates

- Confirm reset button only appears when available count is known and > 0.
- Confirm reset failure displays an error and does not clear existing quota tiers.
- Confirm cached account rows still render when reset-credit fields are missing from old metadata.

## Validation Commands

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```
