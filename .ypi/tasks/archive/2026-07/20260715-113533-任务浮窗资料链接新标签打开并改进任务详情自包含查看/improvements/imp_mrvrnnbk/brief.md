# Brief — IMP-003 任务浮窗主任务用户验收一键完成

## 反馈摘要

用户验收反馈：

- 改进项已有「确认该改进任务已完成」一键验收。
- 主任务进入 `user_acceptance`（含改进全部解决、再次进入用户验收）时，浮窗缺少对等入口。
- 当前只能在 Chat 里口头说“验收通过”，体验不一致且易漏操作。

## 代码证据

1. **改进验收已存在**
   - `lib/ypi-studio-session-link.ts` projection：`improvements.instances[].canAccept`（仅 `waiting_user_acceptance` 且未归档）。
   - `components/YpiStudioSessionWidget.tsx`：`acceptableImprovementsForTask` + AppPrompt + `PATCH transition_improvement → accepted` + `contextId`。
   - 成功后 `onTaskChanged` 刷新；失败刷新并 toast；**不会自动 completed 主任务**。

2. **主任务验收入口缺失**
   - 浮窗在 `review_ready` 仅显示“✓ 改进已完成，主任务需要再次验收”文案，无写操作按钮。
   - `docs/modules/frontend.md` 明确写着：widget never completes or archives the main task。
   - 详情面板也没有主任务 completed 写按钮（仍依赖 Chat / 工具）。

3. **服务端门禁已具备**
   - Workflow：`user_acceptance → completed` 带 `requiresUserApproval: true`。
   - `transitionYpiStudioTask`：
     - archived 拒绝；
     - `to=completed` 时 `assertNoUnresolvedImprovementsForComplete`；
     - `requiresUserApproval` 且无 `reason`/`override` 时拒绝；
     - 可选 `contextId` 绑定校验 `assertTaskBoundToContext`。
   - HTTP：`isYpiStudioTaskTransitionBody` 接受 `{ cwd, to, reason?, contextId? }` 或 `action:"transition"`。

4. **改进解决后的主任务路径**
   - 全部改进 resolved → reconcile：`waiting_for_improvements → review`，`parentStatus=review_ready`。
   - 再次用户验收需先到 `user_acceptance`，再 `completed`。
   - 本改进 **不** 把 `review` 直接一键 completed，也不自动 `review → user_acceptance`。

## 范围与目标

### 范围内

- Widget projection 增加主任务可验收标志（建议 `canAcceptMain`）。
- 浮窗在主任务可验收时展示「确认主任务已验收完成」按钮。
- AppPrompt 二次确认；确认后 `PATCH` 主任务 `to: "completed"` + `reason` + 绑定 `contextId`。
- 与改进验收按钮视觉/文案区分。
- 失败刷新并提示；成功刷新；不乐观本地 completed。
- 轻量 helper 测试 + 前端模块文档更新。

### 非目标

- 不在有 unresolved improvements 时显示或绕过服务端门禁。
- 不自动 completed；不省略二次确认。
- 不改计划审批 grant、`awaiting_approval → implementing`、archive 流程。
- 不在 `review` / `ready` / `waiting_for_improvements` 直接完成主任务。
- 不把详情面板也做成完整验收控制台（可后续任务）。
- 不放宽 context 绑定；未绑定会话不可写。

## 风险与依赖

| 风险 | 缓解 |
| --- | --- |
| 与改进验收按钮混淆 | 独立文案、色调、确认框结果说明 |
| 误在有未解决改进时显示 | projection 与 UI 双层：`status===user_acceptance && unresolved===0 && !archived`；服务端再挡 |
| 未带 reason 被 `requiresUserApproval` 拒绝 | 固定写 reason 文案 |
| 未绑定 contextId | 与改进验收一致：缺 contextId 直接 toast，不发请求 |
| `review_ready` 用户期待立刻 completed | 仅 `user_acceptance` 显示；`review_ready` 文案可补充“需进入用户验收后可在此完成”但不在本任务自动 transition |
| 并发双击 | 沿用 in-flight ref / busy 禁用 |

## 判断标记

- **需要 UI 原型？** 是 — 新增主任务验收按钮与确认文案，且需与改进验收区分。
- **需要计划审批？** 是 — 新增写路径（主任务 completed），行为与风险变化。
- **等待澄清？** 否 — 建议方案已足够实现；若用户坚持 `review` 也可一键完成，需在审批时提出。

## 推荐方案方向

1. projection：`canAcceptMain`（或等价 `mainAcceptance.canAccept`）仅在 `user_acceptance && !archived && unresolved===0`。
2. 浮窗按钮「确认主任务已验收完成」+ AppPrompt。
3. `PATCH /api/studio/tasks/:key`：`{ cwd, to:"completed", contextId, reason }`。
4. 视觉与改进按钮区分；busy/失败/成功反馈完整。
5. 不绕过 `requiresUserApproval` 与 unresolved 阻塞。
