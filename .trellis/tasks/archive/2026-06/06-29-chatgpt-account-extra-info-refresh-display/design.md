# Design

## Scope

This task spans account metadata storage, API contracts, quota querying, and the account management UI for the `openai-codex` ChatGPT Plus/Pro provider.

## Data Flow

```text
User edits extra info in UI
  -> PATCH /api/auth/accounts/openai-codex { accountId, label?, extraInfo? }
  -> lib/oauth-accounts.ts normalizes and persists metadata
  -> GET /api/auth/accounts/openai-codex returns OAuthAccountSummary.extraInfo
  -> OAuthAccountsView renders remark, extra info, and quota reset details
```

Quota reset display:

```text
Saved account credential
  -> subscription quota service query with that account's access token/account id
  -> API returns SubscriptionQuota with tiers[].resetsAt
  -> UI formats reset countdown/time in account row
```

## Storage Contract

`OAuthAccountMetadataEntry` gains an optional string field:

- `extraInfo?: string`

Rules:

- Missing field is valid for existing metadata.
- Empty/whitespace input clears the field.
- Non-empty input is trimmed before persistence.
- Any metadata update should refresh `updatedAt`.

## API Contract

`OAuthAccountSummary` gains:

- `extraInfo?: string`

`PATCH /api/auth/accounts/[provider]` should update account metadata. To preserve current behavior and avoid multiple routes for one account metadata object, the PATCH body can include either or both editable fields:

```json
{ "accountId": "...", "label": "optional remark", "extraInfo": "optional extra info" }
```

If only `label` is provided, only label changes. If only `extraInfo` is provided, only extra info changes. This keeps the current remark UI compatible while enabling the new field.

Quota API behavior:

- The active account is refreshed automatically via the existing quota flow.
- Inactive accounts render cached last quota reset data when available.
- Each account row has a manual refresh button that queries that account's saved credential by `accountId` without activating the account metadata.
- Manual saved-account refresh uses the shared OAuth refresh helper for expired saved tokens, then writes refreshed credentials back to the account store.
- The resulting quota summary is stored as account metadata cache, not as raw upstream response data.

## UI Contract

- Keep the account list compact.
- Show display name/remark as the main line.
- Show masked account id and optional extra info as secondary metadata.
- Provide an edit action for extra info using an in-app dialog, not a browser prompt, so the field is visually distinct from the remark editor.
- Show quota reset timing in the account row when available, with compact inline usage pie indicators beside the reset text. The detail quota panel remains the full usage visualization.

## Compatibility and Risk

- Backward compatibility is handled by metadata normalization ignoring missing fields.
- Auto-querying every saved account is intentionally avoided; only active account refreshes automatically and inactive accounts refresh on explicit user action.
- Do not store secrets in `extraInfo`; it is metadata stored in the account metadata JSON rather than credential JSON.

## Documentation

Update `docs/modules/api.md` to describe the expanded accounts PATCH behavior and quota reset display support if an API route changes.
