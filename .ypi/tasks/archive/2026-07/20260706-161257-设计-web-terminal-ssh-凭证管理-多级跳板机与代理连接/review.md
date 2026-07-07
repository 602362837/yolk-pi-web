# review

## Implementer self-review: tests-docs-security-review

- Scope respected: only validation/docs/security review plus small fixes required for wired UI/API and validation.
- Added dry-run coverage for core SSH terminal security assumptions without requiring a real SSH server/proxy.
- Confirmed minimum validation passes:
  - `npm run lint`
  - `node_modules/.bin/tsc --noEmit`
  - `node scripts/test-terminal-ssh-config.mjs`

## Security boundary checklist

- `pi-web.json` stores only non-secret profile/config fields; recursive validation rejects secret field names.
- Credential APIs return summary objects and do not echo secret material.
- SSH launch redacted plan hides temp config path and secret values.
- Built-in SOCKS5/HTTP proxy command references a temp context path and does not inline proxy password.
- Custom ProxyCommand has global/profile gates and rejects secret placeholders/control chars.
- known_hosts uses a dedicated file and docs warn that `ssh-keyscan` is advisory.

## Checker review

### Findings Fixed

- Added `proxyUsername` to `TerminalCredentialSummary` and prefilled it in `components/TerminalSshCredentialEditor.tsx`, fixing proxy-auth credential edits that previously cleared the username and could fail validation.
- Redacted `TerminalSshRedactedLaunchPlan.tempDir` to `"<session-temp-dir>"` so resolve/test responses no longer expose the real per-session temp directory path.

### Remaining Findings

- **Needs work:** dedicated SSH profile CRUD routes from the design/implementation plan are still not implemented. Profiles currently rely on whole-config `/api/web-config` saves plus `/api/terminal/ssh/profiles/[id]/test`; this is weaker than the planned `profiles` API surface and leaves the profile contract only indirectly enforced at the API boundary.

### Verification

- `npm run lint` — pass
- `node_modules/.bin/tsc --noEmit` — pass
- `npm run test:terminal-ssh` — pass

### Verdict

- **Needs work** — core secret/vault/known_hosts/runner boundaries look sound in static review and dry-run validation, but profile CRUD/API coverage still falls short of the stated design/implementation contract.

## Checker re-review after profile CRUD fix

### Findings Fixed

- Dedicated SSH profile CRUD routes now exist at `app/api/terminal/ssh/profiles/route.ts` and `app/api/terminal/ssh/profiles/[id]/route.ts`, wired through `lib/terminal-ssh-profiles.ts` for list/create/read/update/delete.
- Create/update now reject secret-bearing profile payloads at the API boundary via `rejectSecretFields()` in `lib/terminal-ssh-profiles.ts` before writing `terminal.ssh.profiles` back to `pi-web.json`.
- `/api/terminal/ssh/profiles/[id]/test` still resolves profiles through the non-secret config path and returns `plan.redacted`, with session temp dir/path redacted.

### Remaining Findings

- None.

### Verification

- `npm run lint` — pass
- `node_modules/.bin/tsc --noEmit` — pass
- `npm run test:terminal-ssh` — pass

### Verdict

- **Pass** — dedicated profile CRUD API is implemented, profile create/update reject secret fields at the route/helper boundary, TerminalPanel still defaults local and only opts into SSH with `{ kind: "ssh", profileId }`, Settings/Picker paths remain non-secret, and vault/redacted-plan boundaries remain intact in current code and dry-run validation.
