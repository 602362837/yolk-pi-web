# Review — Studio Context Integrity（SCI）

**Task:** `20260718-195741-studio-上下文注入收敛-chat-折叠展示-system-单通道-保留-knowledge`  
**Reviewer:** checker  
**Scope:** SCI-01…06 implementation gate (PRD / Design / Checks / UI)  
**Verdict:** **Pass**

## Summary

L0 (Chat strip + compact tag) and L1 (system single-channel injection) match the approved design. Core no-regression requirements hold: approval side-effect retained, knowledge query uses `event.prompt`, `buildMemberPrompt` / child guard unchanged, title strip present, automation matrix green. Docs updated. Residual risk is human UAT only (G1–G13), not an implementation blocker.

## Findings Fixed

None (checker did not change production code).

## Remaining Findings

### Blocking

None.

### Non-blocking / residual

| # | Item | Severity | Notes |
| --- | --- | --- | --- |
| N1 | Manual UAT G1–G13 not run in this env | residual | Dirty session UI, Copy/Edit, same-turn chat approval → implementing, real subagent, widget, steer/follow-up, light/dark, clean chat. Required before user_acceptance close. |
| N2 | Pre-existing `npm run lint` errors outside SCI | residual | `ChatMinimap.tsx` (preserve-manual-memoization), `TrellisWorkflowVisualizer.tsx` (Date.now purity + memoization). SCI files clean. Do not treat as SCI regression. |
| N3 | Historical dirty user JSONL still in model context | accepted | Design/PRD: no migration; L0 only strips display. |
| N4 | User-authored complete forged closed tags strip | accepted edge | Documented U6b / design: full-block rule; partial half-open preserved. |
| N5 | Live browser visual parity vs HTML prototype | residual UAT | Class names / showTag logic / CSS tokens align with `ui.md` + prototype; pixel UAT still human. |

## Acceptance checklist (code + auto)

### L1 injection (`lib/ypi-studio-extension.ts`)

| Check | Result |
| --- | --- |
| `input` no `transform` / no `buildStudioState` join | **Pass** — returns `{ action: "continue" }` |
| `recordYpiStudioUserApproval` still on input | **Pass** — E2 harness writes `approvalGrant` |
| `before_agent_start` sole channel + `buildStudioState(root, key, prompt)` | **Pass** |
| `startupContext` no knowledge; first-reply one-shot | **Pass** — E4/E5 |
| `buildMemberPrompt` unchanged | **Pass** — empty diff vs HEAD |
| Child `YPI_STUDIO_SUBAGENT_CHILD=1` early return | **Pass** — E6 |

### L0 display

| Check | Result |
| --- | --- |
| `lib/ypi-studio-message-display.ts` pure strip/parse/tag | **Pass** — complete blocks only; partial conservative |
| `UserMessageView` displayText + Copy/Edit; fail-open raw | **Pass** |
| Tag only when `hadInjection && full && status` | **Pass** — matches ui.md / design |
| Classes `.message-user-meta-row` / `.message-studio-tag` + status CSS | **Pass** — prototype-aligned tokens |
| L0 tag non-interactive | **Pass** — `span`, `cursor: default`, `data-interactive="false"` |

### Title

| Check | Result |
| --- | --- |
| `sessionTitleSeedFromUserMessage` strip | **Pass** |
| `displayTitleForSession` firstMessage strip | **Pass** |
| No metadata rewrite | **Pass** |

### Tests & quality

| Command | Result |
| --- | --- |
| `npm run test:studio-message-display` | **Pass** (21) |
| `npm run test:studio-extension-sci` | **Pass** (13) |
| `npm run test:studio-dag` | **Pass** |
| `npm run test:studio-widget-actions` | **Pass** |
| `npm run test:studio-policy` | **Pass** |
| `scripts/test-session-title.mjs` (SCI-04 cases) | **Pass** |
| `node_modules/.bin/tsc --noEmit` | **Pass** |
| `npm run lint` | Pre-existing errors only (N2); no SCI file issues |

### Docs

| File | Result |
| --- | --- |
| `docs/modules/library.md` | SCI L0 module + L1 extension notes + reuse rule |
| `docs/modules/frontend.md` | UserMessageView + CSS tag notes |
| `docs/architecture/overview.md` | SCI single-channel paragraph |
| `AGENTS.md` | Correctly untouched |

### PRD R1–R17 (implementation gate)

R1–R15, R16 (diff empty), R17 (no widget path change + widget suite green), N1–N5: **covered** by code/tests as specified. Human G-matrix remains for product close.

## Diff inventory (implementation evidence)

| Path | Role |
| --- | --- |
| `lib/ypi-studio-message-display.ts` | **new** SCI-01 |
| `lib/ypi-studio-extension.ts` | SCI-02 L1 |
| `components/MessageView.tsx` | SCI-03 L0 |
| `app/globals.css` | SCI-03 CSS |
| `lib/session-title.ts` | SCI-04 |
| `scripts/test-ypi-studio-message-display.mjs` | SCI-01/05 |
| `scripts/test-ypi-studio-extension-sci.mjs` | SCI-05 |
| `scripts/test-session-title.mjs` | SCI-04 |
| `package.json` | `test:studio-message-display`, `test:studio-extension-sci` |
| `docs/modules/library.md`, `docs/modules/frontend.md`, `docs/architecture/overview.md` | SCI-06 |

No JSONL migration; no child/widget/tool contract changes.

## Verdict

**Pass** — implementation meets SCI L0+L1 acceptance for automated gate and static review.  
Recommend main session: transition toward **review / user_acceptance**, run human UAT G1–G13, then close. Do **not** send back to implementing for code rework unless UAT finds a behavioral regression.

## Decisions needed from main session

1. Transition task out of `checking` → review / user_acceptance path.
2. Execute manual UAT checklist (checks.md §7 / G1–G13).
3. Optionally file a separate task for pre-existing ChatMinimap/Trellis lint purity issues.
4. Do not reintroduce `input` transform; do not migrate historical JSONL; L2 (tag expand / display:false / no_task light inject) stays out of scope.
