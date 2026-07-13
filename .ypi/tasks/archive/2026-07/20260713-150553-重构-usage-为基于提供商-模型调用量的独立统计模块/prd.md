# PRD：基于 Provider / Model 调用量的独立 Usage

## 目标与背景

把 Usage 从“读取 session assistant 消息时顺便汇总”重构为独立、可审计的 LLM 调用统计模块。用户应能按时间、Provider、Model、调用来源与状态查看调用次数、token 和费用，并知道统计覆盖范围及缺失来源。

现状问题：

- session JSONL 是会话审计源，不是完整调用账本；独立辅助请求和 `--no-session` 请求不会进入现有统计。
- compaction/branch summary 使用 LLM，但持久化结果不带 usage。
- 每次打开 Usage 都扫描并完整打开相关 session，统计与会话库存、归档设置耦合。
- 本地 `AssistantMessage` 类型遗漏 SDK 的 `totalTokens`、`reasoning`、`cacheWrite1h` 等字段。

## 用户价值

- 明确知道“哪个 Provider / Model 被调用多少次、消耗多少 token/费用”。
- 主 Chat、Studio、辅助功能和维护请求可分来源查看，不再被 session 是否归档影响。
- 页面展示 coverage/backfill 状态，不把历史缺失误报成 0。

## 范围内

1. 独立调用事件 schema、持久化、查询、聚合、幂等与损坏隔离。
2. 覆盖仓库内已知 LLM 入口；每条记录标注 source/status/coverage。
3. 历史 session JSONL assistant usage 幂等 backfill；历史独立调用明确不可恢复。
4. 新 Usage API 与旧全局 Usage API 的双读/回退兼容。
5. Usage 页面按 Provider → Model 为主信息架构，支持日期、workspace、source、status 过滤。
6. 失败、终止、重试、流式终态与多进程写入的明确口径。
7. 文档、自动测试、人工验收、迁移与回滚。

## 范围外

- Provider 控制台账单对账、额度/余额、税费、币种转换。
- 估算 SDK 未报告的 token/费用；不得用字符数补账。
- 外部第三方 Pi extension 内部自行发起、且不经过 YPI recorder 的调用。
- v1 记录账户 ID、API key、prompt/output/tool result、responseId 原文。
- 首期替换 Chat 顶栏 session parent/child rollup 与 context occupancy。
- 将“内部 HTTP 重试次数”伪装成可精确的模型调用次数。

## 需求与验收标准

### R1：调用口径

- 一次 `calls` 表示一次由 YPI 可观测到的 LLM completion 终态（success/error/aborted），不是 SDK 内部不可观测的 HTTP attempt。
- Agent 的每个 assistant turn 各算一次；tool loop 的多轮响应分别计数。
- 外层 fallback/auto-retry/failover 若产生新的 completion 终态，各自记录；SDK 内部网络重试只记录最终可观测终态，并在 coverage 中说明。

**验收**：页面和 API 均展示此定义；不会把 `reasoning` 重复加入 output，总 token 优先使用 SDK `totalTokens`，缺失时才按四类 token 求和。

### R2：Provider / Model 主维度

- 每条事件至少含 requested provider/model；可选 response model 与 API。
- API 返回总览、按日、provider、provider+model、source、status 聚合。

**验收**：同名 model 在不同 provider 下不会合并；unknown 值单列而非丢弃。

### R3：完整性与隐私

- 事件不保存 prompt、output、thinking、tool、artifact、凭据、绝对响应内容或 responseId。
- API 返回 coverage：native/backfilled、可覆盖起点、已知遗漏、损坏记录数。

**验收**：检查落盘样本与 API，无内容/凭据字段；历史独立调用显示“不可回填”，不是 0 调用。

### R4：可靠写入与去重

- 只在终态记录，禁止从流式 delta 累加。
- session backfill 以 `sessionId + entryId` 生成确定性 eventId；直接调用在请求开始生成 callId，终态只写一次。
- 唯一事件文件以 `wx`/等价原子创建实现跨进程幂等；临时文件失败不得成为有效事件。

**验收**：重复 backfill、重复终态回调、进程并发不会增加 calls；单文件损坏被隔离并计入 diagnostics。

### R5：兼容与渐进切换

- `/api/usage?sessionId=` 与 Chat 顶栏首期保持现有返回和语义。
- 旧日期范围 aggregate API 在 UI 切换前保持可用；新 API 使用版本化 `kind/schemaVersion`。
- ledger 不依赖 session archive；旧 `usage.includeArchived` 只影响 legacy/backfill 选择，不能删除 ledger 事件。

**验收**：旧客户端继续工作；关闭新读取路径即可回滚页面而不删除事件。

### R6：UI

- 新页面以 Provider / Model 表格为中心，显示 calls、成功/失败、input/output/cache/reasoning、费用和占比。
- 提供日期、scope、source、status 过滤；有 loading/empty/error/partial/backfilling/corrupt 状态。
- “Session/Parent rollup”降级为可选 drill-down，不再作为主列表。

**验收**：HTML 原型经用户审批；桌面和窄屏均可读，键盘可操作，coverage 警告不会被隐藏。

## 未决问题（附推荐）

1. **“调用次数”是否要求物理 HTTP attempts？** 推荐采用“可观测 completion 终态”；若要求物理 attempts，必须要求 SDK/Provider 层新增公开 telemetry hook。
2. **warmup/model test 是否计入默认总览？** 推荐记录且默认纳入“系统/诊断”source，可一键过滤；否则总账不完整。
3. **首期是否统计 compaction/branch summary？** 推荐必须统计；SPIKE-01 失败时应阻塞“全部调用”承诺，而不是使用私有 monkey patch。
4. **历史 backfill 范围？** 推荐首次按现有 active+archive 全量、幂等执行；UI明确独立调用仅从上线时开始完整。
5. **是否记录账户维度？** 推荐 v1 不记录，避免隐私和多账户迁移复杂度。
