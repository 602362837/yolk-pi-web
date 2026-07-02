Review and validation summary:

- Architect subagent produced design for task detail tabs and field coverage.
- Checker subagent reviewed the implementation and identified one blocker: Artifacts tab only used current progress required/optional artifacts, which would hide artifacts on completed/archived states.
- Fixed blocker by building the artifact list from the union of required artifacts, optional artifacts, `task.artifacts`, and `task.documents`.
- Fixed keyboard event bubbling edge case for task-card action buttons.

Commands run:
```bash
npm run lint && node_modules/.bin/tsc --noEmit
```
Result: passed.

Known follow-up:
- Full transcript viewer is intentionally out of scope for this first detail view; current UI displays transcript metadata only.