# UI — `handler_not_ready` 调度修复

## 门禁结论

**本轮不触发 UI HTML 原型门禁，不需要指派 ui-designer。**

原因：修复限定在 production handler 装载、scheduler timer、server startup reconcile、测试和文档；不新增/修改页面、组件、按钮、交互流程、审批体验或可见信息层级。

## 现有 UI / API 核查

`components/GithubAutomationConfig.tsx` 当前已展示：

- outcome pill：`retry_due`；
- `phase / status`；
- scheduler attempt；
- `reasonCode`；
- `updatedAt`；
- `nextRetryAt`（文案“下次自动重试”）；
- “仅重试未确认阶段”按钮。

页面在存在 queued/running/retry/blocked job 时每 20 秒刷新 status。API 安全 projection 也准确返回 #25 的 `received/retry_due/attempt=1/reason=handler_not_ready`。问题不是展示映射错误，而是后端已没有 timer，导致“下次自动重试”承诺未兑现。

## 本轮保持不变

- 不增加“scheduler stalled / handler ready”卡片。
- 不增加手工唤醒、重启或强制 handler 装载按钮。
- 不改变 Retry 按钮 checkpoint 语义。
- 不展示 raw logs、stack、module path、owner id、fencing token 或 Issue body。
- status / verify GET 继续只读，不因页面轮询触发 scheduler。

## 重新触发 UI 门禁的条件

实现中若提出以下任一变更，必须停止并由 ui-designer 基于现有设置页产出 HTML 原型，再交用户审批：

- 新增 scheduler/handler readiness 状态区；
- 将 overdue retry 改成新的视觉状态或告警 banner；
- 新增自动/人工恢复选择、重启或强制执行按钮；
- 重排最近分析详情字段；
- 修改 Retry 的确认交互或文案含义。
