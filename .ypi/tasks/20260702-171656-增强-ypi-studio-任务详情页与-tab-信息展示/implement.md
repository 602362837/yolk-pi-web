Implemented follow-up UX refinements for YPI Studio task details:

- The Tasks tab now switches into a full task-detail view instead of showing list + detail split view.
- Detail view includes a left/top `← 返回任务列表` button to return to the task list and restore scope filters.
- Focused tasks from the session widget still open directly into the full detail view.
- The Artifacts tab now has artifact-level sub-tabs.
- Only one artifact document is shown at a time; artifact tabs indicate completed-looking documents with `✓`.
- Artifact preview still uses the union of required artifacts, optional artifacts, `task.artifacts`, and `task.documents`, preserving completed/archived task compatibility.
- Updated `docs/modules/frontend.md` to describe the full-detail view and artifact sub-tabs.

Validation:
- `npm run lint && node_modules/.bin/tsc --noEmit && git diff --check -- components/YpiStudioPanel.tsx docs/modules/frontend.md` passed.