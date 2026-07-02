# Summary

Implemented YPI Studio task archive and knowledge distillation.

## Completed

- Added completed-only archive flow for YPI Studio tasks.
- Added archived task directory support under `.ypi/tasks/archive/<YYYY-MM>/<task-id>/`.
- Added knowledge persistence under `.ypi/knowledge/` with `index.json`.
- Added bounded reusable knowledge injection for Studio context and member delegation.
- Added `/studio-archive` command and `ypi_studio_task(action="archive")` support.
- Extended Studio task APIs with `scope=active|archived|all` and stable archived keys.
- Updated Studio Panel task filters, archive action, and archived task file opening.
- Updated architecture/module docs.

## Validation

- `git diff --check` passed.
- `npm run lint` passed.
- `node_modules/.bin/tsc --noEmit` passed.

## Notes

- Non-completed tasks cannot be archived; they should use cancelled/discarded state and may be restored through workflow transitions.
- UI archive uses deterministic fallback and warns users; `/studio-archive` is the model-distillation path.
