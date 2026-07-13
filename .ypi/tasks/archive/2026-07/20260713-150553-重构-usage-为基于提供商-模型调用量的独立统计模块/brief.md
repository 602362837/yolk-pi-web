# Brief：独立 LLM Usage 统计模块

## 任务结论

现有 Usage 不是“全部 LLM 调用”统计，而是对 session JSONL 中 assistant message 的 `usage` 做读取时聚合。它能覆盖主 Chat 与持久化的 Studio SDK child，却天然漏掉独立 `completeSimple`/`streamSimple` 调用、CLI `--no-session` child、压缩与分支摘要等调用。因此，仅重写 `lib/usage-stats.ts` 或页面无法满足目标，必须先建立与 session 内容解耦的调用事件账本。

## 已核查范围

- 现有统计：`lib/usage-stats.ts`、`app/api/usage/route.ts`、`UsageStatsModal`、Chat 顶栏 rollup、Usage 配置与现有回归脚本。
- 持久化：Pi `SessionManager` 在 `message_end` 后把 assistant message（含 usage）写入 JSONL；压缩/分支摘要只保存 summary，不保存其模型响应 usage。
- 项目内 LLM 入口：
  1. 主 Chat/ypic 共用 `createAgentSession`；
  2. Studio SDK child 的 `createAgentSessionFromServices`；
  3. Studio CLI child 的 `pi --mode json -p --no-session`；
  4. Terminal env assistant；
  5. Trellis workflow assistant（结构化及纯文本 fallback）；
  6. models-config test；
  7. OpenAI Codex warmup；
  8. AgentSession 内部自动/手动 compaction 与 branch summary。
- SDK 0.80.6 usage：`input`、`output`、`cacheRead`、`cacheWrite`、`totalTokens`、费用分项/总额；可选 `cacheWrite1h`、`reasoning`。`reasoning` 已包含于 output，不能再次计入总 token。

## 推荐方向

- 新建 append-only、按日分区、不可变单事件文件的 LLM 调用账本，使用确定性 `eventId` 幂等写入；统计模块只读账本，不读取 transcript。
- 先 shadow capture 与历史 backfill，再做对账 API，最后经 UI 原型审批后切换 Usage 页面；Chat 顶栏 `/api/usage?sessionId=` 首期保持原语义。
- 不通过 SDK 私有字段 monkey patch 强行覆盖压缩/分支摘要；先做 SDK 拦截可行性 spike。若无稳定公开拦截点，则必须选择升级/上游补 hook，或明确接受 coverage 缺口。

## 难度评估

**高（8/10）**。数据结构与聚合本身中等，主要难点是：全部入口覆盖、SDK 隐式调用、内部/外部重试口径、流式终态去重、多进程写入、历史数据不完整、旧 API/顶栏兼容及页面重构。

## 当前门禁

该任务改变 Usage 页面信息结构与交互，已触发 UI 原型硬门禁。已由 UI Designer 基于现有 `UsageStatsModal` 交付任务目录内 HTML 原型 [usage-provider-model-prototype.html](usage-provider-model-prototype.html) (Revision 1)。当前门禁：等待用户在主会话中审查并审批该原型。未取得审批前，不得进入 implementing 阶段。
