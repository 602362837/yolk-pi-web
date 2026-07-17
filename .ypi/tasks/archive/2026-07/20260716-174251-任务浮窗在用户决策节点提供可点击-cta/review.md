# Review：CTA-VERIFY-05 — 任务浮窗用户决策 CTA

**Subtask:** `CTA-VERIFY-05`  
**Reviewer:** checker  
**Date:** 2026-07-16  
**Verdict:** **Pass**（实现可进入 checking / ready；主会话负责状态迁移）

## 范围与方法

对照 PRD 保全清单 A–F、Design 契约、Checks 矩阵与 HTML 原型信息层级，审查当前未提交 diff；补齐一处 request-changes 续推接线与模块文档；运行 focused / regression / lint / tsc。

## Findings Fixed

1. **`request_plan_changes` 成功后未触发 best-effort 续推（blocker → fixed）**  
   - 证据：`bestEffortContinueAfterWidgetRequestPlanChanges` / `studio_user_action` 已在 session-link + rpc-manager 实现，且 DAG 测试覆盖 command 形状，但 `PATCH /api/studio/tasks/[taskKey]` 成功分支原先只写库返回 task，未调用 continuation helper。  
   - 修复：在 route 成功路径调用 `bestEffortContinueAfterWidgetRequestPlanChanges(...)`；continuation 失败不回滚已落库的 planning 决定。  
   - 文件：`app/api/studio/tasks/[taskKey]/route.ts`

2. **模块文档缺口（non-blocking → fixed）**  
   - 补齐 `userActions` 投影、显式 PATCH action、grant source `user-widget`、续推 scope（main / improvement / request-changes）、兼容与回滚、保全不变量。  
   - 文件：`docs/modules/api.md`、`docs/modules/frontend.md`、`docs/modules/library.md`、`docs/architecture/overview.md`

## Remaining Findings

### Non-blocking

1. **浏览器人工矩阵未在本机完整点按**  
   无完整 draggable widget + AppPrompt focus 自动化。已对照 HTML 原型与组件实现做静态验收（信息层级、确认文案、busy/aria、移动 44px CSS、reduced-motion）。建议主会话在 dev 中快速点一次主批准 / 需要修改 / 改进计划批准 / 既有结果验收。

2. **busy 期间 quick preview 一并 disabled**  
   与“预览可保持只读可用或统一禁用”契约一致；非回归，仅记录交互取舍。

### None blocking

无剩余阻塞项。

## 保全清单 A–F（diff 级）

| 项 | 结论 |
| --- | --- |
| A 壳层 / 完整 8 站 rail / 详情 | Pass — `WORKFLOW_RAIL_STAGES` 仍 8 站；`is-eight-station` 保留；无删站 diff |
| B quickPreviews 只读 | Pass — 资料区仍在决策区之前；preview GET-only 回归绿 |
| C 改进摘要 + 结果验收 | Pass — `acceptableImprovementsForTask` / `handleAcceptImprovement` 仍在 |
| D 主验收 + 确认并归档 | Pass — `handleAcceptMainTask` / main-accept 块保留；main-accept 测试绿 |
| E runtime / 子任务 / runs | Pass — decision region 插入在 runtime 之前，runtime 未删 |
| F 写锁 + 聊天 user-input | Pass — 决策与验收共用 `acceptingInFlightRef`；extension 同时接受 `user-input`/`user-widget` |

信息层级实际顺序：

```text
顶栏/标题/rail/元信息
→ 改进摘要 + 结果验收
→ 主验收 / review_ready 提示 / 归档徽章
→ quickPreviews
→ 【新增】userActions 决策区
→ runtime / 实现进度 / runs
```

## 安全与契约

| 检查 | 结论 |
| --- | --- |
| 仅投影驱动 CTA | Pass — `userActionsForTask` 过滤服务端 actions；无 status→approve helper |
| 主 awaiting 一主一次 | Pass — 投影 + widget-actions 测试 |
| 仅第一项 waiting_plan_approval | Pass — 投影 + 测试 |
| 非决策阶段无伪继续 | Pass |
| 原子 grant + transition | Pass — 单锁 helper；失败零部分写（DAG 测试） |
| revision CAS / 错 context / transfer | Pass — 409 + ownership 测试 |
| override 不可进入 widget body | Pass — body guard `override === undefined` |
| preview/modal 只读 | Pass — task-preview 回归绿 |
| 改进批准不写 main plan/progress | Pass — helper + DAG |
| 改进续推带 improvementId | Pass — autocontinue command + rpc prompt |
| request-changes 续推 best-effort | Pass — route 已接线；失败不回滚 |
| grant source 兼容 | Pass — `user-input` \| `user-widget` 读写 |

## Verification

| Command | Result |
| --- | --- |
| `npm run test:studio-widget-actions` | Pass |
| `npm run test:studio-dag` | Pass |
| `npm run test:studio-main-accept` | Pass (13 cases) |
| `npm run test:studio-task-preview` | Pass |
| `npm run test:studio-session-ownership` | Pass |
| `npm run lint` | Pass (0 errors; 6 pre-existing unrelated warnings) |
| `node_modules/.bin/tsc --noEmit` | Pass |

## Verdict

**Pass.** Phase 1 决策 CTA 为叠加实现；保全清单 A–F 与安全矩阵通过；续推缺口已修；文档与 focused 测试齐备。

### 主会话建议

1. 将 `CTA-VERIFY-05` 标为 done。  
2. 任务可进入 `checking` / `review_ready`（由主会话迁移）。  
3. 可选：dev 手工点一次浮窗主批准 / 需要修改 / 改进计划批准，确认 toast 与 RPC 续推观感。  
4. 不要 commit/push（本检查员未执行）。
