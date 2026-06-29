# ChatGPT Plus/Pro multiple account switcher

## Goal

Let users store multiple ChatGPT Plus/Pro (`openai-codex`) OAuth accounts in pi-web and manually choose which one is currently active, without changing pi's provider/model identity model.

## Confirmed Facts

- Pi stores credentials in a single auth file at `~/.pi/agent/auth.json` (or `PI_CODING_AGENT_DIR/auth.json`).
- The current file stores credentials by provider key; the ChatGPT Plus/Pro entry is `openai-codex` with `type: "oauth"`, `accountId`, `access`, `refresh`, and `expires` fields.
- `AuthStorage.create()` reads/writes this active auth file and pi refreshes OAuth tokens back into the same provider entry.
- Existing pi-web auth UI treats OAuth providers as a single connected/disconnected provider and hides connected providers from the Add provider picker.
- The desired scope is not true concurrent multi-account routing. Only one ChatGPT Plus/Pro account needs to be active at a time.

## Requirements

- Add persistent storage for multiple saved `openai-codex` account credentials outside the active `auth.json` file.
- On first use, migrate/copy any existing active `auth.json.openai-codex` credential into the multi-account store.
- Keep non-ChatGPT credentials in `auth.json` untouched when activating or switching ChatGPT accounts.
- Add an `Add Account` action for ChatGPT Plus/Pro that reruns OAuth and saves the resulting account credential into the multi-account store.
- Add an account list in the ChatGPT Plus/Pro detail panel showing saved accounts and which one is active.
- Allow users to activate a saved account; activation copies that account credential into the active `auth.json` `openai-codex` entry.
- Before switching accounts, synchronize the current active `openai-codex` credential back into the multi-account store so refreshed tokens are not lost.
- After activation, reload active in-process pi sessions' auth storage/model registry as needed so subsequent requests use the newly active credential.
- After activation or Add Account, refresh the ChatGPT quota display and auth provider status.
- Preserve `auth.json` file permission behavior and avoid exposing access/refresh tokens in API responses or UI.

## Out of Scope

- True per-session or concurrent multi-account routing.
- Automatic quota-based account rotation or load balancing.
- Multi-account support for non-`openai-codex` OAuth providers unless it falls out naturally from shared helper code.
- Import/export of saved account credentials.

## Acceptance Criteria

- [ ] If `auth.json` already has `openai-codex`, opening/refreshing ChatGPT auth state creates a saved account entry for that credential.
- [ ] ChatGPT Plus/Pro detail panel shows saved accounts with an active marker.
- [ ] Clicking `Add Account` runs OAuth again and saves the new credential as a separate saved account keyed by `accountId`.
- [ ] Clicking `Activate` on a saved account replaces only the `openai-codex` credential in `auth.json` and leaves other provider credentials unchanged.
- [ ] Switching accounts syncs any refreshed active token back to the saved account before replacement.
- [ ] After switching accounts, new ChatGPT requests in existing server session wrappers use reloaded auth credentials.
- [ ] Quota display corresponds to the currently active ChatGPT account after switch.
- [ ] API responses never include raw `access` or `refresh` token values.
- [ ] `npm run lint` and `node_modules/.bin/tsc --noEmit` pass.

## Product Decision

- MVP uses a masked/short account id display. Metadata preserves optional labels for a future rename flow, but no label editing UI is included in this task.
