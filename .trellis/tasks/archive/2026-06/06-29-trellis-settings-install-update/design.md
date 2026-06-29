# Design: Trellis settings install/update support

## Overview

Add a Trellis setup/update control plane around the existing read-only Trellis panel. The read panel remains unchanged: it reads tasks through `app/api/trellis/tasks/**` only when `pi-web.json.trellis.enabled` is true. The new control plane lives in Settings and uses separate APIs that are available even when the panel is disabled, because users need setup/status before enabling the panel.

## Boundaries

### Client/UI

- `components/AppShell.tsx`
  - Pass the active workspace cwd into `SettingsConfig`.
  - Continue reloading web config when settings closes.
- `components/SettingsConfig.tsx`
  - Extend the Trellis section with guidance, official docs link, proxy fields, status card, developer-name input, setup button, and update button.
  - Keep existing `enabled` and `includeArchived` toggles.
  - Fetch Trellis status whenever the modal is open on the Trellis section and `cwd` changes, and after setup/update completes.

### API routes

Proposed routes under `app/api/trellis/setup/`:

- `GET /api/trellis/setup/status?cwd=<absolute-cwd>`
  - Returns prerequisite checks, CLI/project state, and recommended action.
  - Does not require `config.trellis.enabled`; otherwise an uninitialized user could not inspect status.
- `POST /api/trellis/setup/init`
  - Body: `{ cwd: string; developerName: string }`.
  - Validates prerequisites, validates non-empty editable developer name, and prevents duplicate init.
  - Ensures/installs CLI, then runs `trellis init -u <developerName> --pi` in `cwd`.
- `POST /api/trellis/setup/update`
  - Body: `{ cwd: string }`.
  - Validates prerequisites and requires `.trellis` to exist.
  - Runs global CLI upgrade path, then `trellis update` in `cwd`.

Alternative considered: fold these into existing `app/api/trellis/tasks` routes. Rejected because task APIs are gated by the read-panel enable switch and are read-only by contract.

### Shared library

Add `lib/trellis-manager.ts` or equivalent to own reusable setup/update logic:

- `getTrellisSetupStatus(cwd): Promise<TrellisSetupStatus>`
- `initializeTrellisProject({ cwd, developerName, proxy }): Promise<TrellisCommandResult>`
- `updateTrellisProject({ cwd, proxy }): Promise<TrellisCommandResult>`
- version parsing/comparison helpers for Node/Python/Trellis CLI
- fixed command wrappers for npm/trellis subprocesses

Add `lib/trellis-setup-types.ts` if wire types become large; otherwise export focused types from `lib/trellis-types.ts`.

## Data contracts

### Config extension

Extend `PiWebTrellisConfig`:

```ts
interface PiWebTrellisConfig {
  enabled: boolean;
  includeArchived: boolean;
  proxyEnabled: boolean;
  proxyUrl: string;
}
```

Validation:

- `proxyEnabled` must be boolean.
- `proxyUrl` may be empty when disabled.
- If enabled, `proxyUrl` must be a non-empty `http://`, `https://`, or `socks://` style URL string accepted by the selected command tools. If SOCKS support is uncertain for npm, the UI should say HTTP(S) proxy is recommended and validation should prefer `http://` / `https://` unless product scope explicitly needs SOCKS.
- Normalization must preserve defaults for older config files that lack these fields.

### Status response shape

```ts
interface TrellisSetupStatus {
  cwd: string;
  supportedOs: boolean;
  platform: NodeJS.Platform;
  node: { version: string; ok: boolean; required: string };
  python: { command?: string; version?: string; ok: boolean; required: string; error?: string };
  cli: { installed: boolean; version?: string; upgradeCommandAvailable?: boolean; error?: string };
  project: {
    hasTrellisDir: boolean;
    hasTasksDir: boolean;
    version?: string;
    hasDeveloperIdentity: boolean;
    developerName?: string;
  };
  suggestedDeveloperName: string;
  canInitialize: boolean;
  canUpdate: boolean;
  blockingReasons: string[];
  recommendedAction: "select-workspace" | "fix-prerequisites" | "initialize" | "update" | "ready";
}
```

### Command response shape

```ts
interface TrellisCommandResponse {
  success: boolean;
  output: string;
  status: TrellisSetupStatus;
  error?: string;
}
```

Return capped, ANSI-stripped output. Avoid leaking unrelated environment values.

## Command execution strategy

- Never use `shell: true` or a concatenated command string.
- Reuse `runNpx()` patterns where possible.
- Add an npm wrapper similar to `lib/npx.ts` that invokes `npm-cli.js` through `process.execPath` when available, avoiding Windows `.cmd` shell issues:
  - install/old-CLI fallback: `node <npm-cli.js> install -g @mindfoldhq/trellis@latest`
- Invoke Trellis CLI through a fixed mechanism:
  - Prefer the resolved global `trellis` executable with `execFile` when safe.
  - If cross-platform resolution is unreliable, use `npx`/npm exec with fixed package/bin arguments, but keep behavior aligned with official global install docs.
- Use timeouts and output caps:
  - status checks: short timeout, e.g. 5-10s;
  - install/update commands: longer timeout, e.g. 2-5 minutes.
- Apply proxy env only for command calls when `proxyEnabled && proxyUrl`:
  - `HTTP_PROXY`, `HTTPS_PROXY`, `http_proxy`, `https_proxy`
  - npm-specific `npm_config_proxy`, `npm_config_https_proxy`

## Status and action rules

1. No `cwd` from AppShell → show docs/guidance, disable actions.
2. `cwd` unauthorized → API 403; UI shows action disabled.
3. Unsupported OS or Node/Python too old/missing → `recommendedAction = "fix-prerequisites"`; no install/update.
4. `.trellis` missing → `canInitialize = true`; show setup action.
5. `.trellis` exists → `canInitialize = false`; show update action instead.
6. `.trellis` and `.trellis/tasks` exist with local developer identity → status may be `ready`; still show update as maintenance action.
7. CLI missing but prerequisites pass → init action may install CLI first; update action may install/upgrade CLI before project update.
8. Successful init → persist `trellis.enabled = true` after command success, then refresh status and AppShell config so the right-side drawer entry appears automatically.

## UI behavior

- Place a guidance card at the top of the Trellis section:
  - brief explanation;
  - official docs link opening in a new tab;
  - selected workspace path.
- Place existing toggles after or alongside setup status. The enable switch remains a panel visibility/API gate; it is not a substitute for project initialization.
- Add proxy controls:
  - toggle: "安装/更新 Trellis 时使用代理";
  - input: proxy URL;
  - helper text: applies only to setup/update commands.
- Add status card:
  - prerequisite rows with pass/fail badges;
  - project rows for `.trellis`, `.trellis/tasks`, project version, CLI version;
  - recommended action text.
- Add developer name input:
  - default from detected `.trellis/.developer` when available;
  - otherwise default from OS username;
  - remains editable;
  - empty value disables setup.
- Add action buttons:
  - "安装并初始化 Trellis" for missing `.trellis`;
  - "更新 Trellis" for existing `.trellis`;
  - disabled states list the first blocking reason.
- MVP command execution can be non-streaming: show busy text, then final success/error output snippet and refreshed status.
- After setup succeeds, automatically save/patch the Trellis panel enable setting so users can immediately open the drawer.

## Compatibility and migration

- Existing `pi-web.json` files without proxy fields normalize to `proxyEnabled: false`, `proxyUrl: ""`.
- Existing Trellis panel setting behavior remains disabled-by-default for new `pi-web.json` files; successful setup intentionally changes it to enabled.
- Existing task APIs remain gated by `trellis.enabled` and unchanged.
- Setup/status routes must be added to docs because they mutate/read local project state beyond task reads.

## Rollback considerations

- If a command fails, report stderr/stdout and leave config unchanged except explicit saved proxy/settings changes.
- Do not delete or rewrite `.trellis` from pi-web. Official CLI owns file changes.
- If init creates partial files then fails, surface that `.trellis` now exists on the next status refresh and offer update/manual docs rather than attempting cleanup.
