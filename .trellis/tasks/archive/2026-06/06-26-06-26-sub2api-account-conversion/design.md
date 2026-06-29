# Design

## Shared converter module

Create `lib/oauth-account-converters.ts` as the single owner for account import formats:

- `OAuthAccountImportMode = "raw" | "cpa" | "sub2api"`
- `ConvertibleAccountImportMode = Exclude<OAuthAccountImportMode, "raw">`
- raw/CPA/SUB2API placeholder examples
- converter metadata registry for UI
- JSON record/date/string helpers
- raw credential validator
- `convertCpaCredentialToRaw()`
- `convertSub2apiCredentialToRaw()`
- `convertOAuthAccountCredential(mode, credential)`
- `isOAuthAccountImportMode(value)` for route validation

The shared converter returns the existing raw OAuth shape:

```json
{
  "type": "oauth",
  "access": "...",
  "refresh": "...",
  "expires": 1780000000000,
  "accountId": "optional"
}
```

## SUB2API field strategy

Because SUB2API exports can contain an `accounts[]` array, convert each account to one raw OAuth credential and return an array when multiple accounts are present. For each account, read OAuth values from the nested `credentials` object first, with account-level fallback for expiry/account metadata.

Supported aliases:

- access: `credentials.access_token`, `credentials.accessToken`, `credentials.access`
- refresh: `credentials.refresh_token`, `credentials.refreshToken`, `credentials.refresh` (empty string is allowed when SUB2API exported no refresh token)
- expires: `credentials.expires_at`, `credentials.expiresAt`, `credentials.expires`, `account.expires_at`, `account.expiresAt`, `account.expires`
- account id: `credentials.chatgpt_account_id`, `credentials.account_id`, `credentials.accountId`, `account.account_id`, `account.accountId`

If fields are nested in another known wrapper later, extend only `convertSub2apiCredentialToRaw()`.

## Frontend

`ModelsConfig.tsx` should import the converter registry and examples. Existing UI branching remains: raw mode gets one textarea; converter modes get source textarea, convert button, final raw textarea, validate, save.

## Backend

`lib/oauth-accounts.ts` should import `OAuthAccountImportMode` and `convertOAuthAccountCredential()`. `importOAuthAccountCredential()` converts any supported mode to one or more raw credentials, verifies each satisfies the stored credential guard, and then saves normally.

`app/api/auth/accounts/[provider]/route.ts` should use `isOAuthAccountImportMode()` instead of hard-coded string checks.
