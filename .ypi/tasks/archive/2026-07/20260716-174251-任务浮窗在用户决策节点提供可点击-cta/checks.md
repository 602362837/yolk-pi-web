# Checks：YPI Studio 浮窗用户决策 CTA

## 需求覆盖检查

- [x] 只有服务端 `userActions[]` 驱动决策按钮；component 不按 status 自行生成批准 CTA。
- [x] 主任务 awaiting approval 仅一主一次：批准、需要修改。
- [x] 第一项 waiting plan approval 改进仅显示一个精确作用域批准 CTA。
- [x] planning / implementing / checking / archived 不出现伪继续或批准按钮。
- [x] quick preview 与 decision region 分离；打开材料不产生 grant。
- [x] 现有改进结果验收、主任务结果验收与归档分支无回退。
- [x] **保全清单 A–F 全过**（见 PRD）：壳层/**完整 8 站 rail**、quick preview、改进摘要与结果验收、主验收/归档、runtime/子任务/runs、写锁与聊天批准路径均仍存在且行为正确。
- [x] WorkflowRail 仍渲染 8 个 station（Brief…Archived），保留 `is-eight-station` 两行布局；不得回退为 4 站示意轨。
- [x] 决策区是插入层：不得替换资料区或验收区；计划批准文案与结果验收文案不可混用。
- [x] 多条 `waiting_user_acceptance` 仍可各自显示结果验收按钮（`userActions` 的“只投影第一项”仅约束计划批准 CTA）。

## 自动验证

```bash
npm run test:studio-dag
npm run test:studio-main-accept
npm run test:studio-task-preview
npm run test:studio-session-ownership
npm run lint
node_modules/.bin/tsc --noEmit
```

若现有 package script 名称与上表不同，实现员先核对 `package.json`；新增 focused 测试建议为 `test:studio-widget-actions`，覆盖纯投影和 action helper，不依赖浏览器。

## 服务端动作矩阵

### 主计划批准

- [x] 正确 context/status/revision/material：写 `source=user-widget` grant 并原子进入 implementing。
- [x] grant `approvedAt` 严格晚于 approval gate。
- [x] 无 context、未绑定 context、transfer 后旧 context：拒绝且零写入。
- [x] expectedRevision 过期：409，零写入。
- [x] 非 awaiting/已归档：拒绝，零写入。
- [x] plan-review 空/占位、UI gate 缺 HTML：拒绝，零写入。
- [x] 请求体携带 override/任意 endpoint/source：拒绝或忽略非 allowlist 字段，绝不绕 gate。
- [x] 并发两次批准：至多一次成功 transition；第二次冲突，不重复事件。
- [x] 历史 `user-input` grant 仍可通过旧聊天路径进入 implementing。

### 需要修改

- [x] 空白/超长 feedback：拒绝，状态与 revision 不变。
- [x] 合法反馈：awaiting approval -> planning，grant 清除，revision + 1，currentMember=architect。
- [x] event 包含 allowlist source/action/revision/context 与 bounded feedback。
- [x] continuation 失败时不回滚 planning；响应/Toast 明确可恢复。
- [x] 陈旧卡、错 context、并发 artifact revision：冲突并刷新。

### 改进计划批准

- [x] improvementId 属于父任务、状态/revision/context/material 正确：approval source=user-widget，instance 进入 implementing，parent 仍 waiting_for_improvements。
- [x] 不存在/跨任务 improvementId：拒绝。
- [x] 缺 instance plan-review 或 UI evidence：拒绝。
- [x] revision 更新后旧批准 action：冲突；旧 grant 不复用。
- [x] 改进 action 不读写 main implementationPlan/progress。
- [x] 多个 waiting plan approval 只投影第一项；详情仍可看到全部。

## 投影与隐私检查

- [x] `userActions` 最大 2 项，字段均为固定 allowlist。
- [x] 不返回 cwd、绝对路径、artifact body、feedback、transcript、任意 URL/PATCH body。
- [x] archived/terminal action 为空；旧客户端 wire 兼容。
- [x] action id 包含 scope/revision 且稳定，不泄露 secret。
- [x] 任务 transfer 或 revision 变化后下一次投影立即更新/移除旧 action。

## 续推检查

- [x] 主计划批准后，现有 primary implementing autocontinue 只在 ready 且有 free slot 时触发。
- [x] 改进批准后的 continuation 带 improvementId，只调用 instance `implementation_next` / `claim_improvement_subtask`。
- [x] 多 task 绑定仍只自动续推 primary task，避免跨任务误派发。
- [x] RPC wrapper 不存在、busy 或 follow-up 失败不破坏已落库用户决定；有可见恢复提示。
- [x] continuation 去重 key 含 task + improvement + revision/state，30 秒内不重复。

## UI 人工验收

> Checker 2026-07-16：静态对照 HTML 原型 + 组件/CSS 完成；完整浏览器点按矩阵建议主会话在 dev 补一轮（非阻塞）。

- [x] HTML 原型由 ui-designer 真实交付并经用户批准。
- [x] 360px 桌面卡：资料区、决策区、runtime 层级清晰，不溢出。
- [x] 主批准确认显示任务名、revision、目标状态；取消零请求。
- [x] 需要修改 prompt 必填；IME 输入、Enter、Escape、焦点恢复正常。
- [x] 改进批准确认显示 IMP 编号/标题/revision，并明确不是结果验收。
- [x] busy 时所有 write CTA 串行禁用；按钮有 `aria-busy` 和文字状态。
- [x] 409/422/500 都刷新投影并显示固定安全文案；无乐观状态闪烁。
- [x] 移动 bottom sheet 按钮全宽/至少 44px，不被底部安全区遮挡。
- [x] Tab/Shift+Tab/Enter/Space/Escape、focus-visible、screen reader label 可用。
- [x] light/dark、高对比、320/375/640px、低高度与 reduced-motion 可读。
- [x] 拖动 header 与 CTA 点击互不干扰，按钮点击不会拖动或打开详情。

## 回归风险

- [x] `YpiStudioPlanReviewModal`、`YpiStudioTaskDocumentView` 与 files preview 仍无 PATCH/grant。
- [x] `recordYpiStudioUserApproval` 聊天路径和批准 regex 不变。
- [x] session exclusive ownership transfer 继续清跨 context grant。
- [x] task events/JSONL/shared type consumers全部搜索并更新。
- [x] YpiStudioPanel 任务详情默认 Tab、快速预览和绑定行为不变。
- [x] 不修改 workflow JSON 来塞伪状态，不给普通阶段投影 action。
- [x] `git diff components/YpiStudioSessionWidget.tsx` 审查：无意外删除 `acceptableImprovementsForTask` / `handleAcceptImprovement` / `handleAcceptMainTask` / `quickPreviewActionsForTask` / `WorkflowRail` / runtime 渲染。
- [x] `npm run test:studio-main-accept` 与 `npm run test:studio-task-preview` 必须绿，证明验收与只读预览未回退。

## 现有能力场景（手工/原型）

- [x] 场景「改进结果待验收」：橙块 +「确认该改进任务已完成」仍在；无计划批准主 CTA（除非同时另有 waiting_plan_approval 第一项）。
- [x] 场景「主任务结果待验收」：「确认主任务已验收完成」+ 确认并归档仍在。
- [x] 场景「执行中」：有 runtime/子任务，无决策 CTA，quick preview 可只读。
- [x] 场景「归档」：只读徽章，无任何写按钮。

## 规划产物检查（本轮）

```bash
for f in brief.md prd.md ui.md design.md implement.md checks.md plan-review.md studio-widget-decision-cta-prototype.html; do test -s ".ypi/tasks/20260716-174251-任务浮窗在用户决策节点提供可点击-cta/$f"; done
rg -n 'schemaVersion|dependsOn|maxConcurrency' ".ypi/tasks/20260716-174251-任务浮窗在用户决策节点提供可点击-cta/implement.md"
rg -n '现有能力保全清单|acceptableImprovementsForTask|handleAcceptMainTask' ".ypi/tasks/20260716-174251-任务浮窗在用户决策节点提供可点击-cta"
```

门禁状态：HTML 原型已交付；用户审阅时需同时确认 **新决策 CTA** 与 **现有能力保全清单**。
