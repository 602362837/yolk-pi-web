# review — IMP-002 SUA-VERIFY-04

**Verdict: Pass**  
Checker: 检查员 · 2026-07-17  
Subtask: `SUA-VERIFY-04` (verification barrier)

## Scope reviewed

- Domain helper `startYpiStudioUserAcceptanceFromWidget` + body guard
- Projection `buildWidgetUserActions` for `start_user_acceptance`
- Route PATCH match order before loose transition
- Widget decision-region allowlist / confirm / busy / PATCH body
- Conservation: Phase 1 kinds, `canAcceptMain`, 8-station rail, quick previews, improvement/main accept
- Docs drift for new action kind
- Focused automated suite + lint/tsc

## Findings Fixed

- Docs drift: `docs/modules/api.md`, `docs/modules/frontend.md`, `docs/modules/library.md`, `docs/architecture/overview.md` previously listed only Phase 1 three kinds. Updated to document `start_user_acceptance` projection rule, PATCH contract, and two-step enter-vs-result acceptance semantics.

## Remaining Findings

- **None blocking.**
- Non-blocking residual risk: live browser UI smoke (confirm cancel zero-network, 44px mobile, reduced-motion) was static-reviewed against code + HTML prototype; not re-run in a real browser this turn. Automated matrix covers projection/write/main-accept gates.
- Child Studio sessions cannot mutate `task.json` progress — main session must mark `SUA-VERIFY-04` **done** and advance improvement instance after accepting this review.

## Requirement / design matrix

| Acceptance | Evidence | Result |
| --- | --- | --- |
| `review` + unresolved=0 → exactly 1 primary CTA「开始用户验收」 | `buildWidgetUserActions` + `test-ypi-studio-widget-actions.mjs` pure + live projection | Pass |
| `review` + unresolved>0 → no CTA | projection filter + live integration test | Pass |
| other phases / archived → no CTA | pure matrix + archived case | Pass |
| write: bound clean review → `user_acceptance`; no complete/archive; audit `source=user-widget` | `startYpiStudioUserAcceptanceFromWidget` + dag domain tests | Pass |
| wrong context / stale revision / unresolved / wrong status → zero write | dag throws + status re-read | Pass |
| body with `override` rejected | body guard + tests | Pass |
| `canAcceptMain` only `user_acceptance` | `canAcceptMainTask` unchanged; main-accept 13 cases keep `review=false` | Pass |
| Phase 1 three kinds unchanged | projection still awaiting_approval dual + first improvement plan; widget handlers intact | Pass |
| Conservation A–F (rail / previews / imp accept / main accept-archive / runtime / write lock) | static code presence (`WorkflowRail` `is-eight-station`, `acceptableImprovementsForTask`, `handleAcceptMainTask`, `quickPreviews`, shared `acceptingInFlightRef`) + suite green | Pass |
| UI confirm distinguishes enter ≠ result accept / completed | widget confirm template + aria-label + success toast | Pass |
| No autocontinue after enter acceptance | route comment + no continue call after helper | Pass |

## Code review notes

- Single-lock helper does **not** nest public `transitionYpiStudioTask` (lock-safe).
- Does **not** write/clear `approvalGrant`.
- Route matches `isYpiStudioWidgetStartUserAcceptanceBody` before loose transition.
- Frontend only renders server `userActions` via allowlist; does not invent CTA from `status === "review"`.
- `showMainTaskAccept` still requires `user_acceptance` / `canAcceptMain` — not relaxed to review.

## Verification

| Command | Result |
| --- | --- |
| `npm run test:studio-widget-actions` | passed |
| `npm run test:studio-main-accept` | passed (13 cases) |
| `npm run test:studio-dag` | passed |
| `npm run test:studio-task-preview` | ok |
| `npm run test:studio-session-ownership` | passed |
| `npm run lint` | 0 errors (6 pre-existing unrelated warnings) |
| `node_modules/.bin/tsc --noEmit` | clean (exit 0) |

## Verdict

**Pass** — IMP-002 implementation meets PRD/Design/Checks for `start_user_acceptance`. Ready for main session to mark `SUA-VERIFY-04` done, complete improvement instance verification, and proceed to user acceptance of the improvement / main task as workflow requires.

## Main session actions required

1. Mark improvement subtask `SUA-VERIFY-04` **done** (child cannot write `task.json`).
2. If all 4 subtasks done, reconcile IMP-002 toward `waiting_user_acceptance` / user accept.
3. Optional: one live UI smoke on a `review` task card before shipping.
