# Design — IMP-001

## Fix A — sentinel 精度

收紧为 assignment/header 形态：`/installation[_\s-]?token\s*[:=]/i`（或等价），保留 PEM/ghs_/YPI_GITHUB_APP_*。可选修正 envelope 措辞为 “App installation credentials”。

## Fix B — 失败可见

typed preflight error + unattended_implementer_error meta：implementerCode/stage/retryable。

## Fix C — Agent active 口径

| 状态 | 条件 |
| --- | --- |
| Session 绑定 | parent sessionId + project/space |
| Agent 未活跃 | 无 child/meaningful agent progress |
| Agent 活跃 | child session 或 allowlisted progress |
| Agent 失败 | typed implementer_* |

## 回滚

恢复旧 sentinel → 再次空壳秒失败。
