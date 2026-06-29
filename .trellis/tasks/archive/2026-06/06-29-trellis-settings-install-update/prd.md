# Trellis settings install and update

## Goal

Make the Settings → Trellis section self-sufficient for users whose selected workspace does not yet have Trellis support: explain what Trellis is, link to the official docs, inspect prerequisites/status, initialize Trellis when safe, prevent duplicate initialization, offer updates for existing Trellis projects, and allow install/update commands to use a proxy.

Official docs link to show in-product: <https://docs.trytrellis.app/>

## User Value

- Users understand why the Trellis right-side panel needs project-level Trellis files before it can show useful tasks.
- Users can initialize Trellis for the selected workspace without leaving pi-web when prerequisites are satisfied.
- Users are protected from failed/unsafe installs when Node/Python/system requirements are missing.
- Existing Trellis projects are not reinitialized accidentally; users get an update path instead.
- Users behind a network proxy can configure install/update commands from the settings UI.

## Confirmed Facts From Repository Inspection

- `components/SettingsConfig.tsx` currently has a Trellis settings section with only `enabled` and `includeArchived` toggles, and copy that says the first version is read-only.
- `lib/pi-web-config.ts` currently persists `PiWebTrellisConfig` as `{ enabled: boolean; includeArchived: boolean }` in `~/.pi/agent/pi-web.json`.
- `components/AppShell.tsx` owns the active cwd context and opens `SettingsConfig`; the settings modal currently receives only `onClose`.
- Trellis drawer visibility is gated by `webConfig?.trellis.enabled`; task APIs also return 403 when this setting is disabled.
- `app/api/trellis/tasks/**` only read `.trellis/tasks`; they do not install, initialize, update, or shell out.
- `lib/trellis-reader.ts` already treats a missing `<cwd>/.trellis/tasks` as an empty/not-enabled workspace state and has symlink/path safety for read APIs.
- Existing command-execution patterns use `execFile` or the shell-free `runNpx()` helper in `lib/npx.ts`; `app/api/skills/install/route.ts` is the closest install-like API precedent.
- New API routes must update `docs/modules/api.md`; shared config/module changes must update `docs/modules/library.md` and possibly `docs/modules/frontend.md`.

## Confirmed Facts From Official Trellis Docs

Fetched from <https://docs.trytrellis.app/start/install-and-first-task.md> and <https://docs.trytrellis.app/start/everyday-use.md>:

- Global install command: `npm install -g @mindfoldhq/trellis@latest`.
- Supported systems: Mac, Linux, and Windows.
- Requirements: Node.js 18+ and Python 3.9+.
- Initialize a project with `trellis init -u your-name`; for Pi Agent specifically use `trellis init -u your-name --pi`.
- `your-name` becomes the developer identity and creates `.trellis/workspace/your-name/`.
- Re-running `trellis init -u your-name` for the same developer on the same machine is documented as a no-op when `.trellis/` and `.trellis/.developer` already exist.
- Updating has two layers: `trellis upgrade` updates the global CLI; `trellis update` syncs the current project to the local CLI version.
- `trellis upgrade` exists in CLI 0.6.0+; older CLIs need `npm install -g @mindfoldhq/trellis@latest` first.

## Requirements

### Trellis guidance in Settings

- The Trellis settings section must explain that the panel reads project-local Trellis state from `.trellis/tasks` and requires Trellis to be initialized in the selected workspace.
- The settings section must include a visible official docs link to `https://docs.trytrellis.app/`.
- The settings section should show the current selected workspace path when available; if none is available, install/init/update actions must be disabled with an explanatory message.

### Prerequisite/status inspection

- Add a server-side Trellis status API for a selected `cwd`.
- Status must validate `cwd` against allowed workspace roots before reading or writing project files.
- Status must report at least:
  - current OS support class (Mac/Linux/Windows supported; other platforms unsupported);
  - Node.js version and whether it satisfies Node 18+;
  - Python version and whether it satisfies Python 3.9+;
  - whether a usable Trellis CLI is available and its version when discoverable;
  - whether `<cwd>/.trellis` exists;
  - whether `<cwd>/.trellis/tasks` exists;
  - project Trellis version from `.trellis/.version` when present;
  - whether the project appears initialized for a local developer via `.trellis/.developer`;
  - recommended next action: install/init, update, or resolve prerequisites.
- If prerequisites fail, install/init/update buttons must be disabled and the UI must tell the user which prerequisite to fix manually.

### Install / init behavior

- Provide a Settings action that performs the safe setup path for a workspace that is not already initialized.
- The setup path must not run if required system prerequisites fail.
- The setup path must not reinitialize an existing Trellis project. If `.trellis` already exists, the UI must offer update instead.
- The Pi Agent platform flag must be used during initialization: `trellis init -u <developer> --pi`.
- The flow must default the Trellis developer name from an existing detected Trellis identity when available, otherwise from the OS username, while allowing the user to edit it. Empty names must block initialization.
- After successful setup, status should refresh and the Trellis panel setting should be enabled automatically.

### Update behavior

- For existing Trellis projects, provide an update operation instead of another install/init button.
- The update operation should support the documented two-layer update path:
  - update/upgrade global CLI when needed/available;
  - run `trellis update` in the selected workspace to sync project files.
- If an installed CLI is too old for `trellis upgrade`, fall back to `npm install -g @mindfoldhq/trellis@latest` before project update.
- After successful update, status should refresh.

### Proxy setting

- Add a Trellis proxy option in Settings for install/update commands.
- The proxy value must be optional and disabled by default.
- When enabled, proxy environment variables should be applied only to Trellis install/update child processes, not globally to the running web server.
- The UI must make clear that the proxy is used for networked Trellis CLI/npm operations.
- Proxy config must be persisted through `pi-web.json` validation without dropping existing WorkTree or Trellis settings.

### Security and command execution

- Do not expose an arbitrary command runner.
- New API routes must be purpose-specific, use fixed command/argument arrays, avoid `shell: true`, cap output, strip ANSI codes, and return concise errors.
- New install/update APIs must validate `cwd` against allowed roots before writing `.trellis` files.
- Browser payload fields such as developer name and proxy URL must be validated before reaching child-process environment/arguments.

### Documentation / maintainability

- Update module docs for new routes, config fields, and UI behavior.
- Keep reusable CLI/status helpers in `lib/` rather than duplicating subprocess and version parsing in route files.
- Preserve current read-only task panel behavior except for adding setup/update guidance in Settings.

## Acceptance Criteria

- [ ] Settings → Trellis shows an explanation of the required Trellis project support and links to `https://docs.trytrellis.app/`.
- [ ] Settings → Trellis shows selected-workspace status including system prerequisites, CLI availability/version, project initialization, and recommended action.
- [ ] If Node < 18, Python < 3.9, unsupported OS, missing workspace, or unauthorized cwd is detected, install/init/update actions are disabled with a clear message.
- [ ] For a workspace with no `.trellis`, the UI offers setup/init rather than update.
- [ ] Setup initializes Pi Agent support with `trellis init -u <developer> --pi` after ensuring the Trellis CLI is installed/available.
- [ ] For a workspace that already has `.trellis`, the UI does not offer duplicate install/init and instead offers update.
- [ ] Update refreshes the global CLI/project templates according to the documented `upgrade`/`update` distinction, with a fallback for older CLIs.
- [ ] The developer name input defaults from detected Trellis identity or OS username, remains editable, and blocks setup when empty.
- [ ] Proxy settings can be saved, loaded, reset, and applied to install/update subprocesses without affecting unrelated settings.
- [ ] New APIs validate cwd with allowed roots and do not use shell-concatenated commands.
- [ ] Successful setup automatically enables the Trellis right-side drawer setting and persists it.
- [ ] Existing Trellis drawer enable/archive toggles still save and work as before.
- [ ] `docs/modules/api.md`, `docs/modules/frontend.md`, and `docs/modules/library.md` are updated for the new behavior.
- [ ] `npm run lint` and `node_modules/.bin/tsc --noEmit` pass, or any environment blocker is documented.

## Out of Scope

- Editing Trellis tasks, PRDs, design docs, or specs from pi-web.
- Creating/starting/finishing/archiving Trellis tasks from pi-web.
- Real-time command streaming UI; MVP may show a busy state and final output/status.
- Supporting arbitrary Trellis marketplace template selection during init.
- Managing private registry tokens such as `GIGET_AUTH`.
- Bypassing official Trellis CLI behavior or modifying `.trellis` files directly for install/update.

## Decisions

- Successful setup should automatically enable the Trellis right-side drawer setting and persist that config change.
- The `trellis init -u <developer>` value should default from an existing detected Trellis identity when available, otherwise from the OS username, and stay editable in the UI.

## Open Questions

- None blocking implementation.
