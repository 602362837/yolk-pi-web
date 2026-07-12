# handoff — 子任务 memory-diagnostics-validation

文档与安全/性能验收屏障。前三个子任务（runtime projections、snapshot/API、Settings UI）已实现并通过自身验证；本子任务只更新文档并补齐验收证据，未改实现代码、未升依赖、未改脚本。

## Files Changed

- `docs/modules/api.md` — 新增 `diagnostics/memory-snapshot/` POST 路由行，记录 201 元数据契约、409 `snapshot_in_progress`、500 结构化错误、`Cache-Control: no-store`、只读边界、section 覆盖（process/V8 + AgentSession + Studio + path cache + Browser Share + Terminal + file-change）、OpenAI Codex 仅 known-active-session 公开 getter 限制、5s deadline / 5 MiB compact fallback、原子写 `0700`/`0600`、input-free 文件名、隐私块保留本机路径、curl smoke 用法；在 Implementation Pointers 增加一条指向 `lib/memory-diagnostics.ts` / `lib/memory-diagnostics-types.ts` 与前端 docs。
- `docs/modules/library.md` — 新增 `lib/memory-diagnostics-types.ts` 与 `lib/memory-diagnostics.ts` 两行：契约/budget/limits/projection 类型、orchestration、process/V8、纯 `computeFindings`、动态 import 的 owner projection 边界、`compactSnapshot`/`writeSnapshotAtomic`/`triggerMemorySnapshot`（`globalThis.__piMemoryDiagnosticSnapshotInFlight` 单飞）、严格只读与隐私边界。
- `docs/modules/frontend.md` — 扩展 `components/SettingsConfig.tsx` 行，说明 `diagnostics` section（左侧导航「诊断」+ 按钮「生成内存诊断快照」）、内联 `DiagnosticsPanel`、idle/loading/success/busy(409)/error 五态、success 仅元数据 + 复制路径 + 固定隐私 callout + curl 次要说明，纯客户端本地状态不入 `pi-web.json`、不渲染完整 JSON。
- `docs/architecture/overview.md` — Project Invariants 末尾新增一条 invariant：内存诊断快照是只读运维能力（非泄漏修复），记录 collector/owner 模块、deadline/size 预算、单飞锁、API/UI 只回元数据、保留本机路径与隐私块、OpenAI Codex 仅 known-session、无自动 retention、additive 不改格式。
- `docs/operations/troubleshooting.md` — 新增「Memory Diagnostic Snapshots」section：主入口（Settings 诊断）与 curl 兼容入口、`jq` 解析与多快照对比建议、隐私分享前置审阅、OpenAI Codex known-session 限制、手动 `rm` 清理（无自动 retention）、409/500/partial 文案解释、`npm run test:memory-diagnostics` 用法。
- `AGENTS.md` — Module Entry Points 表新增一行「Memory diagnostic snapshots」指向 `lib/memory-diagnostics*.ts` + route + SettingsConfig 与对应 docs（导航入口，无长文）。

## Verification

- `node_modules/.bin/tsc --noEmit` — 通过（无输出）。
- `npm run lint` — 0 error / 0 warning。
- `npm run test:memory-diagnostics` — `memory-diagnostics tests: all passed`（覆盖 schema、marker 排除、caps/deadline、section 失败隔离、findings 阈值边界、compact fallback、原子写 tmp 清理、并发锁释放）。
- `git diff --check` — 无空白错误。
- 人工 curl smoke（Settings 入口同 API）**未完成**：端口 30141 上运行的 dev server 是本 worktree 路由新增之前启动的旧实例，`POST /api/diagnostics/memory-snapshot` 返回 404（route 未注册到该实例）。未重启用户在跑的 server；focused test 已在进程内验证 collector/原子写/锁/schema，待用户用本 worktree 重启 dev server 后即可一键 smoke（Settings → 诊断 或 curl），无需额外代码改动。

## checks.md 项覆盖

- 需求覆盖/安全/只读/有界性/数据正确性：由 focused test 与既有实现保证；文档已记录隐私边界、OpenAI known-session 限制、5 MiB/5s fallback、单飞 409、原子写失败清理、保留本机路径与 share-before-review。marker 排除、只读性（不调用 destroy/abort/cleanup/reset/GC/listAll/startRpc）、并发锁、原子写失败路径已在 `scripts/test-memory-diagnostics.mjs` 取得 pass 证据。
- UI 检查：实现侧（上一子任务 handoff）覆盖五态 + 复制路径 + 隐私 callout，本子任务在 frontend.md/troubleshooting 文档化；长路径 `overflowWrap: anywhere` + 复制按钮已实现。
- 人工验收的「真实增长对比」「Studio child run 后再次采集」需要长跑环境，属本子任务范围外（设计预期），文档已提供多快照对比方法。

## Notes / Risks

- **手工 smoke 阻塞（非代码缺陷）**：旧 dev server 未注册新 route；用本 worktree 重启 `npm run dev` 后即可 smoke，预计一键通过。无需 decisions，仅提醒主会话/用户重启 server。
- 诊断文件在磁盘上累积，无自动 retention；文档明确建议手动 `rm` 审阅后删除。
- OpenAI Codex stats 仅覆盖 known active openai-codex sessions（公开 getter 数值/布尔），不枚举第三方私有 Map；文档已显式标注为已知限制。
- 未运行 `next build`（按约束）；未升依赖、未改 npm script、未改 API/JSONL/task/session/config 格式；所有改动为 additive 文档。

### 回滚

删除本次 6 个文档文件的修改（`git checkout -- docs/... AGENTS.md`）即可回滚文档；诊断 route/collector/Settings section 的回滚分别属于前三个子任务的既有回滚路径。