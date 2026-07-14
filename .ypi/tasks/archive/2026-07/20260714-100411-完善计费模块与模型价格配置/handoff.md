# handoff

## 已产出

- `brief.md`：现状、证据、推荐决策和阻塞项。
- `prd.md`：范围、功能/安全需求和验收标准。
- `ui.md`：HTML 原型硬门禁、ui-designer 交付要求和页面状态。
- `design.md`：数据模型、API、models.json 写入、AI 来源、兼容/迁移/回滚。
- `implement.md`：DAG 子任务与机器可读 implementation plan。
- `checks.md`：自动、API、兼容与人工验收清单。
- `plan-review.md`：用户审批入口；当前明确为不可进入实现。

## 调研与验证

已阅读 `AGENTS.md`、frontend/api/library/architecture/code-style 文档、Usage/ledger/model 配置源码、Pi `docs/models.md` 与 `docs/providers.md`，并检索参考项目及其实际 Management Center release。只做规划，未修改生产代码，未运行 lint/tsc。

## 主会话下一步

1. 派发 `ui-designer` 产出 HTML 原型并请求用户审批。
2. 让用户确认 cacheWrite 历史 API、SDK totalTokens、智能来源、explicit-free、JSONC 保真五项决策。
3. 决策和原型齐备后更新计划，再保存 implementationPlan / 进入 awaiting_approval。

## 风险

最大风险是把“停止 cache-write 获取”误做成历史费用重算、让可见拆分与 SDK total 口径混淆，以及另建价格文件导致 Pi SDK 实际不使用。设计已通过 immutable history、authoritative total 注记和直接写 models.json 约束规避，但仍需产品批准。
