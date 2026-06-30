# Improve Trellis task hierarchy UI — Implementation Plan

## Pre-Implementation Checklist

- [ ] User confirms the open product decision about filter-driven expansion.
- [ ] Review current Trellis hierarchy fields with representative `task.json` data if available.
- [ ] Load relevant Trellis/frontend specs before editing code.

## Implementation Steps

1. Strengthen shared Trellis task projection
   - In `lib/trellis-reader.ts`, compute child progress from known children/parent relationships.
   - Consider adding additive child status counts to `TrellisTaskSummary.childProgress` if needed for the widget.
   - Keep missing children behavior explicit and safe.

2. Promote child task session associations to parent tasks
   - Add a helper in `lib/trellis-session-link.ts` that walks `parent` links from a matched summary to the nearest available root/main task.
   - Apply it to transcript and runtime resolved tasks before returning success.
   - Preserve no-evidence/ambiguous/task-not-found behavior.
   - Add comments only for non-obvious high-confidence/parent-promotion behavior.

3. Rework `TrellisPanel.tsx` list projection
   - Replace flat `filteredTasks.map()` + `buildDepth()` row indentation with a hierarchy projection.
   - Track expanded parent keys in local state.
   - Render top-level task cards only; render children inside expanded parent sections.
   - Keep selection and detail loading unchanged through `selectedKey`.
   - Ensure orphaned children remain visible as top-level rows.

4. Improve widget child progress display
   - Update `TrellisSessionWidget.tsx` to show child count plus compact progress/status visualization when `childProgress.total > 0`.
   - Avoid new network requests from the widget.

5. Documentation pass
   - Update `docs/modules/frontend.md` if component behavior descriptions need refinement.
   - Update `docs/architecture/overview.md` or `.trellis/spec/frontend/quality-guidelines.md` only if a durable session association contract changes.

## Validation Commands

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

## Manual Verification

- Workspace with no parent/child tasks: list renders all tasks as top-level rows.
- Workspace with a parent and multiple children: default list shows parent only; expanding parent reveals children.
- Selecting a child loads that child detail.
- Search/status filter matching only a child keeps the parent visible and makes the child discoverable.
- A session whose Trellis runtime/transcript evidence points to a child shows the parent in the floating widget and opens the parent in the drawer.
- Widget displays child count/progress for parent tasks with children.
- Archived-task toggle still works.

## Risk / Rollback Points

- Hierarchy projection can hide tasks if parent detection is too aggressive. Keep orphan fallback and validate flat workspaces.
- Session association promotion can mask direct child work if users expect child-level widgets. This is intentional per requirement; keep child details accessible in the drawer.
- Type changes to `TrellisTaskSummary` must be additive to avoid breaking existing UI code.
