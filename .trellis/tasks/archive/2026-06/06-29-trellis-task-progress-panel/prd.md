# Trellis Task Progress Floating Panel

## Goal

Show the Trellis task associated with the current pi chat session as a lightweight floating progress widget, and let the user click it to expand the corresponding Trellis task detail without leaving the chat.

## User Value

- Users can see whether the active Trellis task is in planning, execution, check, or finish while chatting with the agent.
- Users do not need to keep the full Trellis right drawer open just to monitor the current task.
- Clicking the widget gives quick access to the existing Trellis detail view and task artifacts.

## Confirmed Facts From Repository Inspection

- `components/AppShell.tsx` owns the top-level layout, selected session/workspace state, right drawer modes, and current Trellis drawer entry point.
- `components/TrellisPanel.tsx` already renders a read-only Trellis task list, task details, artifacts, hierarchy, and derived progress timeline.
- Existing Trellis APIs are read-only:
  - `GET /api/trellis/tasks?cwd=...&includeArchived=...` returns task summaries.
  - `GET /api/trellis/tasks/[taskKey]?cwd=...` returns one task detail.
- Existing Trellis routes are gated by `pi-web.json` `trellis.enabled`; when disabled, APIs return 403 and the UI hides Trellis entry points.
- Trellis task progress is currently derived conservatively in `lib/trellis-reader.ts` from task status/artifacts/check metadata; there is no exact runtime percent field.
- Trellis active-task pointers are session-scoped under `<workspace>/.trellis/.runtime/sessions/*.json` with `current_task`; prior Trellis panel MVP intentionally did not expose this private runtime state.
- The local Pi Trellis extension derives runtime context keys from `PI_SESSION_ID`/`PI_SESSIONID`, extension session manager id, transcript path, or process fallback, and can read `.trellis/.runtime/sessions/<key>.json` to resolve the active task.
- The current workspace contains an active runtime pointer (`pi_process_...json`) to this task, showing process-level fallback is used when no precise session identity is available.
- Module docs already mention the existing Trellis drawer and APIs; adding a floating session widget will require updates to `docs/modules/frontend.md`, likely `docs/modules/api.md`, and possibly `docs/modules/library.md`.

## Requirements

### Session-Scoped Association

- The association source of truth should be the pi chat session, not Trellis task metadata or the global Trellis task list.
- The feature should never write a backlink onto a Trellis task just to make the widget work.
- The session can "self-detect" a related Trellis task from session-local evidence, such as:
  - tool calls/results in this session that created or started a Trellis task;
  - explicit task paths mentioned in this session's assistant/tool output;
  - a precise per-session Trellis runtime pointer when the session identity is available.
- Low-confidence/global fallback evidence must not cause an incorrect widget to appear. In the worst case, no floating widget appears.
- The Trellis task list and existing Trellis drawer must remain independent from this session association.

### Floating Widget

- Show a small, unobtrusive floating Trellis task widget when:
  - Trellis is enabled in web settings;
  - a workspace/chat session is selected or a new chat has an active workspace;
  - an associated active Trellis task can be resolved.
- Display at minimum:
  - task title or short directory/name;
  - status/phase label;
  - derived progress percent or progress bar;
  - a visual status indicator;
  - all Trellis progress stages as vertical nodes, with the current node clearly highlighted.
- The widget should be draggable so users can move it away from important chat content.
- The default position should avoid the chat input and right-side drawer toggles as much as possible.
- The widget should use a semi-transparent/backdrop style so it remains unobtrusive.

### Expand / Detail Behavior

- Clicking the floating widget should expand the corresponding Trellis detail.
- Prefer reusing the existing Trellis drawer/detail rendering rather than building a second full detail implementation.
- If the right drawer is currently closed, clicking should open it in Trellis mode with the associated task selected.
- If the right drawer is already open in Files mode, clicking should switch to Trellis mode without losing file tabs.

### Association Behavior

- The UI must determine which Trellis task is associated with the current pi session or workspace before showing the widget.
- It must handle ambiguous or missing runtime/session links gracefully instead of showing the wrong task.
- The widget should not rely on exact progress beyond the existing derived Trellis progress model unless a canonical Trellis field exists.

### Security / Scope

- Continue reading Trellis data through server-side APIs/libraries, not directly from browser components.
- Do not expose arbitrary `.trellis/.runtime` file contents to the browser; expose only a normalized task key/summary/detail needed for UI.
- Preserve existing Trellis setting gate and allowed-root checks.
- Keep this feature read-only for Trellis tasks unless explicitly expanded.

## Acceptance Criteria

- [ ] With Trellis disabled, no floating Trellis widget appears and no new Trellis session API is usable.
- [ ] With Trellis enabled and an associated task resolved, the chat UI shows a compact draggable semi-transparent floating widget with task title/status/progress.
- [ ] The widget updates when the associated task status/artifacts change, either through refresh, polling, or existing session lifecycle refresh.
- [ ] The widget shows all progress stages vertically and clearly marks the current stage.
- [ ] Clicking the widget opens the Trellis drawer and selects the associated task detail.
- [ ] Switching to Trellis from Files mode preserves file tabs and existing file drawer behavior.
- [ ] If no associated task is found, the widget stays hidden or shows a clear empty/disabled state per final design.
- [ ] If association is ambiguous, the UI avoids guessing incorrectly and uses the final agreed fallback behavior.
- [ ] Existing Trellis panel list/detail behavior continues to work.
- [ ] Lint and TypeScript validation pass.
- [ ] Relevant docs are updated.

## Out of Scope Unless Explicitly Added

- Creating, starting, finishing, archiving, or editing Trellis tasks from the floating widget.
- Showing exact real-time execution percent beyond the derived Trellis progress model.
- Exposing raw `.trellis/.runtime/sessions/*.json` contents to the browser.
- Replacing the existing Trellis right drawer.

## Decisions

- The association should be session-owned and best-effort. It should not be stored on or inferred by mutating Trellis task metadata.
- If session-owned evidence is absent or ambiguous, the correct fallback is to hide the floating widget rather than risk showing the wrong task.
- Default widget evidence is high-confidence only:
  - explicit current-session transcript/tool evidence containing a Trellis task path or lifecycle output;
  - exact per-session Trellis runtime pointer when the key is deterministically tied to the pi session.
- Do not use workspace-level guesses, process/global runtime fallback pointers, or “first active task” heuristics.

## Open Questions

- None blocking implementation.
