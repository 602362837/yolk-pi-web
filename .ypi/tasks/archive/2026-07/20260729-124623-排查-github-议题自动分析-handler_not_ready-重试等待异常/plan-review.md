# Plan Review — GitHub 议题分析 `handler_not_ready` 修复

> 状态：**根因与实施计划已完成，未修改生产代码；等待主会话/用户审批。**

## 审阅入口

- [Brief：现场证据与根因链](brief.md)
- [PRD：R1–R12与验收场景](prd.md)
- [UI：不触发HTML原型门禁](ui.md)
- [Design：direct handler + durable timer + startup reconcile](design.md)
- [Implement：HNR-01…04与机器计划](implement.md)
- [Checks：production bundle、timer与现场UAT矩阵](checks.md)

## 根因摘要

#25 正常 webhook 入队，但 0.8.10 生产 bundle 中：

1. scheduler 同步 require 一个被 Webpack 包装为 async module 的 runner；冷启动 export 未完成，错误被空 catch 吞掉；
2. tick 仍先取得业务 lease并增加 attempt，然后误用 default handler，写成 `handler_not_ready`；
3. fallback 的 5 秒 timer 被 finally 的 2 秒 timer覆盖；2 秒 tick尚未到期且不续订，scheduler永久停摆；
4. server startup没有queue ensure，重启也不自愈。

Durable event 精确停在 `delivery_enqueued → job_started(attempt=1) → default_handler_defensive_fallback`，之后无第二次 attempt。当前 job 未运行模型、未评论、未关闭。

## 方案摘要

- production scheduler 静态直接绑定唯一 analysis handler；default/registry只允许显式测试替身或删除。
- readiness 在 lease 前；handler bootstrap失败不得消耗job attempt。
- scheduler按durable queue最早deadline重算timer，job settlement后rescan；early tick不能吞 future retry。
- Node server startup自动ensure/reconcile，多进程沿用filesystem lease/fence。
- status/verify GET、webhook 202、checkpoint/effect幂等和现有UI保持不变。
- 增加真正执行 `.next` artifact 的production smoke，以及fake-clock timer/startup测试。

## Implementation 摘要

| ID | 内容 | 依赖 |
| --- | --- | --- |
| HNR-01 | 生产handler直接绑定与lease前readiness | — |
| HNR-02 | durable deadline/timer重算和no-spin | HNR-01 |
| HNR-03 | Node startup queue恢复与多进程验证 | HNR-02 |
| HNR-04 | production bundle smoke、docs、全量门禁与UAT | HNR-01..03 |

完整 machine plan 见 [implement.md](implement.md)。建议串行执行，`maxConcurrency=1`，因为前三项共享scheduler生命周期边界。

## UI 门禁

本轮没有页面、组件、按钮、交互或信息层级变化，**不指派 ui-designer、不需要HTML原型**。现有UI映射是正确的，错误在后端没有兑现`nextRetryAt`。

若实现提出scheduler readiness卡片、overdue视觉状态、强制唤醒按钮或Retry交互变化，必须退回planning并走ui-designer HTML原型审批。

## 需要用户确认

1. **建议批准自动恢复：**新版本启动后自动继续 #25 等 `retryability=automatic` job，不要求人工点Retry。
2. **建议批准无UI变更：**只修后端调度可靠性。
3. **运维选择：**如果不希望部署后 #25 立即分析并可能发布一条规范评论，请在升级前设置 `paused=true`；不要删除或手改job。

## 审批后动作

主会话应保存 [implement.md](implement.md) 中 fenced `json ypi-implementation-plan`，切到 `awaiting_approval`；用户明确批准后才进入实现。实现完成必须跑 `npm run build` + production artifact smoke，不能只凭当前源码 suite 绿测。
