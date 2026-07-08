# Handoff — docs-tests

## Files Changed

- `docs/modules/library.md` — Documented `plan-review.md` as the primary approval artifact in Studio workflows, the `awaiting_approval` non-TBD validation in task persistence, and `resolveYpiStudioTaskRelativeFile` task-local preview safety checks.
- `docs/architecture/overview.md` — Added the plan approval architecture note: `plan-review.md` is required before `awaiting_approval`, previewing links does not grant approval, and the task file preview API is the server-side safety boundary.

## Validation

- `npm run lint` — passed.
- `node_modules/.bin/tsc --noEmit` — passed.

## Manual Validation Notes

- Browser/manual click-through was not run in this delegated session. Checker/main session should validate an `awaiting_approval` task with `plan-review.md` links for `./prd.md`, `./ui-prototype.html`, and an illegal `../...` path, plus verify Artifacts tab dedupe in the UI.

## Notes / Risks

- No new test script was added; the implemented behavior is covered here by docs alignment plus lint/type-check. If the main session wants automated artifact/link parser regression coverage, the helpers should be extracted from `components/YpiStudioPanel.tsx` into a shared pure module before adding a script.
