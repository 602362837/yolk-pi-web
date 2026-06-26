# Trellis Panel Design

## Goal

Design an optional Trellis panel for pi-web so users can inspect Trellis task work from the browser without leaving the chat UI. When enabled in Settings, the app exposes a right-side drawer that lists Trellis tasks for the active workspace. Selecting a task shows task details, artifacts, hierarchy, and a clear phase/progress view.

## User Value

- Users can see Trellis planning/execution state beside the chat session instead of switching to terminal/files.
- Users can understand how many phases a task has, which phase is current, and what artifacts are complete.
- Trellis remains optional and unobtrusive for users/projects that do not use it.

## Confirmed Facts From Repository Inspection

- `components/AppShell.tsx` owns the main layout, Settings modal, and existing right-side file drawer.
- The existing right drawer is file-specific today: `fileTabs`, `activeFileTabId`, `rightPanelOpen`, `FileViewer`, and `.right-panel-container` CSS.
- `components/SettingsConfig.tsx` edits persisted web settings through `GET/PUT /api/web-config`.
- `lib/pi-web-config.ts` owns `~/.pi/agent/pi-web.json`, currently with only a `worktree` section.
- `app/api/web-config/route.ts` currently validates a required `worktree` payload on PUT; it must be generalized before Trellis-only saves work.
- `app/api/cwd/validate/route.ts` can validate arbitrary existing directories, while current file API allowed-root caches are session/default-cwd based; Trellis authorization must account for validated custom workspaces.
- Trellis task metadata lives under `<workspace>/.trellis/tasks/<MM-DD-slug>/task.json`; archived tasks live under `<workspace>/.trellis/tasks/archive/YYYY-MM/<MM-DD-slug>/`.
- Task details can be derived from sibling files such as `prd.md`, `design.md`, `implement.md`, `implement.jsonl`, and `check.jsonl`.
- Task status values observed in scripts/docs include `planning`, `in_progress`, `review`, `completed`, and historical `done`.
- Current per-AI-session active task pointers are stored under `.trellis/.runtime/sessions/` and are session-scoped; the web UI should not depend on this private state for MVP.

## Requirements

### Settings

- Add a persistent Trellis settings section under the existing Settings modal.
- Trellis panel must be disabled by default.
- When enabled, the main UI should show an entry point for the Trellis right drawer.
- Trellis settings should be saved in `~/.pi/agent/pi-web.json` and preserve existing WorkTree settings.
- Recommended MVP settings:
  - `enabled: boolean` — controls whether the Trellis panel entry point is visible.
  - `includeArchived: boolean` — default list behavior for archived tasks.

### Right Drawer Behavior

- Reuse the existing right-side drawer shell rather than adding another overlapping layout region.
- Generalize the drawer into modes, at minimum `files` and `trellis`.
- Opening a file should keep existing file-panel behavior and switch to `files` mode.
- Opening Trellis should switch to `trellis` mode without losing current file tabs.
- On desktop, the drawer should keep the current animated width behavior.
- On mobile, the drawer should reuse the current full-width behavior.

### Task List

- Show Trellis tasks for the selected/active workspace cwd.
- Support empty states for:
  - no workspace selected;
  - workspace does not contain `.trellis/tasks`;
  - Trellis exists but has no tasks;
  - task JSON parse/read errors.
- Show useful summary fields: title, directory name, status, priority, assignee, dates, parent/child relationship, archived state.
- Group or filter tasks by status and optionally include archived tasks.
- Preserve hierarchy: parent tasks should show child progress and child rows should be visually nested.
- Provide manual refresh; recommended MVP also refreshes when the panel opens or active cwd changes.

### Task Detail

- Clicking a task opens task details in the panel.
- Detail view should show:
  - title and status badges;
  - metadata from `task.json`;
  - hierarchy and child progress;
  - phase/progress timeline;
  - available artifact documents (`prd.md`, `design.md`, `implement.md`) rendered as Markdown or shown as raw text;
  - context manifest counts from `implement.jsonl` and `check.jsonl` ignoring seed `_example` rows;
  - related files and notes when present.
- Large artifact files should be capped to avoid slow UI responses.

### Progress / Phase Model

- Do not claim exact execution progress unless Trellis has a canonical field.
- Prefer a stage checklist/timeline with conservative labels:
  1. Plan — task exists, PRD/design/implement/context artifacts.
  2. Execute — task status `in_progress` or later.
  3. Check — review/validation context exists or status indicates review/completion.
  4. Finish — completed/done/archived/commit or PR metadata.
- Numeric percentage, if shown, must be clearly derived from the stage checklist, not presented as exact runtime progress.

### API / Security

- Read Trellis files through a dedicated server-side library, not directly from components.
- Validate requested `cwd` against existing allowed workspace roots or explicitly registered validated cwd roots before reading `.trellis` files.
- Prevent path traversal by selecting tasks by known `dirName`/archive identity, not arbitrary file paths.
- Reject or constrain symlinked task/artifact files whose real paths escape the canonical workspace.
- Treat the settings switch as both UI gating and API gating: when Trellis is disabled, Trellis API routes should return a disabled/forbidden response.
- Keep the first implementation read-only unless explicitly expanded.
- Do not expose `.trellis/.runtime` or private session-pointer files in MVP.

### Documentation / Maintainability

- If implemented, update module docs for new API routes, components, hooks, shared libraries, and config fields.
- Keep Trellis parsing contracts centralized in `lib/trellis-reader.ts` or equivalent.
- Keep wire types shared, preferably in `lib/types.ts` or a focused Trellis type module.

## Acceptance Criteria

- [ ] Settings has a Trellis section with an enable switch and archived-task default.
- [ ] Saving Trellis settings does not require changing WorkTree settings and preserves existing config.
- [ ] When disabled, no Trellis drawer entry point is shown.
- [ ] When enabled, a Trellis drawer entry point appears and opens the right drawer.
- [ ] File drawer behavior still works and file tabs are preserved while switching to/from Trellis mode.
- [ ] Task list loads from the active workspace and handles no-workspace/no-trellis/no-task/error states.
- [ ] Selecting a task shows task metadata, hierarchy, artifacts, and phase/progress visualization.
- [ ] Parent/child progress is displayed when tasks have children.
- [ ] Archived tasks are excluded by default unless enabled in settings or panel filter.
- [ ] API rejects disabled feature access, missing/unauthorized cwd, path traversal attempts, and symlink escapes.
- [ ] Lint and TypeScript validation pass after implementation.
- [ ] Relevant docs are updated after implementation.

## Out of Scope for MVP

- Creating, starting, finishing, archiving, or editing Trellis tasks from the UI.
- Reading `.trellis/.runtime` session pointers to infer the exact current AI session task.
- Real-time filesystem watching through SSE/WebSocket.
- Full markdown editing or task artifact authoring in the panel.
- Parsing `.trellis/config.yaml` unless a future requirement needs it.

## Decisions

- First implementation is read-only. It includes task list, details, artifacts, hierarchy, and phase/progress visibility, but no create/start/finish/archive actions.
