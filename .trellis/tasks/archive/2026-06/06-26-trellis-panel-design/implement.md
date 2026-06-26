# Trellis Panel — Implementation Plan

> Implementation started after user approval for read-only MVP.

## Ordered Checklist

### 1. Config model and API

- [x] Extend `lib/pi-web-config.ts` with `PiWebTrellisConfig` and defaults.
- [x] Add normalization/validation helpers for the Trellis section.
- [x] Generalize config writing so `PUT /api/web-config` can accept partial `{ worktree?, trellis? }` updates.
- [x] Update `components/SettingsConfig.tsx` local state, dirty comparison, reset, and save logic for multi-section settings.
- [x] Add a Trellis settings tab with `enabled` and `includeArchived` toggles.

### 2. Shared allowed-root helper

- [x] Add `lib/allowed-roots.ts` with `getAllowedRoots()`, `registerAllowedRoot()`, and `isPathAllowed()` based on existing file API logic.
- [x] Update `/api/cwd/validate` to register successfully validated canonical cwd paths.
- [x] Use the helper in new Trellis API routes.
- [x] Optional cleanup: migrate existing file APIs to use the shared helper if scope remains small and safe.

### 3. Trellis reader library

- [x] Add `lib/trellis-reader.ts` for all `.trellis/tasks` reads.
- [x] Define normalized task summary/detail/progress types in `lib/types.ts` or `lib/trellis-types.ts`.
- [x] Implement active task scan under `<cwd>/.trellis/tasks`.
- [x] Implement optional archive scan under `<cwd>/.trellis/tasks/archive/YYYY-MM`.
- [x] Implement safe `task.json` parsing with explicit snake_case-to-camelCase field mapping and per-task read errors.
- [x] Implement symlink/realpath checks so task dirs and artifact files cannot escape the canonical workspace.
- [x] Implement markdown artifact reads with size caps.
- [x] Implement JSONL real-entry counts, ignoring `_example` rows.
- [x] Implement child progress and phase/progress derivation.

### 4. Trellis API routes

- [x] Add `app/api/trellis/tasks/route.ts` for task list.
- [x] Add `app/api/trellis/tasks/[taskKey]/route.ts` for detail.
- [x] Enforce `config.trellis.enabled` so routes are disabled unless the setting is on.
- [x] Validate missing/unauthorized cwd, symlink escapes, and invalid task keys.
- [x] Return normal empty state for workspaces without `.trellis/tasks`.
- [x] Keep routes read-only.

### 5. AppShell right drawer modes

- [x] Add `rightPanelMode: "files" | "trellis"` state to `components/AppShell.tsx`.
- [x] Fetch web config on mount and after Settings closes.
- [x] Keep file opening behavior: switch to `files`, open drawer, preserve tabs.
- [x] Add Trellis toggle button only when config is enabled.
- [x] Switch to files/close safely if Trellis is disabled while active.
- [x] Reuse current right panel CSS and mobile behavior.

### 6. Trellis panel UI

- [x] Add `components/TrellisPanel.tsx`.
- [x] Render no-workspace/no-trellis/no-task/error states.
- [x] Render task list with status grouping, hierarchy indentation, search/filter, archived toggle, refresh.
- [x] Render task detail with metadata, child progress, phase timeline, and artifact tabs.
- [x] Use existing `MarkdownBody` for artifact rendering.
- [x] Ensure loading states and aborted fetches do not set stale state.

### 7. Documentation

- [x] Update `docs/modules/api.md` with Trellis routes and web-config extension.
- [x] Update `docs/modules/frontend.md` with `TrellisPanel` and AppShell drawer mode.
- [x] Update `docs/modules/library.md` with Trellis reader and allowed-root helper.
- [x] Update `AGENTS.md` only if top-level navigation changes materially (not needed).

## Validation Plan

Minimum commands:

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

Current validation:

- [x] `node_modules/.bin/tsc --noEmit`
- [x] `npm run lint` (passes with pre-existing warnings in `components/ChatInput.tsx` and `hooks/useAgentSession.ts`)

Focused regression coverage:

- [ ] If adding a test harness is acceptable, add focused tests for config patching, task-key validation, reader parsing/error isolation, archive filtering, cwd denial, and symlink escape handling.
- [ ] If no test harness is added, perform equivalent manual API checks with representative fixture directories and document results in the final summary.

Manual checks:

- [ ] With Trellis disabled, no Trellis drawer button appears.
- [ ] Enable Trellis in Settings, save, close, and confirm button appears without restart.
- [ ] Open Trellis panel for a workspace with `.trellis/tasks`; list loads.
- [ ] Open Trellis panel for a workspace without `.trellis`; empty state is friendly.
- [ ] Select a task and verify details/artifacts/progress render.
- [ ] Toggle archived tasks and verify archived tasks appear/disappear.
- [ ] Open a file, switch to Trellis, switch back to Files, and verify file tab state remains.
- [ ] Try disabled feature access, missing/invalid cwd requests, invalid task keys, and symlink escape fixtures; verify API returns 400/403/404 as appropriate.
- [ ] Test responsive/mobile width by resizing below 640px.

## Risky Files / Rollback Points

| File | Risk | Rollback strategy |
| --- | --- | --- |
| `components/AppShell.tsx` | High: central layout and file drawer behavior. | Keep mode refactor minimal; verify file tabs before/after. |
| `components/SettingsConfig.tsx` | Medium: dirty/save logic currently assumes only WorkTree config. | Add clear helpers for comparing full config; keep UI behavior unchanged for WorkTree. |
| `lib/pi-web-config.ts` | Medium: persisted config compatibility. | Preserve unknown keys; keep `readPiWebConfig()` safe fallback. |
| `app/api/web-config/route.ts` | Medium: existing WorkTree settings save path. | Accept old `{ worktree }` payload and new partial payload. |
| New Trellis API | Medium: filesystem read exposure. | Validate cwd and resolve task keys only through scanned tasks. |

## Review Gates Before `task.py start`

- [ ] User approved read-only MVP vs write actions.
- [ ] User accepted shared right-drawer mode design.
- [ ] Prototype reviewed or explicitly skipped.
- [ ] `implement.jsonl` and `check.jsonl` contain relevant spec/research entries.

## Suggested Follow-up Slices

If the feature is too large for one implementation pass:

1. **Config + AppShell shell** — Trellis setting and empty drawer mode.
2. **Task list API/UI** — list summaries and states.
3. **Task detail/progress** — markdown artifacts and phase timeline.
4. **Polish/docs** — filters, archive toggle, responsive refinements, docs.
