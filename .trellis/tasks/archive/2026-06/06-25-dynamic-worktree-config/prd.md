# Dynamic worktree configuration page

## Goal

Add a UI-backed dynamic configuration flow for the existing `~/.pi/agent/pi-web.json` worktree settings so users can change New WorkTree defaults without editing JSON files or restarting pi-web.

## User Value

Users who create worktrees from pi-web can adjust branch naming, base ref, target directory/path templates, and display behavior directly in the web UI. Changes should be saved persistently and used by subsequent New WorkTree creation requests.

## Confirmed Facts

- Worktree creation already reads `readPiWebConfig()` inside `POST /api/git/worktrees`, so newly saved config can affect future worktree creation dynamically because the route reads the file per request.
- The current config loader lives in `lib/pi-web-config.ts` and reads `~/.pi/agent/pi-web.json` via `getAgentDir()`.
- Defaults are:
  - `worktree.baseRef = "HEAD"`
  - `worktree.branchNameTemplate = "pi/{yyyyMMdd-HHmmss}"`
  - `worktree.baseDirTemplate = "{repoParent}/{repoName}.worktrees"`
  - `worktree.pathTemplate = "{baseDir}/{branchSlug}"`
  - `worktree.sessionDisplay = "separate"`
- Existing config reading is forgiving: missing or malformed config falls back to defaults; individual invalid strings also fall back.
- There is no API route for reading/writing `pi-web.json` yet.
- `AGENTS.md` documents `~/.pi/agent/pi-web.json` as the web config data file and says it is currently used for New WorkTree defaults.
- `ModelsConfig` is an existing precedent for a settings modal backed by `GET/PUT /api/models-config`.
- The bottom-left settings strip in `components/AppShell.tsx` already exposes `Models`, `Usage`, and `Skills`, making it a natural location for a new settings entry.
- The previous New WorkTree task intentionally made the config file optional and did not include a config UI.

## Requirements

1. Provide a user-facing configuration UI for New WorkTree defaults.
2. Persist settings to `~/.pi/agent/pi-web.json` through an API route instead of requiring manual file edits.
3. Saved values must apply to subsequent `New WorkTree` calls without restarting pi-web.
4. The UI must expose at least:
   - base ref;
   - branch name template;
   - base directory template;
   - worktree path template;
   - session display mode.
5. The UI must show the built-in defaults and support restoring/resetting worktree config to defaults.
6. The UI must explain supported template variables:
   - `{repoRoot}`
   - `{repoParent}`
   - `{repoName}`
   - `{baseDir}`
   - `{branchName}`
   - `{branchSlug}`
   - `{yyyyMMdd-HHmmss}`
7. The backend must validate/normalize writes enough to prevent unusable blank fields or invalid `sessionDisplay` values.
8. Existing hand-written unknown top-level `pi-web.json` fields should not be destroyed when saving worktree settings, unless explicitly reset for the worktree section.
9. Errors for unreadable/malformed config files or save failures must be visible in the UI.
10. Existing New WorkTree behavior and defaults must remain unchanged when no config file exists.

## Acceptance Criteria

- [ ] A user can open a configuration page/modal from the main UI.
- [ ] The page/modal loads effective worktree settings and indicates the config file path or data directory context.
- [ ] Editing any worktree field and saving writes `~/.pi/agent/pi-web.json`.
- [ ] A subsequent `New WorkTree` request uses the newly saved `baseRef`, naming template, and path templates without server restart.
- [ ] Resetting to defaults restores the documented default worktree values.
- [ ] Invalid blank template/base fields and invalid `sessionDisplay` are rejected with a visible error.
- [ ] Unknown existing `pi-web.json` keys outside `worktree` are preserved after save.
- [ ] Existing `models.json` configuration UI and existing `New WorkTree` flow continue to work.
- [ ] `npm run lint` passes.
- [ ] `node_modules/.bin/tsc --noEmit` passes.

## Out of Scope

- UI for deleting/pruning Git worktrees.
- Per-project/per-repository worktree config overrides.
- Immediate editing of per-creation overrides in the New WorkTree button flow.
- Copying environment files or bootstrapping dependencies inside created worktrees.
- General settings for models, skills, auth, usage, or themes beyond a page structure needed to host WorkTree settings.

## Product Decisions

- Use a generic `Settings` page/modal as the product surface.
- The initial Settings content will only include a `WorkTree` section/tab.

## Open Questions

None blocking.
