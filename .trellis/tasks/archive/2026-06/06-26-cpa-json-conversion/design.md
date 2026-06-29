# Design: CPA JSON conversion support

## Architecture

Keep persistence unchanged: the backend account route continues to receive raw OAuth credential JSON. CPA support is a frontend conversion feature in `components/ModelsConfig.tsx`.

Add a small converter registry in the dialog code:

```ts
type ConvertibleImportMode = Exclude<OAuthAccountImportMode, "raw">;
interface AccountJsonConverter {
  mode: ConvertibleImportMode;
  label: string;
  sourcePlaceholder: string;
  convert: (input: unknown) => unknown;
}
```

CPA is the only enabled converter. SUB2API remains represented by the same registry shape but disabled until a converter is added.

## Data Flow

Raw mode:

```text
single textarea -> parse -> validate raw OAuth credential -> POST mode=raw credential
```

CPA mode:

```text
source CPA textarea -> parse -> CPA converter -> final raw OAuth textarea -> validate raw OAuth credential -> POST mode=raw credential
```

The final textarea is the submission source of truth for convertible modes. Users may adjust the converted JSON manually before validation/save.

## Contracts

### Raw OAuth final credential

Required:

- `type === "oauth"`
- `access` non-empty string
- `refresh` string (can be empty only if backend later allows it; current validation requires non-empty)
- `expires` finite number in milliseconds

Optional:

- `accountId` non-empty string
- additional token metadata such as `id_token`, `email`, `plan_type`

### CPA source credential

Accepted fields use common CPA variants:

- access token: `access_token` or `accessToken`
- refresh token: `refresh_token` or `refreshToken`
- expiry: `expired`, `expires`, `expires_at`, or `expiresAt`; strings are parsed as dates, numbers are treated as ms when greater than `1e11` and seconds otherwise
- account id: `account_id`, `chatgpt_account_id`, or `accountId`

## Error Handling

- JSON parsing errors are shown inline.
- Conversion errors identify missing CPA fields or invalid expiry.
- Validation errors identify missing/invalid final raw fields.
- Saving performs validation first and then posts `mode: "raw"` with the final credential.

## Extensibility

The UI checks whether the selected mode has a converter. Any converter mode uses the same two-pane conversion layout, validation action, save path, and source/final state. Future SUB2API support should add a `sub2api` converter entry and enable the mode button.
