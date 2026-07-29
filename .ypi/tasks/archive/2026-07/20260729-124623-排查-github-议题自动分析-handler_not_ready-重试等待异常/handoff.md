# Handoff — architect

## 已完成

- 读取 GitHub automation architecture/integration/API/frontend/library/runbook 与相关 scheduler/runtime/runner/store/projection/UI 代码。
- 只读核对运行中的全局 `0.8.10` production bundle、#25 job、安全事件和 status API。
- 确认三段根因：Webpack async runner 被同步 require、retry timer 被提前 poll 覆盖后断链、server startup无queue恢复。
- 产出 [brief.md](brief.md)、[prd.md](prd.md)、[ui.md](ui.md)、[design.md](design.md)、[implement.md](implement.md)、[checks.md](checks.md)、[plan-review.md](plan-review.md)。
- 未修改生产代码、未修改job、未点击Retry、未commit/push/merge。

## 已运行验证

- `npm run test:github-automation`：全部通过（10 + 24 + 9 + 7 + 18）。
- 只读 production bundle 检查确认 scheduler同步读取模块81309，而81309由Webpack `c.a(... async ...)` 包装。
- 现场event确认只有一次attempt，之后没有自动重试。

## 主会话需要决定

1. 是否批准部署后startup自动恢复 #25（推荐批准）。
2. 若不希望立即产生GitHub评论，是否在升级前先全局暂停。
3. 批准后保存implementationPlan并进入awaiting_approval；不要在审批前实现。

## 剩余风险

- production bundle行为无法由当前jiti源码suite覆盖；必须新增并运行真实`.next` smoke。
- startup多进程必须继续依赖filesystem lease/fence去重。
- 自动恢复#25可能立刻触发真实分析与规范评论；关闭仍受现有严格门禁。
- 若实现扩展到UI变化，当前“无需原型”结论失效，必须补ui-designer HTML原型审批。
