# Web terminal MVP

## Goal

Add a first-phase web terminal capability to Pi Agent Web so users can open an interactive local shell inside the current project workspace and configure whether terminal support is available.

## User Value

- Users can run project-local commands without leaving the web UI.
- The terminal starts in the same workspace/project directory as the active session.
- Users can choose a preferred local shell and inject environment variables for terminal sessions.

## Confirmed User Scope

- Include a setting to enable or disable the web terminal feature.
- When opened, the terminal should automatically `cd` to the current project workspace directory.
- Include terminal type selection, for example `zsh` or `sh`, and support a custom shell path.
- Include environment injection/configuration for terminal sessions using key-value rows, plus raw text import that parses into those rows.
- Include an optional AI-assisted raw env parser with configurable primary/fallback models for complex shell snippets.
- SSH information management is a future capability, not part of this phase.
- Proxy and multi-hop jump host support for SSH are future capabilities, not part of this phase.

## Repository Facts

- Top-level workspace state is already tracked in `components/AppShell.tsx` as `activeCwd`.
- Persistent web UI settings already live in `~/.pi/agent/pi-web.json` via `lib/pi-web-config.ts` and `/api/web-config`.
- Existing streaming agent output uses HTTP SSE rather than WebSocket, so terminal output can follow the same app-route-friendly streaming pattern.
- `lib/allowed-roots.ts` and `lib/cwd.ts` provide reusable workspace/path authorization helpers.
- No terminal emulator or PTY dependencies are currently installed.

## Requirements

- Terminal availability is controlled by persisted web UI settings.
- Terminal launch is also enforced server-side; disabling the feature cannot be bypassed by calling the API directly.
- The terminal process launches in the selected/current workspace directory.
- The configured shell is used when starting a terminal process, with safe fallback or clear error behavior if unavailable.
- Custom shell path is supported; if the user enters an invalid, missing, or non-executable path, terminal launch fails with a clear error message.
- Configured environment variables are injected into terminal processes without mutating the base server environment.
- Environment variable settings are persisted and interpreted as normalized key-value rows; raw text is only an import helper and is parsed into rows before saving.
- Raw env import supports common shell forms such as `export A=B C=D`; complex cases can be parsed through the configured AI assistant into the same key-value rows.
- Environment variable values are treated as normal visible settings and saved in plaintext in `~/.pi/agent/pi-web.json`.
- The UI exposes a discoverable place to configure terminal enablement, shell type, and environment variables.
- The UI provides a way to open and interact with the terminal only when the feature is enabled and a workspace is selected.
- Terminal lifecycle behavior is defined for open, close, navigation between sessions/workspaces, browser refresh, and server restart.

## Acceptance Criteria

- [ ] With terminal disabled, terminal UI entry points are hidden or disabled and terminal server endpoints reject launches.
- [ ] With terminal enabled, opening a terminal starts an interactive shell in the active workspace directory.
- [ ] The shell selection supports at least `zsh` and `sh` where available, with clear fallback or error behavior.
- [ ] Custom shell path is accepted and invalid custom paths produce clear user-facing errors.
- [ ] Environment variables configured in settings are present in the spawned terminal process.
- [ ] Environment editor supports key-value rows and raw text import; parsed raw values become editable rows, and saved config only uses key-value data.
- [ ] Raw env parser handles `export https_proxy=... http_proxy=... all_proxy=...` as multiple variables, and AI parsing can be used for complex snippets.
- [ ] Closing the terminal cleans up the spawned process or documents any persistent-session behavior.
- [ ] Changing workspace/session does not accidentally run commands in the wrong directory.
- [ ] SSH host/profile management, proxy support, and multi-hop jump host support remain out of scope for this phase.

## MVP Decisions

- Use a bottom dock terminal panel rather than the right drawer, because terminal workflows need width and the right drawer is already used for files/Trellis.
- Keep terminal processes ephemeral for phase one: alive while the terminal dock is open/collapsed in the current tab, killed on explicit close or workspace switch/refresh cleanup.
- Use SSE for terminal output plus POST/DELETE routes for input, resize, and cleanup, avoiding a custom Next.js WebSocket server in phase one.
- Use `@xterm/xterm` in the browser and `@lydell/node-pty` on the server for interactive shell fidelity; the original `node-pty` failed under the local Node 26 runtime.
- Support custom shell path in phase one; invalid/missing/non-executable paths should fail with a clear error rather than silently falling back.
- Use key-value rows as the authoritative environment variable model; provide raw text parsing/import only as a convenience that fills the rows.
- Provide configurable Terminal env AI parsing model/fallback model controls; AI parsing also only fills key-value rows.
- Store terminal environment values in plaintext and show a clear settings UI note that they are not secret-managed.

## Out of Scope

- SSH credential/profile management.
- SSH proxy configuration.
- Multi-layer jump host orchestration.
- Browser-to-remote-terminal sharing beyond local project shell access.
- Full terminal collaboration or replay features.
- Persisting terminal history/replay across browser refresh or server restart.

## Open Questions

- None blocking for MVP planning.
