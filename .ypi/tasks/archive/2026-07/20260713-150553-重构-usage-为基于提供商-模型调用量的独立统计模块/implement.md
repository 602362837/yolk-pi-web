# Implement：分阶段实施计划

> 本计划需在 UI Designer HTML 原型及用户审批后才可整体进入实现。SPIKE-01 是技术门禁，不应以生产 monkey patch 替代。

## 需先阅读

- 项目规范：`AGENTS.md`、`docs/architecture/overview.md`、`docs/modules/api.md`、`docs/modules/frontend.md`、`docs/modules/library.md`、`docs/standards/code-style.md`。
- 当前实现：`lib/usage-stats.ts`、`app/api/usage/route.ts`、`components/UsageStatsModal.tsx`、`hooks/useAgentSession.ts`、`components/SessionStatsChips.tsx`。
- 调用入口：`lib/rpc-manager.ts`、`lib/ypi-studio-child-session-runner.ts`、`lib/ypi-studio-extension.ts`、`lib/openai-codex-warmup.ts`、三个 direct completion routes。
- SDK：installed `pi-coding-agent/docs/sdk.md`、`docs/session-format.md`、pi-ai README/types，以及实际锁定版本源码中 compaction/branch persistence。

## 人类可读子任务表

| ID | Phase | 依赖 | 内容 | 难度/并行 |
| --- | --- | --- | --- | --- |
| SPIKE-01 | 0 | 无 | 验证 SDK 是否有稳定 completion observer，覆盖 normal/compaction/branch；形成 go/no-go | 高；不可跳过 |
| UI-00 | 0 | 无 | UI Designer HTML 原型与用户审批 | 中；可与 spike 并行 |
| CORE-01 | 1 | SPIKE-01 | schema、normalizer、原子事件 store、隐私边界、retry diagnostics | 高 |
| QUERY-01 | 1 | CORE-01 | 日期分区查询、聚合、coverage/cache | 中 |
| CAPTURE-01 | 2 | CORE-01,SPIKE-01 | AgentSession 主 Chat/Studio SDK normal+hidden capture | 高 |
| CAPTURE-02 | 2 | CORE-01 | direct routes、warmup、Studio CLI capture | 高；可与 CAPTURE-01 并行 |
| MIGRATE-01 | 2 | CORE-01 | session JSONL 历史幂等 backfill/checkpoint | 中；可并行 |
| API-01 | 3 | QUERY-01,CAPTURE-01,CAPTURE-02,MIGRATE-01 | 新 API、compare、兼容与 rollout | 中 |
| UI-01 | 4 | UI-00,API-01 | 按已批原型实现 Provider/Model 页面与全部状态 | 中高 |
| DOC-CHECK-01 | 5 | API-01,UI-01 | 文档、全套测试、人工验收、回滚演练 | 中 |

## 关键实施顺序

1. **先 spike，不先写 recorder**：确认可支持的 SDK 边界。若只能改私有 `_handle*`，停止并让主会话决定 SDK 升级/上游 hook/接受缺口。
2. **建立 leaf-level schema/store**：禁止依赖 session-reader 或 UI 类型；先完成原子写、幂等、损坏隔离、隐私测试。
3. **先 shadow capture**：不切页面、不改变旧 API。对 direct 与 session 共同覆盖部分做对账。
4. **再 backfill**：确定性 entry eventId，允许中断/重跑；coverage 标明不可恢复来源。
5. **新版本化 API**：新 route 只读 ledger；legacy route/topbar 不变。
6. **最后 UI 切换**：必须严格依据已批准 HTML；保留服务端/客户端回退开关至少一个发布周期。

## 计划改动点

### 新模块（建议）

- `lib/llm-usage-types.ts`：schema、wire types、source/status unions。
- `lib/llm-usage-normalize.ts`：SDK AssistantMessage → allowlisted event；finite/nonnegative validation。
- `lib/llm-usage-store.ts`：目录、原子 write-once、读取、坏文件隔离、bounded retry diagnostics。
- `lib/llm-usage-recorder.ts`：call lifecycle、终态 once、workspace hash、source helpers。
- `lib/llm-usage-query.ts`：filter/aggregate/coverage/single-flight cache。
- `lib/llm-usage-backfill.ts`：session assistant entry → deterministic event。
- `app/api/usage/calls/route.ts`：版本化 query API。
- `scripts/test-llm-usage-*.mjs`：store/capture/backfill/API fixture tests。

### 修改入口

- `lib/rpc-manager.ts`：通过 SPIKE-01 批准的公开方案安装 recorder；保持 wrapper 生命周期不变。
- `lib/ypi-studio-child-session-runner.ts`：同一 recorder + source/scope；不要同时从 progress token 估算 usage。
- `lib/ypi-studio-extension.ts`：CLI JSON final/message_end 中读取标准 usage；runId+ordinal 确定性去重；CLI fallback 也记录。
- `app/api/terminal/env/assist/route.ts`、`app/api/trellis/workflow/assist/route.ts`、`app/api/models-config/test/route.ts`、`lib/openai-codex-warmup.ts`：使用统一 `recordFinalAssistantUsage` wrapper，每个 candidate attempt 独立 callId。
- `lib/pi-web-config.ts`：只添加 additive rollout 默认；旧配置兼容。
- `components/UsageStatsModal.tsx`/`app/globals.css`：按原型实现；必要时拆分 `UsageProviderModelTable`，避免继续扩大单文件。
- `lib/usage-stats.ts`：保留 session rollup；全局 legacy facade 仅在切换阶段做适配，不把 ledger 逻辑重新塞回该文件。

## 评审门禁

- Gate A：SPIKE-01 go，且没有未文档化私有 monkey patch。
- Gate B：UI Designer HTML 原型和用户审批已记录。
- Gate C：store/capture/backfill tests 先通过，再接页面。
- Gate D：dual-read 对共同 session 样本 token/cost/calls 对账通过；差异有可解释 diagnostics。
- Gate E：checker 检查隐私字段、失败不阻断主业务、旧 topbar 与 archive 行为。

## 回滚

- 配置/常量把 Usage modal 数据源切回 legacy `/api/usage`。
- 停止 recorder，不删除 `usage-events/v1`；旧 route 与 topbar 独立可用。
- 新 API/页面可代码回滚；事件 schema v1 保持只读，以便后续恢复。
- 不对 session JSONL 做迁移，故无需数据逆迁移。

## Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "title": "独立 Provider/Model LLM Usage 分阶段实施",
  "maxConcurrency": 3,
  "subtasks": [
    {
      "id": "SPIKE-01",
      "title": "验证 SDK 全调用拦截与 usage 终态语义",
      "phase": "spike",
      "order": 10,
      "dependsOn": [],
      "files": [
        "node_modules/@earendil-works/pi-coding-agent/docs/sdk.md",
        "node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js",
        "node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/compaction.js",
        "node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/branch-summarization.js",
        "lib/rpc-manager.ts",
        "lib/ypi-studio-child-session-runner.ts"
      ],
      "instructions": [
        "用最小非生产 spike 验证 normal assistant turn、manual/auto compaction、branch summary 是否可通过公开且稳定的 SDK observer/decorator 获得 final AssistantMessage usage。",
        "验证 error/aborted、tool loop、outer retry 和 SDK internal maxRetries 的可见性边界。",
        "输出 go/no-go 与所需最低 SDK 版本；禁止把私有 _handle* monkey patch 当成完成方案。"
      ],
      "acceptance": [
        "形成可复现测试与明确拦截矩阵。",
        "所有未覆盖入口进入 knownGaps，且主会话确认是否阻塞。"
      ],
      "validation": [
        "运行 spike fixture，比较 observer 事件数与真实 completion 终态数。"
      ],
      "risks": [
        "SDK 0.80.6 可能没有公开全局 observer；此时需升级或上游补 hook。"
      ],
      "parallelizable": true,
      "localReview": "architect+checker"
    },
    {
      "id": "UI-00",
      "title": "交付并审批 Usage Provider/Model HTML 原型",
      "phase": "prototype",
      "order": 20,
      "dependsOn": [],
      "files": [
        ".ypi/tasks/20260713-150553-重构-usage-为基于提供商-模型调用量的独立统计模块/ui.md",
        ".ypi/tasks/20260713-150553-重构-usage-为基于提供商-模型调用量的独立统计模块/usage-provider-model-prototype.html",
        "components/UsageStatsModal.tsx",
        "app/globals.css"
      ],
      "instructions": [
        "UI Designer 基于现有 modal 交付任务内 HTML，覆盖 Provider/Model 主表、过滤、coverage 和全部状态。",
        "主会话展示原型并取得用户明确审批；将 revision 和审批记录写入 ui.md/plan-review.md。"
      ],
      "acceptance": [
        "存在可打开的 HTML 原型，不是纯 Markdown。",
        "用户审批记录明确且晚于原型 revision。"
      ],
      "validation": [
        "桌面与 <=640px 人工验收；键盘与状态覆盖检查。"
      ],
      "risks": [
        "未审批原型即实现会违反 Studio 硬门禁。"
      ],
      "parallelizable": true,
      "localReview": "user+ui-designer"
    },
    {
      "id": "CORE-01",
      "title": "实现 usage event schema、原子 store 与 recorder 基础",
      "phase": "core",
      "order": 30,
      "dependsOn": ["SPIKE-01"],
      "files": [
        "lib/llm-usage-types.ts",
        "lib/llm-usage-normalize.ts",
        "lib/llm-usage-store.ts",
        "lib/llm-usage-recorder.ts",
        "scripts/test-llm-usage-store.mjs"
      ],
      "instructions": [
        "实现 schema v1、allowlist normalization、UTC 日分区、一事件一文件 tmp+rename/write-once。",
        "实现 deterministic eventId、call final once、有限重试 diagnostics 和 workspace hash。",
        "不保存内容、responseId、accountId、凭据或绝对路径。"
      ],
      "acceptance": [
        "并发同 eventId 只落一条；坏文件不影响其他记录。",
        "reasoning 不重复计入 output，totalTokens 规则固定。"
      ],
      "validation": [
        "npm run test:llm-usage-store",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "多进程竞争、inode 增长、隐私字段泄漏。"
      ],
      "parallelizable": false,
      "localReview": "checker"
    },
    {
      "id": "QUERY-01",
      "title": "实现 ledger 查询、聚合与 coverage",
      "phase": "core",
      "order": 40,
      "dependsOn": ["CORE-01"],
      "files": [
        "lib/llm-usage-query.ts",
        "lib/llm-usage-types.ts",
        "scripts/test-llm-usage-api.mjs"
      ],
      "instructions": [
        "按日期分区、固定并发与大小上限查询，聚合 day/provider/model/source/status。",
        "实现 coverage/backfill/knownGaps/corrupt/skipped 与短 TTL single-flight cache。"
      ],
      "acceptance": [
        "查询不依赖 session-reader；unknown 与 partial 状态不丢。",
        "最大日期跨度和 filter validation 可测试。"
      ],
      "validation": [
        "npm run test:llm-usage-api"
      ],
      "risks": [
        "长范围扫描性能与 timezone 边界。"
      ],
      "parallelizable": true,
      "localReview": "checker"
    },
    {
      "id": "CAPTURE-01",
      "title": "接入主 Chat 与 Studio SDK AgentSession 调用",
      "phase": "capture",
      "order": 50,
      "dependsOn": ["CORE-01", "SPIKE-01"],
      "files": [
        "lib/rpc-manager.ts",
        "lib/ypi-studio-child-session-runner.ts",
        "lib/llm-usage-recorder.ts",
        "scripts/test-llm-usage-capture.mjs"
      ],
      "instructions": [
        "只使用 SPIKE-01 批准的稳定 SDK 接口覆盖 normal/tool-loop/compaction/branch。",
        "主 Chat、ypic、Studio SDK 设置准确 source/scope；不得使用 progress 字符估算 usage。",
        "处理 dispose/abort/retry，终态只记录一次。"
      ],
      "acceptance": [
        "每个可观测 completion 与一条 ledger event 对应。",
        "AgentSession 生命周期、single-wrapper 和 child session invariant 不变。"
      ],
      "validation": [
        "npm run test:llm-usage-capture",
        "npm run test:studio-sdk-runner",
        "npm run test:usage-rollup"
      ],
      "risks": [
        "监听顺序双计、SDK 升级脆弱、compaction 隐式调用漏记。"
      ],
      "parallelizable": true,
      "localReview": "checker"
    },
    {
      "id": "CAPTURE-02",
      "title": "接入 direct completion、warmup 与 Studio CLI",
      "phase": "capture",
      "order": 60,
      "dependsOn": ["CORE-01"],
      "files": [
        "app/api/terminal/env/assist/route.ts",
        "app/api/trellis/workflow/assist/route.ts",
        "app/api/models-config/test/route.ts",
        "lib/openai-codex-warmup.ts",
        "lib/ypi-studio-extension.ts",
        "lib/llm-usage-recorder.ts",
        "scripts/test-llm-usage-capture.mjs"
      ],
      "instructions": [
        "每个 candidate/fallback completion 在发起前创建 callId，在 final message 后记录。",
        "解析 CLI JSON 的标准 assistant usage，以 runId+ordinal 去重；记录 SDK->CLI fallback 的实际调用。",
        "失败/aborted/0 usage 仍记录 calls，不能改变现有业务返回。"
      ],
      "acceptance": [
        "所有仓库 direct call entrypoint 均通过共享 recorder。",
        "fallback 两次调用生成两条事件且 source/model 正确。"
      ],
      "validation": [
        "npm run test:llm-usage-capture",
        "npm run test:studio-sdk-runner"
      ],
      "risks": [
        "catch 分支吞掉 final message、CLI event shape 版本差异。"
      ],
      "parallelizable": true,
      "localReview": "checker"
    },
    {
      "id": "MIGRATE-01",
      "title": "实现 session assistant usage 历史幂等 backfill",
      "phase": "migration",
      "order": 70,
      "dependsOn": ["CORE-01"],
      "files": [
        "lib/llm-usage-backfill.ts",
        "lib/session-reader.ts",
        "scripts/test-llm-usage-backfill.mjs"
      ],
      "instructions": [
        "使用 lightweight inventory 定位 active/archive session，再读取 assistant usage。",
        "eventId 固定为 sessionId+entryId hash；可中断重跑；coverage checkpoint 原子更新。",
        "不修改 JSONL；标明 historical direct/CLI/compaction 不可恢复。"
      ],
      "acceptance": [
        "重复 backfill totals 不变；坏 session 单独跳过。",
        "Studio child/provider/model/timestamp 正确，未知值不丢。"
      ],
      "validation": [
        "npm run test:llm-usage-backfill",
        "npm run test:session-metadata"
      ],
      "risks": [
        "全量扫描耗时、live/backfill 双计、archive 范围误解。"
      ],
      "parallelizable": true,
      "localReview": "checker"
    },
    {
      "id": "API-01",
      "title": "新增版本化 calls API 与双读兼容",
      "phase": "api",
      "order": 80,
      "dependsOn": ["QUERY-01", "CAPTURE-01", "CAPTURE-02", "MIGRATE-01"],
      "files": [
        "app/api/usage/calls/route.ts",
        "app/api/usage/route.ts",
        "lib/pi-web-config.ts",
        "docs/modules/api.md",
        "docs/modules/library.md",
        "docs/architecture/overview.md"
      ],
      "instructions": [
        "实现 kind/schemaVersion/filter/range/coverage 契约与安全错误。",
        "旧 sessionId rollup 完全保留；global legacy 在 rollout 期间可 compare/fallback。",
        "配置字段 additive，旧 pi-web.json 默认安全。"
      ],
      "acceptance": [
        "旧调用方无类型/行为回归；新 route 不扫描 sessions。",
        "共同 session 样本 dual-read 对账通过或有 diagnostics。"
      ],
      "validation": [
        "npm run test:llm-usage-api",
        "npm run test:usage-rollup",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "API 口径混淆、配置保存破坏旧字段。"
      ],
      "parallelizable": false,
      "localReview": "checker"
    },
    {
      "id": "UI-01",
      "title": "按已审批原型实现 Provider/Model Usage 页面",
      "phase": "ui",
      "order": 90,
      "dependsOn": ["UI-00", "API-01"],
      "files": [
        "components/UsageStatsModal.tsx",
        "components/UsageProviderModelTable.tsx",
        "app/globals.css",
        "docs/modules/frontend.md"
      ],
      "instructions": [
        "严格按获批 HTML 实现 Provider->Model 主表、filter、coverage 与全部状态。",
        "首期不改 SessionStatsChips 的 session rollup/context 语义。",
        "保留 legacy 数据源回退并明确口径差异。"
      ],
      "acceptance": [
        "桌面/移动/键盘/错误/partial/backfilling 状态符合原型。",
        "coverage 不会被空状态或窄屏隐藏。"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "按 ui.md 做人工浏览器验收"
      ],
      "risks": [
        "页面实现偏离原型、表格窄屏不可用、把 coverage gap 显示为零。"
      ],
      "parallelizable": false,
      "localReview": "ui-designer+checker"
    },
    {
      "id": "DOC-CHECK-01",
      "title": "完成文档、全量验证与回滚演练",
      "phase": "checks",
      "order": 100,
      "dependsOn": ["API-01", "UI-01"],
      "files": [
        "docs/architecture/overview.md",
        "docs/modules/api.md",
        "docs/modules/frontend.md",
        "docs/modules/library.md",
        "docs/operations/troubleshooting.md",
        "package.json",
        ".ypi/tasks/20260713-150553-重构-usage-为基于提供商-模型调用量的独立统计模块/checks.md"
      ],
      "instructions": [
        "更新数据路径、coverage、迁移、隐私、故障与回滚文档。",
        "执行所有 usage 新旧测试、lint、typecheck 与 UI 人工验收。",
        "演练关闭 recorder/切回 legacy，确认旧 topbar/API 可用。"
      ],
      "acceptance": [
        "checks.md 无阻断项；回滚无需删除或逆迁移 ledger。",
        "所有文档与实际 route/config/source 清单一致。"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "npm run test:usage-rollup",
        "npm run test:llm-usage-store",
        "npm run test:llm-usage-capture",
        "npm run test:llm-usage-backfill",
        "npm run test:llm-usage-api"
      ],
      "risks": [
        "只验证 happy path，遗漏多进程/损坏/partial coverage。"
      ],
      "parallelizable": false,
      "localReview": "checker"
    }
  ],
  "execution": {
    "groups": [
      { "id": "G0", "title": "门禁", "subtaskIds": ["SPIKE-01", "UI-00"], "mode": "parallel" },
      { "id": "G1", "title": "核心", "subtaskIds": ["CORE-01"], "mode": "serial" },
      { "id": "G2", "title": "采集与迁移", "subtaskIds": ["QUERY-01", "CAPTURE-01", "CAPTURE-02", "MIGRATE-01"], "mode": "parallel" },
      { "id": "G3", "title": "API 与 UI", "subtaskIds": ["API-01", "UI-01"], "mode": "serial" },
      { "id": "G4", "title": "检查", "subtaskIds": ["DOC-CHECK-01"], "mode": "serial" }
    ]
  }
}
```
