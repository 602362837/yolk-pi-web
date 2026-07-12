# 新增内存诊断快照能力：采集进程/AgentSession/Studio运行时状态并写入诊断文件

- Task: 20260711-233128-新增内存诊断快照能力-采集进程-agentsession-studio运行时状态并写入诊断文件
- Workflow: feature-dev
- Archived task: .ypi/tasks/archive/2026-07/20260711-233128-新增内存诊断快照能力-采集进程-agentsession-studio运行时状态并写入诊断文件
- Archived at: 2026-07-12T05:20:28.709Z
- Tags: feature-dev, memory-diagnostics, readonly-snapshot, settings-ui, owner-projection, studio

## Summary
已完成内存诊断快照：owner 有界只读 projection + collector/API + Settings 诊断按钮。关键结论：私有容器由 owner 投影不越权；API/UI 只回元数据；严格只读禁 cleanup/abort/GC；5s deadline/5MiB/单飞409；OpenAI Codex 仅 known-session 公开 getter 数值/布尔；content-block 上限须 per-message；Settings 连点需 request generation 防竞态；前端入口触发 UI 原型门禁；诊断文件保留本机路径需分享前审阅。

## Reusable knowledge
# Summary

已完成并归档：新增只读内存诊断快照能力。覆盖 AgentSession/Studio/path cache/Browser Share/Terminal/file-change 有界投影、`POST /api/diagnostics/memory-snapshot` 原子落盘、Settings「诊断」按钮五态 UI，以及文档与 `test:memory-diagnostics`。Checker Pass；修复 content-block 按 message 计数与 Settings 响应竞态。

# Reusable knowledge

1. **Owner-boundary projections**：进程内诊断不要让统一 collector 反射私有 Map；在 `rpc-manager` / Studio runtime / browser-share / terminal / session-reader / session-file-changes 各自边界导出只读有界 projection，共享 leaf types 避免循环依赖。
2. **Strict read-only**：禁止 abort/destroy/cleanup/reset/GC/`cleanupExpired`/`listAll`/`startRpc`；诊断自身不得改变业务状态。
3. **Metadata-only surface**：API 与 Settings 只返回 filePath/bytes/duration/partial 等元数据，不回传完整 JSON，避免二次复制与内容泄露。
4. **Budgets**：cooperative 5s deadline + 固定 caps + 5 MiB compact fallback（去 samples 保 totals）+ 进程内单飞锁（并发 409）+ 同目录 tmp+rename 原子写。
5. **Allowlist + markers**：只累计长度/计数/角色类型；不输出 content/args/result/systemPrompt/transcript/buffer；用唯一 marker 测试证明文件与响应不含敏感串。
6. **OpenAI Codex**：仅对已知 active openai-codex session 调公开 getter，保留数值/布尔；不得当作私有 Map 全量。
7. **Per-message caps**：content-block 上限必须按 message 重置，不能 session 级累计饿死后序消息。
8. **UI race**：异步诊断按钮用 request generation / AbortController，防止旧响应覆盖新状态；loading 时 disable。
9. **UI 原型门禁**：从 API-only 改为 Settings 按钮会触发 ui-designer HTML 原型审批；architect child 不能嵌套派发时由主会话并行派发。
10. **隐私取舍**：诊断文件可保留本机 workspace/session 路径以便排障，必须 privacy warning，无自动上传/retention，分享前人工审阅。
11. **Smoke 注意**：新增 route 后需用本 worktree 重启 dev server；旧实例会 404。

# Source artifacts

- `summary.md`, `review.md`, `handoff.md`
- `prd.md`, `design.md`, `implement.md`, `checks.md`, `ui.md`, `ui-prototype.html`, `plan-review.md`
- 实现：`lib/memory-diagnostics-types.ts`, `lib/memory-diagnostics.ts`, `app/api/diagnostics/memory-snapshot/route.ts`, owner projections, `components/SettingsConfig.tsx` DiagnosticsPanel
- 文档：`docs/modules/api.md`, `library.md`, `frontend.md`, `docs/architecture/overview.md`, `docs/operations/troubleshooting.md`, `AGENTS.md`

## Source artifacts
- summary.md
- handoff.md
- review.md
- checks.md
- design.md
- implement.md
- prd.md
- brief.md
- ui.md
- plan-review.md
