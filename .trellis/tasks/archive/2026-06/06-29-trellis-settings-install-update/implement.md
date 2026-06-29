# Implementation Plan

## Read before coding

- `docs/modules/frontend.md`
- `docs/modules/api.md`
- `docs/modules/library.md`
- `docs/standards/code-style.md`
- `.trellis/spec/frontend/index.md`
- `.trellis/spec/frontend/quality-guidelines.md`
- Existing source:
  - `components/SettingsConfig.tsx`
  - `components/AppShell.tsx`
  - `lib/pi-web-config.ts`
  - `lib/npx.ts`
  - `app/api/skills/install/route.ts`
  - `app/api/trellis/tasks/route.ts`
  - `app/api/trellis/tasks/[taskKey]/route.ts`

## Ordered checklist

1. Extend config model
   - Add Trellis proxy fields to `PiWebTrellisConfig` defaults, normalization, validation, and write behavior in `lib/pi-web-config.ts`.
   - Update `trellisConfigsEqual()` and reset/save behavior in `components/SettingsConfig.tsx`.

2. Add setup/status types and helpers
   - Add `lib/trellis-manager.ts` and possibly `lib/trellis-setup-types.ts`.
   - Implement semver-ish version parsing for Node/Python/CLI requirements.
   - Implement status checks for OS, `process.version`, Python, CLI, `.trellis`, `.trellis/tasks`, `.trellis/.version`, `.trellis/.developer`.
   - Add fixed subprocess helper(s) for npm/trellis commands with timeouts, ANSI stripping, output caps, and proxy env application.

3. Add API routes
   - `GET app/api/trellis/setup/status/route.ts`
   - `POST app/api/trellis/setup/init/route.ts`
   - `POST app/api/trellis/setup/update/route.ts`
   - Each route validates cwd through `getAllowedRoots()` + `isPathAllowed()` before project access.
   - Mutation routes validate developer/proxy fields and re-check status before running commands.

4. Wire Settings UI
   - Pass active cwd from `AppShell` into `SettingsConfig`.
   - Add Trellis setup state/fetch/action handlers to `SettingsConfig`.
   - Default developer name from status response detected identity or OS username, keep it editable, and block setup when empty.
   - Add docs/guidance card with official URL.
   - Add proxy toggle/input fields.
   - Add status card and install/update action buttons with disabled reasons.
   - After successful setup, patch/save `trellis.enabled = true` and refresh AppShell config so the drawer button appears automatically.
   - Preserve existing save/reset/cancel behavior.

5. Documentation updates
   - Update `docs/modules/api.md` with new setup/status/update routes.
   - Update `docs/modules/frontend.md` for enhanced Settings Trellis controls.
   - Update `docs/modules/library.md` for new Trellis manager/types and config fields.

6. Validation
   - Run `npm run lint`.
   - Run `node_modules/.bin/tsc --noEmit`.
   - If `node_modules` is absent or environment blocks validation, record the blocker in the final response.

## Manual verification matrix

- No workspace selected: Settings shows docs/guidance; setup/update disabled.
- Workspace without `.trellis`: status recommends setup; update unavailable.
- Workspace with `.trellis`: setup disabled; update available.
- Workspace with failing Python check: setup/update disabled and prerequisite message shown.
- Proxy disabled: commands run without proxy env additions.
- Proxy enabled with URL: command env includes proxy vars only for the child process.
- Existing Trellis panel toggles still save and show/hide drawer as before.
- Disabled Trellis panel setting still makes task APIs return 403, but setup/status APIs remain usable.

## Risk points

- Cross-platform CLI invocation (`trellis` executable and `npm` global install) is the highest risk; avoid `shell: true` and prefer `node npm-cli.js`-style wrappers.
- Long-running install/update commands can exceed HTTP request expectations; MVP accepts non-streaming command calls with a generous timeout, but future work may need job polling/SSE.
- `trellis init` can create files; never run it if `.trellis` exists.
- Proxy validation must avoid accepting shell syntax as a command fragment; proxy only becomes env var values, not command text.

## Review gates before start

- Product decision resolved: successful setup auto-enables the Trellis drawer.
- Developer-name UX resolved: default from detected Trellis identity or OS username, allow editing, block empty values.
