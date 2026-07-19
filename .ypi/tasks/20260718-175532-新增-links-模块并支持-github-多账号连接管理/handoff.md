# handoff — architect planning closeout (Device Flow)

## Status

Planning artifacts for the **GitHub OAuth Device Flow** revision are ready for user approval. Child session **cannot** mutate `task.json` (guarded); parent must:

1. `update_implementation_plan` from `implement.md` (7 Device Flow subtasks, `maxConcurrency=2`)
2. `transition` → `awaiting_approval`
3. Stop before any implementer dispatch

## Files changed / artifacts produced

| File | Action |
| --- | --- |
| `plan-review.md` | **Rewritten** for Device Flow approval entry; relative links to all artifacts |
| `ui.md` | **Rewritten** as full UI delivery (paths, state matrix, a11y, checks) + prototype link |
| `links-github-connections-prototype.html` | **Overwritten** — Device Flow primary path; **no** password/PAT form |
| `brief.md` / `prd.md` / `design.md` / `implement.md` / `checks.md` | Already Device Flow (prior turn); unchanged this closeout |

## ui-designer

- Child environment **blocks** `ypi_studio_subagent` / recursive orchestration tools.
- Prior ui-designer runs were empty/no-op on PAT prototype.
- Architect **authored** the replacement HTML prototype per latest `ui.md` contract (allowed fallback when ui-designer cannot run).

## Validation run

```text
rg "粘贴 GitHub|PAT 主路径|PAT表单" plan-review.md ui.md  → none
HTML type="password" / Personal Access Token form       → none
HTML primary CTA / device panel / github.com/login/device / read:user → present
implement.md plan block: schemaVersion 2, maxConcurrency 2, LINKS-01…07 Device Flow titles → OK
```

No production `app/` / `lib/` code modified. No commit/push/merge.

## Remaining risks / parent actions

1. **Parent must** save implementation plan from `implement.md` into task state and transition to `awaiting_approval`.
2. **Product client id** (`YPI_LINKS_GITHUB_OAUTH_CLIENT_ID`, Device Flow enabled) is still an implementation/UAT prerequisite; missing config fail-closed, no PAT fallback.
3. Live multi-account GitHub UAT needs owner-approved test identities after approval.
4. User must review HTML prototype via task-local preview and reply **批准** / **需要修改**.

## Decisions already embedded (for user confirm in plan-review)

- Device Flow only; product-owned OAuth App; no client secret
- Terminal user: no OAuth App creation, no PAT
- Scope: `read:user`
- PAT fully out of P0
- Multi-account; `409 duplicate_identity`; local-only disconnect
- Isolated from LLM auth

## Do not

- Do not claim implementer / start `LINKS-01` until user approval grant exists
- Do not reintroduce PAT UI
