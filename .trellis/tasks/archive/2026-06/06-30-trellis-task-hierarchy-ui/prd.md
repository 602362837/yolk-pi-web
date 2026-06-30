# Improve Trellis task hierarchy UI

## Goal

Make Trellis parent/child tasks readable and session-aware in the web UI. The Trellis drawer should present a clean top-level task list, let users expand parent cards to inspect child tasks, and keep session-scoped Trellis awareness focused on the parent task when runtime/transcript evidence points at a child task.

## User Value

Users can understand a multi-deliverable Trellis task tree without a visually noisy flat list, and the floating session widget points at the main task context instead of unexpectedly switching to the last child task mentioned by the planning workflow.

## Confirmed Facts

- `components/TrellisPanel.tsx` currently renders every `TrellisTaskSummary` from `/api/trellis/tasks` in one flat list and uses indentation from `buildDepth()` to hint at hierarchy.
- `lib/trellis-reader.ts` reads `task.json.parent`, `task.json.children`, and legacy `task.json.subtasks` strings. `children` is the task-tree relationship used for child progress; `subtasks` is only displayed as a string list in the detail overview.
- `TrellisTaskSummary.childProgress` currently counts only direct `children` and treats missing child summaries as completed.
- `lib/trellis-session-link.ts` resolves session association from transcript lifecycle/path evidence and exact per-session runtime pointers. It currently returns the latest/unique matched task as-is, so a child task can become the displayed session task.
- `components/TrellisSessionWidget.tsx` already displays direct child progress as `子任务 completed/total` when `childProgress.total > 0`, but it does not visually summarize child task status distribution beyond that count.
- Trellis APIs are read-only and gated by `pi-web.json` plus allowed-root validation. Detail routes use stable `task.key` values rather than raw paths.

## Requirements

1. Trellis drawer task list hierarchy
   - Show top-level tasks only in the primary list by default.
   - A top-level task is a task with no valid parent task in the current list, plus orphaned child tasks whose referenced parent is not present or not included by the current archive/filter scope.
   - Parent task cards with children must be expandable/collapsible inside the list.
   - Expanded children must render under their parent as child rows/cards, not as independent top-level rows and not only by indentation.
   - Child rows must retain selection behavior so users can open child task details when needed.
   - The UI should make the parent/child relationship obvious and avoid the current visually mixed flat list.

2. Filtering/search behavior
   - Status and search filtering must not break hierarchy comprehension.
   - If a child matches the current query/filter, its parent should remain visible as the grouping container.
   - Children hidden by filters should not be counted as visible list items unless the UI explicitly states the total/visible distinction.

3. Session-scoped Trellis association
   - If the high-confidence session evidence resolves to a child task, the session association route should return the nearest available parent task instead.
   - Parent promotion must walk upward through `parent` links safely, avoiding cycles and missing parents.
   - If parent promotion encounters missing/ambiguous data, it should fall back predictably without creating a workspace-level guess.
   - Transcript/runtime ambiguity rules should remain high-confidence only; do not add first-active-task heuristics.

4. Floating Trellis widget
   - When the associated task has child tasks, the widget must clearly show the number of children and child completion progress.
   - The widget should expose enough child progress information for users to understand whether children are not started, active, review/checking, or complete, while remaining compact.
   - Clicking the widget should still open the Trellis drawer focused on the associated task.

5. Compatibility and safety
   - Preserve existing API route security contracts: feature gate, cwd allowed-root validation, and stable task keys.
   - Preserve archived task support.
   - Avoid writing UI-only associations into `task.json` or session files.
   - Update project docs if public Trellis behavior or module contracts change materially.

## Acceptance Criteria

- [ ] The Trellis drawer default list shows only main/top-level tasks, with child tasks nested under expandable parent cards.
- [ ] Child task selection from an expanded parent opens that child task detail.
- [ ] Search/status filters keep matching child tasks discoverable under their parent rather than floating as top-level rows.
- [ ] The session Trellis association endpoint returns the main parent task when evidence identifies a child task.
- [ ] The floating Trellis widget displays child count and child completion/progress information for tasks with children.
- [ ] Existing non-hierarchical task workspaces still render as before, with no empty or broken list state.
- [ ] `npm run lint` passes.
- [ ] `node_modules/.bin/tsc --noEmit` passes.

## Out of Scope

- Editing or re-parenting Trellis tasks from the web UI.
- Changing Trellis CLI task creation/linking behavior.
- Writing session backlinks or other web-only metadata into `task.json`.
- Building a dependency graph; parent/child is only display and aggregation hierarchy.

## Open Questions

None.

## Product Decisions

- Parent task cards should auto-expand when search/status filters match a child task, so the actual matching child remains discoverable under its parent.
