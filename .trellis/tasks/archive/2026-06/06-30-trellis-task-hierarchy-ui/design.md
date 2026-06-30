# Improve Trellis task hierarchy UI — Design

## Boundaries

- `lib/trellis-reader.ts` remains the server-side source for Trellis task projections.
- `lib/trellis-types.ts` owns shared response types used by API routes and React components.
- `lib/trellis-session-link.ts` owns session-to-task association logic and should perform child-to-parent promotion before returning a high-confidence task.
- `components/TrellisPanel.tsx` owns drawer list grouping, expansion state, and row rendering.
- `components/TrellisSessionWidget.tsx` owns compact floating progress visualization.

## Data Model

Existing fields are sufficient for the main behavior:

- `TrellisTaskSummary.parent?: string | null`
- `TrellisTaskSummary.children: string[]`
- `TrellisTaskSummary.childProgress: { total: number; completed: number }`
- `TrellisTaskSummary.progress`

Additive type changes may be introduced if needed, for example a child status summary:

```ts
childProgress: {
  total: number;
  completed: number;
  inProgress?: number;
  review?: number;
  planning?: number;
  unknown?: number;
}
```

Prefer additive fields so existing clients remain compatible. If detail and list both need richer child progress, calculate it once in `lib/trellis-reader.ts`.

## Task Hierarchy Resolution

Build hierarchy by directory name, because Trellis `parent` and `children` fields currently store task directory names.

Rules:

1. A task is a child only when `task.parent` points to an existing task in the current response set.
2. Missing parent means the task is an orphan top-level row.
3. Cycles are treated defensively: stop traversal and surface the involved task at top-level rather than crashing.
4. `children` array is used for parent expansion order when available; otherwise derive children by scanning `parent` links.
5. Archived tasks are included only when the API response includes them. If a parent is excluded, its child becomes top-level for that response.

## Drawer UI

Create a local hierarchy projection in `TrellisPanel.tsx` from the filtered task list plus the full task map.

Recommended behavior:

- Top-level rows render as cards/buttons with an expand/collapse control when they have visible or total children.
- Expanded children render in an indented nested container under the parent, using clear visual grouping (border/connector/background), not just padding indentation.
- Selecting parent or child sets `selectedKey` exactly as today.
- Filtering should preserve grouping. A parent appears if:
  - the parent itself matches filters, or
  - at least one descendant matches filters.
- When a descendant match causes the parent to appear, auto-expand the branch to reveal the match unless the user explicitly collapsed it after the current filter was applied.

## Session Association Parent Promotion

After existing evidence resolution returns a task, normalize it to the nearest main task:

```text
matched task -> if parent exists, walk parent links until no parent or missing parent -> return root/nearest available parent
```

Safety:

- Use a `Set` of visited dir names to avoid cycles.
- Only walk through tasks from `listTrellisTasks(cwd, true)`; do not inspect raw files again.
- If a parent link points to a missing task, return the current matched task, because it is the highest-confidence available task.
- Preserve ambiguity behavior before promotion. Do not collapse two different evidence matches into one parent unless both independently resolve and promote to the same parent; this may be considered as a safe compatibility refinement.

## Floating Widget

Keep the widget compact:

- Continue showing `子任务 completed/total` beside `dirName`.
- Add a small child progress strip or compact status chips when `childProgress.total > 0`.
- Use existing status/phase colors for consistency.
- Do not fetch child task detail from the widget; rely on the summary returned by the association route.

## Documentation

Update `docs/modules/frontend.md`, `docs/modules/api.md`, or `docs/architecture/overview.md` only if the implementation changes public module behavior beyond the existing Trellis descriptions. At minimum, update the frontend TrellisPanel/TrellisSessionWidget descriptions if the current wording becomes stale.

## Rollback

All changes are read-only projections. Rollback consists of reverting component rendering and the session association promotion helper. No migration or data cleanup is required.
