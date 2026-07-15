# review — IMP-003（improver self-note）

## Status
Planning only. No production code.

## Focus for later checker
- `canAcceptMain` 真值是否严格等于 `user_acceptance && !archived && unresolved===0`
- PATCH 是否带非空 `reason` 与绑定 `contextId`
- 是否误用 `transition_improvement` 或乐观本地 completed
- 改进验收路径是否回归

## Artifacts
See `plan-review.md` as the user-facing entry.
