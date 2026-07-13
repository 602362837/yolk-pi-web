# Handoff：Usage 架构设计

## 已完成

- 全面核查现有 session-scan Usage、API、modal、顶栏 rollup、配置与回归测试。
- 枚举仓库内 LLM 入口：主 Chat/ypic、Studio SDK/CLI、Terminal env assist、Trellis workflow assist、model test、Codex warmup、compaction、branch summary。
- 核对 Pi SDK 0.80.6 usage 与 JSONL 持久化：普通 assistant usage 在 `message_end` 后落 session；compaction/branch 只存 summary，当前统计漏记。
- 产出独立事件账本、分阶段 capture/backfill/query/API/UI/rollback 设计和机器可读 DAG。

## Artifacts

- [`brief.md`](brief.md)
- [`prd.md`](prd.md)
- [`ui.md`](ui.md)
- [`design.md`](design.md)
- [`implement.md`](implement.md)
- [`checks.md`](checks.md)
- [`plan-review.md`](plan-review.md)

## 验证

- 仅修改 Studio planning artifacts，未修改业务代码。
- 已对照项目 docs、调用入口、installed pi SDK docs/types/runtime persistence 源码。
- 已验证 `implement.md` 机器计划 JSON：10 个唯一子任务，依赖均可解析。
- 已验证 `plan-review.md` / `handoff.md` 相对链接存在；规划 artifacts 无 TBD（尚未进入的 `review.md` 除外）。
- 未运行 lint/typecheck：本次无业务代码变更。

## 剩余风险 / 阻塞

1. **UI 硬门禁**：已交付 HTML 原型，但仍待用户审批；在获取用户审批前，不得进入 implementing。
2. **SDK 技术门禁**：公开文档未承诺覆盖 normal/compaction/branch 的全局 completion observer；SPIKE-01 必须 go，禁止长期依赖私有 monkey patch。
3. SDK internal retry 无逐 attempt usage，无法诚实统计物理 HTTP attempts。
4. 历史 direct/CLI/compaction/branch 调用不可 backfill，只能通过 coverage 声明。

## 主会话需决定

- 确认 calls 口径为可观测 completion 终态。
- 是否默认纳入 warmup/model test（推荐记录并纳入系统 source，可过滤）。
- SDK hook 不足时选择升级/上游 hook（推荐）或接受 known gap。
- 接受 active+archive backfill、历史 coverage 缺口及 v1 无账户维度。
- 主会话需引导用户审查 HTML 原型并获得明确审批。
- 原型获批后，再更新 `ui.md`/`plan-review.md` 中的审批记录、保存 implementationPlan 并进入 awaiting_approval 状态以获得整体计划批准。
