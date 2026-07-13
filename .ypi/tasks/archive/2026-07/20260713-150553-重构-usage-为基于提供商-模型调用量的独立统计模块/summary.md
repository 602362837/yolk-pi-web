# Summary

架构设计已完成，未修改业务代码。推荐把 Usage 从 session JSONL 读取时聚合迁移为独立、append-only、按日分区、确定性 eventId 幂等的 LLM 调用事件账本；先 shadow capture + session backfill + dual-read 对账，再切换 Provider/Model 主视图。Chat 顶栏 session rollup 首期保持不变。

难度高（8/10）。关键门禁是 SDK 对 compaction/branch summary 的稳定 completion observer，以及用户对 HTML 原型的最终审批。UI 设计员已成功交付 HTML 交互原型。当前尚不应进入 implementing 阶段；主会话需引导用户审查已交付的原型，并确认调用口径、系统请求范围、SDK hook 路线、backfill/coverage 与账户维度等决策。
