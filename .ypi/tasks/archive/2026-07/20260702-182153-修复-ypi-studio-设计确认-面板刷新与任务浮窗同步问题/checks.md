# Checks

## 需求覆盖检查

### 设计确认

- [ ] 任务在 `planning` 完成后只能进入 `awaiting_approval`。
- [ ] 同一轮 agent turn 内尝试 `planning -> awaiting_approval -> implementing` 会在第二步失败。
- [ ] `awaiting_approval -> implementing` 无用户批准 grant 时失败，错误信息可理解。
- [ ] `override: true` 不能绕过该审批边。
- [ ] 用户在后续输入中明确回复“确认/批准/开始实现/approve/go ahead”等后，允许进入 `implementing`。
- [ ] 用户回复修改意见或否定词时，不记录 approval grant。

### Studio 面板

- [ ] 打开 Studio 面板后，当前 Tab 优先显示，不等待全部 agents/workflows/tasks 完成。
- [ ] 有旧数据时，后台刷新不会显示全屏 loading，也不会清空列表/详情。
- [ ] session 工作中刷新频率受控，用户可持续阅读任务详情和 artifacts。
- [ ] 切换 Members/Workflows/Tasks Tab 时，缺失数据可加载且错误提示不影响其它 Tab。

### 任务浮窗

- [ ] 新 session 中创建 Studio task 后，浮窗自动出现。
- [ ] 已有 session 中 `/studio-start` 创建 task 后，浮窗自动出现。
- [ ] task 绑定 context 后，`/api/sessions/[id]/studio-task` 返回 high confidence。
- [ ] 创建工具事件结束后，无需等待整页刷新即可触发重查。
- [ ] `pi_process_*` 不会作为 session-widget 高置信证据；stable `pi_<sessionId>` 可命中。

## 自动验证

最低：

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

建议新增或手工脚本验证：

1. 构造 task：`planning -> awaiting_approval`，无 grant 转 `implementing` 应失败。
2. 写入合法 grant，再转 `implementing` 应成功。
3. 使用 `override: true` 无 grant 转 `implementing` 仍失败。
4. `resolveYpiStudioTaskForSession()` 对 stable runtime pointer 命中，对 `pi_process_*` 忽略。

## 手工验收

1. 在测试 workspace 开启 `/studio-feature 修复一个小问题`。
2. 等架构师产出 PRD/Design/Implement/Checks 后，观察主 session：
   - 应展示方案摘要；
   - task 状态应为 `awaiting_approval`；
   - 不应调度 implementer。
3. 回复“先修改方案：……”：
   - 不得进入 implementing；
   - 应继续规划/等待确认。
4. 回复“确认，开始实现”：
   - 允许进入 implementing；
   - implementer 通过 `ypi_studio_subagent` 被调度。
5. 打开 Studio 面板并保持在任务详情页，启动一个长时间 session：
   - 内容不被 3s loading 覆盖；
   - 只出现轻量刷新提示。
6. 新建 session 并创建 Studio task：
   - 浮窗应在创建后自动出现；
   - 点击浮窗能打开 Studio 面板并聚焦任务。

## 回归风险

- 审批词误判导致批准无法记录：错误信息应提示用户明确回复“确认/批准”。
- 自定义 workflow 也使用 `requiresUserApproval`：需确认是否全部套用 grant 门禁，建议先至少覆盖标准 `awaiting_approval -> implementing`。
- 后台刷新保留旧数据可能显示短暂过期信息：用“刷新中/上次更新时间”提示即可。
- contextKey 优先级调整可能影响 bash 中 `YPI_STUDIO_CONTEXT_ID` 的任务绑定：需验证 bash 工具仍能绑定当前 task。
