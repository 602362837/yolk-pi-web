# handoff — IMP-004 改进师

## Status
Planning artifacts ready. **No production code.** Awaiting user approval of `plan-review.md` + HTML prototype.

## Artifacts produced
Under `.ypi/tasks/20260715-113533-…/improvements/imp_zzrx0i8u/`:

| File | Role |
| --- | --- |
| `brief.md` | 反馈、证据、范围/非目标 |
| `prd.md` | R1–R7 验收标准 |
| `design.md` | AppPrompt `choose` + 串行 completed→archive |
| `implement.md` | ARCHIVE-ACCEPT-1..3 + JSON plan |
| `checks.md` | 自动/人工检查 |
| `ui.md` | 三按钮交互与 a11y |
| `plan-review.md` | **用户审批入口** |
| `studio-main-task-accept-archive-prototype.html` | UI 原型 |
| `review.md` / `summary.md` | 自检与摘要 |

## Recommended design (for implementer after approval)
1. Extend AppPrompt with `choose()` → `"complete" | "complete_and_archive" | null` (do not break `confirm(): boolean`).
2. `handleAcceptMainTask`: cancel / complete-only / complete→`action:"archive"` + `allowFallbackKnowledge: true`.
3. Partial failure: keep completed, toast archive error, refresh.
4. Enter → complete only.

## Validation run
- None (planning-only; no lint/tsc required for docs/HTML).

## Remaining risks
- User may prefer two-step confirm instead of three-button single dialog.
- User may reject AppPrompt API extension (fallback: widget-local dialog).
- Archive without model knowledge always uses fallback (same as Studio panel).

## Decisions needed from main session / user
Approve or revise `plan-review.md`, especially:
1. Three-button same dialog vs two-step.
2. Primary path remains complete-only; Enter never archives.
3. `allowFallbackKnowledge` for page archive.
4. Allow minimal AppPrompt `choose` API.
