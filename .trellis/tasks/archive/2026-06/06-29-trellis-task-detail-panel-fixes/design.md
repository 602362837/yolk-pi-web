# Design

## Scope

This task refines the read-only Trellis task detail display. The data source remains `task.json`, markdown artifacts, and JSONL manifests under `.trellis/tasks`. The panel should explain missing or ambiguous metadata rather than infer historical Git/worktree state.

## Current Data Contracts

- `lib/trellis-reader.ts` normalizes task records into `TrellisTaskSummary` / `TrellisTaskDetail`.
- `components/TrellisPanel.tsx` renders:
  - `ProgressTimeline` from `task.progress`;
  - four summary `MetaCard`s;
  - `Overview` metadata lines.
- Manifest counts ignore `_example` seed rows. A seed-only manifest therefore has count 0 by design.
- `check.jsonl` is an input/context manifest for check agents, not proof that a check ran.
- Optional `task.json.meta.lastCheck` records the last quality-check result when an agent or user persists it.
- Child progress is based on `task.json.children`, not `subtasks` and not subagent dispatch history.

## UI Changes

### Metadata overview

Replace the fixed “always show all Git fields” feel with a clearer recorded-metadata section:

- Keep directory always visible.
- Show recorded Git/worktree fields when present.
- For missing optional fields, show a compact explanatory note instead of letting a block of `—` rows dominate the section.
- Rename or annotate “基准分支” so it is understood as a recorded task metadata value, not necessarily proof of the final merge target for historical worktree tasks.

Suggested wording:

- section note: “以下 Git / Worktree 信息来自 task.json；未记录的历史字段不会自动推断。”
- missing note: “未记录：分支、Worktree、Commit、PR。”

### Progress check stage

Keep progress derivation in `lib/trellis-reader.ts` so list and detail share the same semantics.

For the check stage details:

- If `meta.lastCheck.status` is `passed`, mark the check stage `done` and show the recorded check result.
- If `meta.lastCheck.status` is `failed`, mark the check stage `active` and show the recorded failure.
- If no `meta.lastCheck` exists, `check.jsonl` entries are displayed only as configured check context.
- If the task is finished without a last-check record, show a completion-focused line, e.g. `任务已完成；未配置检查上下文`.

This preserves the truth that manifest count is not an execution record, while allowing tasks that do persist check results to show the check node accurately.

### Summary cards

- Replace date-only formatting with `formatDateTime` that:
  - detects `YYYY-MM-DD` and renders a date only;
  - renders datetime strings with year/month/day hour/minute/second.
- Rename “子任务” to “Trellis 子任务” or add a title/description indicating it counts `task.json.children`.
- Render context value as `未配置` when both counts are 0; expose a title/description indicating seed `_example` rows are ignored and these are implement/check manifest counts.

## Compatibility

- Do not change route paths, query parameters, or task key format.
- Preserve existing type fields unless an additive field is necessary. The planned changes can be done with existing `TrellisTaskDetail` data.
- Existing date-only tasks remain valid.
- Existing seeded manifests continue to count as 0 real entries.

## Risks

- Over-hiding missing metadata could make debugging harder. Mitigate by listing missing field names in a note.
- Changing labels may confuse users who expect the old “子任务” label. Mitigate by keeping the count format and adding a clearer label/tooltip.
