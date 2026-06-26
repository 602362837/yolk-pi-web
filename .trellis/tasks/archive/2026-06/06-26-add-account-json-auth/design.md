# Design: Add Account via Authorization JSON

## Problem Statement

`openai-codex` add-account currently has one path: start Codex OAuth in add mode and save the resulting credential. The new feature adds a parallel path where the user can paste a compatible authorization JSON credential and save it into the same account store.

## UX Design

### Entry point

- Keep the existing `Add Account` button in `OAuthDetail`.
- Change its click handler from `handleLogin("add")` to opening an add-account method modal.

### Step 1: Method selection modal

Title: `Add ChatGPT Plus/Pro account`

Options:

1. `Codex authorization`
   - Description: opens the existing browser authorization flow.
   - Action: close modal, call `handleLogin("add")`.
2. `Authorization JSON`
   - Description: paste a compatible OAuth credential JSON.
   - Action: switch modal to JSON input view.

### Step 2: JSON input modal

Use left/right layout inside the modal.

Left column:

- Brief instructions.
- Example raw JSON:

```json
{
  "type": "oauth",
  "access": "eyJ...",
  "refresh": "...",
  "expires": 1780000000000,
  "accountId": "optional-chatgpt-account-id"
}
```

- Notes:
  - `type`, `access`, `refresh`, and `expires` are required.
  - `accountId` is optional; if omitted, the server derives it from the access token claim or a stable hash fallback.
  - Account display label is auto-filled when possible: email first, then phone number, then accountId fallback.
  - The pasted account is saved but not activated automatically.

Right column:

- Mode selector with three options:
  - `Raw JSON` enabled and selected by default.
  - `CPA format` disabled, greyed out, with `Coming later` hint.
  - `SUB2API format` disabled, greyed out, with `Coming later` hint.
- Textarea for JSON.
- Error/status area.
- Footer actions: `Back`, `Cancel`, `Save account`.

## Backend Design

### Route option

Extend `app/api/auth/accounts/[provider]/route.ts` with `POST`:

Request:

```ts
{
  mode: "raw" | "cpa" | "sub2api";
  credential: unknown;
}
```

MVP behavior:

- `provider` must be `openai-codex` via existing `saveOAuthAccountCredential()` provider assertion.
- `mode === "raw"` is accepted.
- `mode === "cpa"` and `mode === "sub2api"` return `501 Not Implemented` or `400 Unsupported import mode` (UI disables them, but route should still reject explicitly).
- `credential` is validated by a shared helper in `lib/oauth-accounts.ts` and saved with `saveOAuthAccountCredential(provider, credential)`.
- Response should return the refreshed `OAuthAccountsList`, not the raw credential.

### Service/helper additions

In `lib/oauth-accounts.ts`, add a public function such as:

```ts
export type OAuthAccountImportMode = "raw" | "cpa" | "sub2api";

export async function importOAuthAccountCredential(
  provider: string,
  mode: OAuthAccountImportMode,
  payload: unknown,
): Promise<OAuthAccountsList>
```

Raw mode flow:

1. Normalize accepted raw payload shape.
2. Validate required OAuth credential fields.
3. Call `saveOAuthAccountCredential(provider, credential)` without `markActive`.
4. Return `listOAuthAccounts(provider)`, allowing the existing account-list backfill path to populate labels.

For future CPA/SUB2API support, keep mode dispatch centralized in this helper so converters can be added without spreading format logic into routes/components.

## Raw JSON Shape

Raw mode supports only the canonical saved account credential shape:

```json
{
  "type": "oauth",
  "access": "...",
  "refresh": "...",
  "expires": 1780000000000,
  "accountId": "optional"
}
```

Wrapper/import convenience shapes such as `{ "openai-codex": { ... } }` or `{ "credential": { ... } }` are intentionally out of scope for this iteration. This keeps the contract aligned with the existing per-account raw credential files.

## Data Flow

```text
Add Account button
  → method modal
  → Codex authorization → existing SSE login add path → saveOAuthAccountCredential()
  → Authorization JSON → POST /api/auth/accounts/openai-codex
      → importOAuthAccountCredential(raw)
      → saveOAuthAccountCredential(markActive=false)
      → listOAuthAccounts()
      → refresh OAuthDetail account list
```

## Account Label Backfill

The account list should expose a useful display name even when the user has not set a custom remark.

Priority:

1. Email address from access-token claims or OpenAI userinfo/me API responses.
2. Phone number from access-token claims or OpenAI userinfo/me API responses.
3. Account id fallback.

Implementation notes:

- Extend the existing label-resolution logic in `lib/oauth-accounts.ts` instead of adding UI-side parsing.
- Preserve user-set remarks: if `metadata.label` exists, do not overwrite it.
- Keep the existing `labelBackfillDisabledAt` behavior: if the user clears a remark, do not auto-fill it again.
- For fallback display, prefer the full or masked account id consistently with existing `displayName`/`maskedAccountId` behavior.
- Never echo token contents to the UI or logs while resolving labels.

## Error Handling

- Client catches JSON parse errors before submission and shows `Invalid JSON`.
- Server validates mode and credential shape before writing files.
- Server errors should be displayed in the modal and keep the input intact.
- Successful import closes or resets the modal and shows a success status in `OAuthDetail`.

## Security/Privacy Notes

- Never echo pasted tokens back to the UI.
- Keep credential files written through existing `writeJsonFile()` path with `0600` permissions.
- Do not log pasted credential payloads.
- Do not automatically activate pasted credentials; activation remains an explicit user action.

## Documentation Updates

- Update `docs/modules/api.md` to document `POST auth/accounts/[provider]/`.
- Update `docs/modules/frontend.md` if the modal is extracted into a named component.
- Update `docs/modules/library.md` if a new import helper is added to `lib/oauth-accounts.ts`.
