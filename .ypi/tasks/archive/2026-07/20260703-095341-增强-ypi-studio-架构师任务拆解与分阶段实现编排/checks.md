# Checks — 验收与质量门禁

## 需求覆盖检查

### 阶段一：MVP

- [ ] 架构师默认 prompt 要求输出结构化 `Implementation Plan`。
- [ ] `implement.md` 示例/规范同时包含人类可读表格和可机器读取 JSON plan。
- [ ] `task.json` 支持保存 `implementationPlan`。
- [ ] `task.json` 支持保存 `implementationProgress`。
- [ ] 旧任务缺失新字段时列表、详情、归档读取不报错。
- [ ] `GET /api/studio/tasks/[taskKey]` 返回新增字段。
- [ ] API/tool 能保存 plan 并初始化 progress。
- [ ] 实现员 prompt 明确：优先读 plan/progress；有 `subtaskId` 只做该子任务；无 `subtaskId` 不默认全量实现。
- [ ] Studio UI 能展示子任务列表和状态。
- [ ] Studio UI 能展示当前执行项、下一个 ready 项或阻塞项摘要。
- [ ] 相关 docs 更新：API、frontend、library、architecture。

### 阶段二：自动调度与细粒度执行

- [ ] 能自动选择第一个依赖满足的 `ready` 子任务。
- [ ] `claim` 后子任务进入 `running`，并写入 `activeSubtaskId`。
- [ ] 子任务状态支持 `pending / ready / running / blocked / done / skipped`。
- [ ] 实现员 run 能关联 `subtaskId`。
- [ ] 父会话能将单个子任务标记 `done / blocked / skipped`。
- [ ] 单个 `blocked / done / skipped` 子任务可重新置为 `ready`，保留 attempts/history。
- [ ] 单个子任务可记录 checker 局部补查状态和 runId。
- [ ] 并行扩展字段存在，但默认调度仍串行。

### 审批门禁专项

- [ ] `planning -> awaiting_approval` 后主会话停止并请求用户确认。
- [ ] 未记录用户明确批准时，`awaiting_approval -> implementing` 失败。
- [ ] `override` 不能绕过 `awaiting_approval -> implementing`。
- [ ] `claim_implementation_subtask` 在 `planning` / `awaiting_approval` 下失败。
- [ ] `update_implementation_subtask` 不允许在审批前把子任务置为 `running` 或 `done`。
- [ ] prompt 文案没有暗示可以审批前实现。

## 自动验证

必须运行：

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

建议运行：

```bash
npm run test:studio-policy
```

如果新增纯调度测试脚本：

```bash
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/test-ypi-studio-implementation-plan.mjs
```

建议测试覆盖：
- 旧 task record 无 implementation 字段。
- 保存 plan 初始化 progress。
- 依赖未满足时 next ready 跳过候选。
- 有 running active 且 `maxConcurrency=1` 时不再 claim 新任务。
- 主状态非 `implementing` 时 claim/running/done 被拒绝。
- reset done/blocked/skipped -> ready 保留 attempts/history。

## 手工验收

1. **旧任务兼容**
   - 打开 Studio 面板，选择一个没有 `implementationPlan` 的旧任务。
   - 期望：任务详情正常打开，Implementation 区域显示空态，不影响 artifacts/subagents/events/metadata。
2. **MVP plan 展示**
   - 创建或编辑一个测试任务，使 `task.json` 包含 implementation plan/progress。
   - 打开 Studio 面板任务详情。
   - 期望：子任务按 phase/order 展示，状态 badge 正确，任务卡片显示 done/total 和 current/next/blocked 摘要。
3. **审批门禁**
   - 任务在 `awaiting_approval` 时尝试进入 `implementing`，不提供后续用户批准。
   - 期望：服务器返回现有 approval gate 错误；override 也失败。
   - 尝试 claim 子任务。
   - 期望：claim 失败并提示必须先获批进入 implementing。
4. **逐子任务执行**
   - 用户确认后进入 `implementing`。
   - 调用 next/claim，派发 implementer 且带 `subtaskId`。
   - 期望：实现员只围绕该子任务汇报；run 记录和 UI 都能看到 subtask 关联。
5. **阻塞与重跑**
   - 将一个 running 子任务标记 blocked，再重置 ready。
   - 期望：blocked reason、history、attempts 保留，next ready 能重新选中。
6. **局部检查记录**
   - 对一个 done 子任务记录 localReview requested/running/passed 或 failed。
   - 期望：UI 显示局部检查状态，不影响全局 checking 状态。

## 代码质量检查

- [ ] TypeScript 类型无 `any` 扩散；动态 JSON 边界有 normalizer/validator。
- [ ] 新增字段全部 optional，旧数据可兼容。
- [ ] API route 只做请求鉴权和 body 分发，复杂逻辑放在 `lib/ypi-studio-tasks.ts`。
- [ ] 所有 workspace/task 路径仍通过现有安全边界，不新增任意路径写入。
- [ ] UI 不手写重复状态派生；优先使用后端 detail/summary 字段。
- [ ] 新增 action 或字段已搜索消费者并更新 docs/tests。
- [ ] 不改动无关功能，不重写主状态机。

## 回归风险重点

| 区域 | 风险 | 检查方法 |
| --- | --- | --- |
| 任务列表扫描 | 用户手改 task.json 导致读取失败 | malformed 字段应降级或记录 readError，不影响其他任务 |
| 审批门禁 | 子任务 claim 绕过 awaiting_approval | 手工/API 测试 planning/awaiting_approval 下 claim 必须失败 |
| Subagent prompt | 实现员仍执行全部任务 | 检查 member prompt 和 child prompt 中 subtaskId 规则 |
| UI 面板 | 新 tab 导致现有 artifacts/subagents/events 退化 | 手工打开已有任务详情逐 tab 检查 |
| Widget | 投影加载过重 | 只传轻量 implementation summary，不传完整 instructions/acceptance 长文本 |
| 文档 | API/tool 行为与实现不一致 | 对照 docs/modules 和实际 action/schema |

## Checker 关注点

- 优先审查 `awaiting_approval` 门禁是否仍是硬门禁。
- 优先审查实现员是否被强约束为“单子任务执行”。
- 审查旧任务兼容、归档只读、路径安全和数据 normalizer。
- 审查 UI 是否能清楚表达 `pending/ready/running/blocked/done/skipped`，特别是 blocked 和 current item。
- 审查 docs 是否覆盖新增数据结构、API/tool、UI 和工作流约束。
