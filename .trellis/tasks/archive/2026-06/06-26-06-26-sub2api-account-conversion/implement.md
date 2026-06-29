# Implementation Plan

1. Add `lib/oauth-account-converters.ts` with shared types, examples, validators, CPA converter, SUB2API converter, registry, and mode guard.
2. Refactor `components/ModelsConfig.tsx` to import shared converter pieces and remove local duplicate conversion helpers.
3. Refactor `lib/oauth-accounts.ts` to import `OAuthAccountImportMode` and convert `raw`/`cpa`/`sub2api` modes before saving.
4. Refactor `app/api/auth/accounts/[provider]/route.ts` to use shared `isOAuthAccountImportMode()`.
5. Update `docs/modules/frontend.md`, `docs/modules/library.md`, and `docs/modules/api.md` for behavior changes.
6. Run validation:
   - `npm run lint`
   - `node_modules/.bin/tsc --noEmit`
