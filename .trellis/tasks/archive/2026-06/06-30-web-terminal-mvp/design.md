# Web Terminal MVP Design

## Summary

Add a local interactive terminal to pi-web using the existing Next.js HTTP route model: browser output streams over SSE, browser input/resize/close are sent with HTTP POST/DELETE. This avoids introducing a custom Next.js server solely for WebSocket upgrade handling while matching the app's existing SSE pattern for agent events.

## Existing Architecture Evidence

- `AppShell` owns active workspace state (`activeCwd`) and top-level layout.
- `SettingsConfig` persists web UI settings through `/api/web-config` and `lib/pi-web-config.ts` into `~/.pi/agent/pi-web.json`.
- Existing real-time agent output uses SSE under `app/api/agent/[id]/events/route.ts` rather than WebSocket.
- API routes run in `runtime = "nodejs"`, suitable for local child-process management.
- Path safety utilities already exist in `lib/allowed-roots.ts` and `lib/cwd.ts`.
- Current dependencies do not include a browser terminal emulator or PTY package.

## Proposed Phase-One Scope

### Configuration

Add `terminal` to `PiWebConfig`:

```ts
interface PiWebTerminalConfig {
  enabled: boolean;
  shell: "zsh" | "sh" | "bash" | "custom";
  customShellPath: string;
  env: Record<string, string>;
  envAssistant: PiWebSubagentRunPolicy;
  envAssistantFallback: PiWebSubagentRunPolicy;
}
```

Initial defaults:

- `enabled: false`
- `shell: "zsh"` on macOS/Linux when available, otherwise safe fallback to `sh`
- `customShellPath: ""`
- `env: {}`

Validation rules:

- `enabled` must be boolean.
- Shell must be an allow-listed value.
- `customShellPath`, if used, must be an absolute executable path; invalid/missing/non-executable paths should produce a clear terminal launch error.
- Env is stored as normalized key-value data.
- Env keys must match a conservative env-var key pattern (`^[A-Za-z_][A-Za-z0-9_]*$`).
- Env values are strings and may be empty.
- Env values are visible in the settings UI and persisted in plaintext in `~/.pi/agent/pi-web.json`; phase one does not provide secret storage or masking.
- Raw `.env`-like text import is a UI helper only: parse raw text into key-value rows, report parse conflicts/errors, then save only normalized rows.
- Local raw parsing should handle common shell token forms such as `export A=B C=D`; an optional Terminal env assistant model can parse more complex snippets into the same normalized rows.
- Reject or reserve dangerous names only if needed after risk review; phase one should at least avoid accepting invalid keys.

### Backend

Add `lib/terminal-manager.ts`:

- Global process registry under `globalThis.__piTerminalSessions` for hot reload resilience, similar to existing session globals.
- Create terminal sessions with:
  - validated allowed `cwd`
  - selected shell resolution
  - base `process.env` plus configured env overlay
  - PTY process through `@lydell/node-pty`
  - idle/disconnect cleanup policy
- Expose subscribe/write/resize/close helpers.

Add API routes:

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/terminal/env/assist` | POST | Use the configured Terminal env assistant model to parse complex raw env text into key-value entries. |
| `/api/terminal/sessions` | POST | Create a terminal session for a validated cwd. |
| `/api/terminal/sessions/[id]/events` | GET | Stream terminal output via SSE. |
| `/api/terminal/sessions/[id]/input` | POST | Write user input to the terminal. |
| `/api/terminal/sessions/[id]/resize` | POST | Resize terminal PTY columns/rows. |
| `/api/terminal/sessions/[id]` | DELETE | Close terminal session and kill process. |

Launch checks:

- Reject all terminal session creation when `pi-web.json` terminal config is disabled.
- Validate the requested cwd through allowed workspace roots.
- Use the canonical active workspace directory from the UI request; never infer from process cwd.
- Return explicit errors for missing cwd, disabled terminal, unavailable shell, invalid custom shell path, invalid env config, or unauthorized path.

### Frontend

Add components:

- `components/TerminalPanel.tsx`: terminal emulator container, connect/start/close state, resize handling.
- Optionally `hooks/useTerminalSession.ts`: create terminal, subscribe to SSE output, send input/resize, cleanup.

Add dependency candidates:

- `@xterm/xterm` for terminal rendering.
- `@xterm/addon-fit` for fitting terminal size to panel.
- `@lydell/node-pty` for a real local PTY (preferred for interactive shells). The original `node-pty` package failed under the local Node 26 runtime with `posix_spawnp failed`; `@lydell/node-pty` works in local testing.

UI placement decision:

- Add a bottom dock inside the center area below chat/placeholder.
- Top bar gets a `Terminal` toggle button when terminal is enabled and a workspace is selected.
- Bottom dock can be collapsed/expanded without consuming the existing right drawer used by Files/Trellis.

Rationale:

- A terminal is usually horizontal/wide.
- The right drawer is already overloaded with file and Trellis views.
- A bottom dock keeps chat context visible while commands run.

### Lifecycle Decision

Phase-one lifecycle should be simple:

- One terminal session per browser tab/workspace panel.
- Opening starts a process in the current `activeCwd`.
- Switching workspace closes the current terminal after confirmation or automatically with a visible status message.
- Closing the panel kills the process.
- Browser refresh/disconnect kills the process after a short grace period.
- No persistent terminal replay/session restore in phase one.

This minimizes orphan process risk and avoids terminal state becoming detached from the active workspace.

## Data Flow

```text
SettingsConfig ──PUT /api/web-config──▶ pi-web.json terminal config
AppShell activeCwd ──POST /api/terminal/sessions──▶ terminal-manager spawn cwd/shell/env
TerminalPanel ◀─GET /events SSE──────── terminal-manager output
TerminalPanel ──POST /input────────────▶ terminal-manager write
TerminalPanel ──POST /resize───────────▶ terminal-manager resize
TerminalPanel ──DELETE /session────────▶ terminal-manager kill
```

## Compatibility Notes

- Keep API runtime as Node.js.
- Do not rely on Next.js WebSocket upgrades for phase one.
- Native dependency `@lydell/node-pty` may affect install/build on some systems; validate before implementation or provide a documented fallback.
- Update `docs/modules/api.md`, `docs/modules/frontend.md`, and `docs/modules/library.md` when adding routes/components/lib modules.

## Security and Safety

- Default terminal is disabled.
- Server rejects terminal launches when disabled regardless of UI state.
- Only authorized workspace directories are accepted.
- Shell selection supports an allow-list plus custom absolute shell path with executable-path validation.
- Env injection is explicit and persisted in plaintext in `pi-web.json`; no secret masking or secret storage is included in phase one.
- Future SSH credentials/proxies/jump hosts are explicitly excluded.

## Open Decisions

- None blocking for MVP planning.
