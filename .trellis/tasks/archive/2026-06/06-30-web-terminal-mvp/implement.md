# Web Terminal MVP Implementation Plan

## Phase 0: Dependency/feasibility check

- [x] Verify `@xterm/xterm`, `@xterm/addon-fit`, and PTY compatibility with the project's Next.js/TypeScript setup.
- [x] Replace original `node-pty` with `@lydell/node-pty` after local Node 26 testing showed `node-pty` throws `posix_spawnp failed` while `@lydell/node-pty` works.

## Phase 1: Configuration model

- [x] Extend `lib/pi-web-config.ts` with `PiWebTerminalConfig`.
- [x] Add defaults under `DEFAULT_PI_WEB_CONFIG.terminal`.
- [x] Add config normalization/validation/read/write patch support for `terminal`.
- [x] Update `/api/web-config` request typing to accept `terminal`.
- [x] Update any UI config equality helpers in `SettingsConfig`.

## Phase 2: Backend terminal manager

- [x] Add `lib/terminal-manager.ts` with global registry, create/subscribe/write/resize/close helpers.
- [x] Add shell resolution, custom shell path validation, and env validation helpers.
- [x] Validate cwd through existing allowed-root utilities.
- [x] Add cleanup timers for disconnect/idle/session close.
- [x] Add Node.js API routes under `app/api/terminal/sessions/**`.
- [x] Ensure server-side disabled-state enforcement.

## Phase 3: Frontend terminal UI

- [x] Add terminal settings section to `SettingsConfig`, including shell allow-list, custom path field, env key-value rows, plaintext warning, and raw env import parser.
- [x] Add `TerminalPanel` and optional `useTerminalSession` hook.
- [x] Add top-bar Terminal toggle in `AppShell` when terminal is enabled and `activeCwd` is set.
- [x] Add bottom dock layout that coexists with chat, right drawer, and mobile sidebar.
- [x] Wire workspace switching to close or invalidate active terminal sessions.
- [x] Show clear errors for disabled terminal, missing cwd, unavailable shell, and unauthorized cwd.

## Phase 4: Documentation

- [x] Update `docs/modules/api.md` with terminal routes.
- [x] Update `docs/modules/frontend.md` with terminal components/hook.
- [x] Update `docs/modules/library.md` with terminal manager/config entries.
- [x] Update README or deployment docs only if native dependency/runtime requirements require it.

## Validation

Minimum validation:

```bash
npm run lint                       # completed; existing ChatInput warnings remain
node_modules/.bin/tsc --noEmit     # completed
```

Manual validation:

- [ ] Terminal disabled: UI entry hidden/disabled and POST launch returns an error.
- [ ] Terminal enabled: terminal opens in selected workspace and `pwd` matches `activeCwd`.
- [ ] Shell selection: `zsh` and `sh` launch where available; unavailable shell produces clear fallback/error.
- [ ] Custom shell path: valid executable paths launch; invalid/missing/non-executable paths show a clear error.
- [ ] Env injection: configured key appears in `env` inside terminal.
- [ ] Raw env import: raw text parses into editable key-value rows; saved config remains normalized key-value data.
- [ ] Workspace switch: terminal cannot continue targeting the previous cwd silently.
- [ ] Close/refresh: process exits or is cleaned up after documented grace period.

## Risk / Rollback Points

- Native dependency `@lydell/node-pty`: rollback by removing dependency and backend PTY integration before release.
- Terminal process leaks: ensure DELETE and disconnect cleanup are implemented before enabling UI entry.
- Path authorization mistakes: keep launch route denied by default unless cwd is authorized.
- Config migration: defaults should preserve existing `pi-web.json` files without requiring manual edits.
