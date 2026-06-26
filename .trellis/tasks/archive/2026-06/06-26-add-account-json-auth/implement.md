# Implementation Plan

## Files Likely Touched

- `components/ModelsConfig.tsx`
  - Add method-selection / JSON-input modal state and rendering.
  - Route existing `Add Account` click through the modal.
  - Submit raw JSON imports and refresh account list.
- `lib/oauth-accounts.ts`
  - Add centralized import mode type/helper.
  - Validate/normalize raw JSON credential payloads.
  - Reserve CPA/SUB2API mode branches for future converters.
- `app/api/auth/accounts/[provider]/route.ts`
  - Add `POST` for account import.
- `docs/modules/api.md`
  - Document `POST auth/accounts/[provider]/`.
- `docs/modules/library.md`
  - Mention import helper if added.
- `docs/modules/frontend.md`
  - Update only if a new named component is extracted.

## Ordered Steps

1. Add import-mode types and helper to `lib/oauth-accounts.ts`.
2. Add `POST` route in `app/api/auth/accounts/[provider]/route.ts`.
3. Update `OAuthDetail` UI in `components/ModelsConfig.tsx`:
   - modal state;
   - method selection view;
   - JSON input view;
   - raw JSON parse and POST submission;
   - disabled CPA/SUB2API controls.
4. Refresh accounts and success/error state after import.
5. Update module docs.
6. Validate.

## Validation Commands

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

## Manual Checks

- Existing `Add Account → Codex authorization` still opens the OAuth flow.
- `Add Account → Authorization JSON → Raw JSON` accepts a valid credential-shaped JSON.
- Invalid JSON stays in the modal and shows a readable error.
- Unsupported modes cannot be selected in UI and are rejected by API if forced.
- Imported account appears in saved accounts but active account does not change.

## Risks / Rollback Points

- `components/ModelsConfig.tsx` is large; keep modal code localized or extract a small internal component if the diff becomes hard to review.
- Pasted credentials are sensitive; avoid console logging and avoid storing them in any long-lived state beyond the textarea.
- Do not change `handleLogin("add")` internals; the existing OAuth add path should remain a fallback.
