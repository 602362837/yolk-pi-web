# Summary

已完成 project/space session 列表性能优化（方案 B），并通过 checker **Pass**。

## 根因

`GET /api/projects/:projectId/spaces/:spaceId/sessions` 原先对全局 `listAllSessions(includeStudioChildren/display=true)` 全量扫描后再 filter；约 300 sessions + 182 Studio child N+1 投影导致 13–29s，并间接拖慢设置/模型入口。

## 方案

- 每 space 在自身根目录维护候选索引：`<space-root>/.ypi/sessions/index.v1.json`
- JSONL 仍在 `~/.pi/agent/sessions/**`，不搬迁
- 热路径定向读 index + 该 space cwd 目录校验；失效 entry 剔除回写
- missing/corrupt 完整恢复；无安全结果不返回缺项 partial 200（503 rebuilding）
- Studio display 筛选后按 unique task 批量投影
- 旧全局 `pi-web-session-index.json` 只读迁移并停写
- gitignore 仅 `/.ypi/sessions/`

## 结果（bench）

约 320 sessions / 180 children fixture：warm P95 ~57ms，cold P95 ~44–73ms，`inventoryGlobalCalls=0`，硬门禁全过。

## 验证

- 54 focused tests + session-title + studio-child-sessions
- lint 0 errors / tsc clean / bench hard gates pass

## 残余

- 跨 space 改绑不主动写对方 index（对方可由 directed/recovery 收敛）
- `/api/models` 独立冷启动可 Phase 2
- 建议人工 Sidebar smoke；提交时勿混入无关 Links OAuth diff
