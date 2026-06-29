# Support SUB2API account JSON conversion

## Goal

Extract OAuth account JSON conversion/validation into a shared library and add SUB2API import support for both the ModelsConfig UI and the account import API.

## Requirements

- Keep raw OAuth account JSON import behavior unchanged.
- Keep CPA import behavior available in the UI.
- Add SUB2API import as the same converted-input UX pattern as CPA: source JSON, convert button, final raw OAuth JSON, validate, save.
- Support SUB2API exports containing multiple accounts by converting/saving every account.
- Move reusable account import mode, converter registry, raw credential validation, and conversion helpers out of `components/ModelsConfig.tsx` into `lib/`.
- Make `POST /api/auth/accounts/[provider]` support `mode: "cpa"` and `mode: "sub2api"` directly by converting to raw before saving.
- Preserve saved credential format as the existing raw OAuth credential shape.
- Return clear validation/conversion errors for malformed source JSON or missing required fields.

## Acceptance Criteria

- [x] `components/ModelsConfig.tsx` imports shared converter/validator logic instead of owning CPA conversion logic.
- [x] SUB2API button is enabled and uses the converted-input UI.
- [x] Backend account import accepts `raw`, `cpa`, and `sub2api` modes.
- [x] Raw, CPA, and SUB2API imports all save through the existing account store path.
- [x] SUB2API `accounts[]` exports convert to a raw credential array and save all accounts.
- [x] Documentation module maps mention the shared converter module and updated API behavior.
- [x] `npm run lint` passes or only reports existing unrelated warnings.
- [x] `node_modules/.bin/tsc --noEmit` passes.
