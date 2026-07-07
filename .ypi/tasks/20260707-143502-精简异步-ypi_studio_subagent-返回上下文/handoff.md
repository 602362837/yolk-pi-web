# Handoff — docs-and-validation

## Files Changed

- `docs/modules/library.md` — documented `ypi_studio_subagent` async-start light projection, lifecycle `poll`/`collect`/`cancel` projection, compact wait payload, and the async-progress handoff to `ypi_studio_wait` while preserving synchronous start behavior.
- `docs/modules/frontend.md` — documented UI compatibility for `run.id ?? run.runId`, task/subtask title fallbacks, lightweight async-start cards, wait panel compact payloads, and session-widget title fallback.

## Validation

- `npm run lint` — passed.
- `node_modules/.bin/tsc --noEmit` — passed.

## Notes / Risks

- Did not change production code in this subtask; code changes from prior implementation subtasks remain intact.
- Manual raw tool-result/UI smoke checks were not run in this environment; reviewer should still inspect an async start + wait flow if desired.

## Decisions Needed

- None.
