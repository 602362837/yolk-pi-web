# Windows web terminal support

## Goal

Make the existing Web Terminal feature work on Windows in addition to macOS/Linux, with explicit support for common Windows shells such as Command Prompt, Windows PowerShell, and PowerShell 7.

## User Value

- Windows users can open an interactive project-local terminal from Pi Agent Web.
- Users can choose the shell that matches their workflow instead of relying on Unix-only defaults.
- Existing macOS/Linux terminal behavior remains unchanged.

## Confirmed Facts

- The archived Web Terminal MVP scope added shell selection for `zsh`, `sh`, `bash`, and `custom`.
- The MVP design did not explicitly include Windows shell types.
- Before this task, `lib/pi-web-config.ts` only accepted `zsh`, `bash`, `sh`, and `custom`; `cmd`, Windows PowerShell, and PowerShell 7 were not directly configurable as named shells.
- Before this task, `components/SettingsConfig.tsx` only exposed Unix shell choices plus custom path.
- Terminal configuration is persisted in `~/.pi/agent/pi-web.json` through `lib/pi-web-config.ts` and `/api/web-config`.
- Terminal processes are launched through the server terminal manager and exposed through `/api/terminal/sessions/**` routes.
- This task adds first-class `cmd`, `powershell`, and `pwsh` shell values while preserving existing `zsh`, `bash`, `sh`, and `custom` values.

## Requirements

- First verify whether the current implementation can already configure and launch Windows shells without code changes.
- If Windows is not supported directly, add first-class shell options for at least `cmd`, Windows PowerShell, and PowerShell 7.
- Shell resolution must be platform-aware: Unix defaults should remain Unix-oriented, and Windows defaults should use available Windows shells.
- Invalid or unavailable shell selections must produce clear launch errors instead of silently starting the wrong shell.
- Persisted terminal config must remain backward compatible with existing values.
- Frontend settings should expose Windows shell choices where appropriate without degrading macOS/Linux behavior.
- Documentation should be updated if API, frontend, or shared library terminal behavior changes.

## Acceptance Criteria

- [x] The implementation status of current Windows terminal configurability is documented in this task or final summary.
- [x] On Windows, users can select and launch `cmd`, Windows PowerShell, or PowerShell 7 when the executable is available.
- [x] On non-Windows platforms, existing `zsh`, `sh`, `bash`, and custom shell behavior continues to work.
- [x] Terminal launch rejects unavailable shell executables with a clear user-facing error.
- [x] Existing persisted configs using prior shell values continue to parse successfully.
- [x] Validation runs at least `npm run lint` and `node_modules/.bin/tsc --noEmit`, or records why they could not run.

## Out of Scope

- SSH terminal support.
- Windows-specific environment variable editor redesign.
- Persistent terminal sessions across browser refresh/server restart.
- Supporting shells beyond `cmd`, Windows PowerShell, PowerShell 7, and existing custom paths unless they fall out naturally from custom shell handling.

## Open Questions

- None currently blocking; repository inspection should answer whether direct Windows configuration is already supported.
