# Trellis Custom Workflow Documentation Notes

Source: https://docs.trytrellis.app/advanced/custom-workflow.md
Read during planning for `06-30-trellis-workflow-visualizer`.

## Relevant facts

- `.trellis/workflow.md` is the single editable source for Trellis workflow behavior.
- It controls phase definitions, skill routing, per-turn reminders, and the `task.py` command catalog.
- Runtime injection reads `workflow.md`; forks do not need generated code changes after editing the markdown.
- `[workflow-state:STATUS]...[/workflow-state:STATUS]` blocks under `## Phase Index` map `task.json.status` strings to per-turn breadcrumbs.
- Default statuses are `planning`, `in_progress`, `completed`; `no_task` is used when no task is active.
- Custom statuses are plain strings in `task.json.status`; adding a matching workflow-state block is enough for breadcrumbs.
- `task.py create` writes `status=planning` and active-task pointer; `task.py start` moves to `in_progress`; `task.py archive` completes/archives.
- Phase and step headings are parser-sensitive: `## Phase X` and `#### X.Y` are consumed by `get_context.py --mode phase --step X.Y`.
- The workflow file can add/reshape phases, but phase index and detail sections must stay synchronized.
- The tag format and heading depths should not be changed casually because scripts parse them literally.

## Implication for pi-web visualization

The first implementation should read `.trellis/workflow.md` and expose a parsed, read-only projection:

- phase index / phases / steps
- workflow-state blocks and their status names
- key parser warnings when expected default blocks or parser-sensitive headings are absent
- raw source snippets / line ranges for traceability

The UI should be read-only in this release, but the data model should preserve source locations and stable ids so a later editor/agent-assisted customizer can target exact markdown regions.
