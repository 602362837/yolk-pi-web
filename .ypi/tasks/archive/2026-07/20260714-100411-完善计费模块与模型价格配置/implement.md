# Implement

## 前置门禁

- 用户确认 [plan-review.md](plan-review.md) 中五项产品/技术决策。
- `ui-designer` 提交 HTML 原型并记录用户批准。
- 先做 explicit-free schema 与 JSONC 保真 spike；失败时回到架构评审，不得猜测存储方案。

## 优先阅读

1. `AGENTS.md`、`docs/standards/code-style.md`。
2. `docs/architecture/overview.md` Usage accounting；`docs/modules/{frontend,api,library}.md`。
3. `lib/llm-usage-{types,normalize,query,recorder,store}.ts`、`lib/usage-stats.ts`。
4. `UsageStatsModal.tsx`、`UsageProviderModelTable.tsx`、`SessionStatsChips.tsx`、`MessageView.tsx`、`hooks/useAgentSession.ts`。
5. `ModelsConfig.tsx`、`SettingsConfig.tsx`、`app/api/models-config/route.ts`、`app/api/models/route.ts`、`lib/pi-web-config.ts`。
6. Pi `docs/models.md`、`docs/providers.md` 与 ModelRegistry 类型。

## 人类可读子任务表

| ID | 阶段 | 顺序 | 依赖 | 工作 | 本地评审 |
| --- | --- | ---: | --- | --- | --- |
| PRE-01 | preflight | 1 | - | 固化口径；验证 JSONC merge、explicit-free schema、resolved registry cost/source | architect |
| UI-01 | design | 2 | PRE-01 | ui-designer HTML 原型、可访问性/窄屏状态、用户批准 | ui-designer + user |
| USG-01 | backend | 3 | PRE-01 | 停止 cache-write normalizing/legacy aggregation，保持 v1 shape 与历史 immutable | implementer |
| USG-02 | frontend | 4 | UI-01, USG-01 | 移除 cache-write 展示，落共享 exact/M formatter | implementer |
| PRC-01 | backend | 3 | PRE-01 | model-price 类型与 models.json 安全 merge/revision/resolved projection | implementer |
| PRC-02 | backend | 4 | PRC-01 | GET/PATCH model-prices API 与安全测试 | implementer |
| AI-01 | backend | 5 | PRC-01 | allowlist 来源适配器、AI 结构化建议、suggest API、失败兜底 | implementer |
| UI-02 | frontend | 6 | UI-01, PRC-02, AI-01 | 模型价格 Settings 页面、手填/建议/确认/冲突流程 | implementer |
| DOC-01 | docs | 7 | USG-02, UI-02 | 更新 architecture/module/integration/operations 文档 | implementer |
| CHK-01 | checks | 8 | DOC-01 | lint、tsc、focused tests、API/浏览器人工验收 | checker |

## Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "maxConcurrency": 2,
  "subtasks": [
    {
      "id": "PRE-01",
      "title": "冻结计费口径并完成存储可行性验证",
      "phase": "preflight",
      "order": 1,
      "dependsOn": [],
      "files": [
        "lib/llm-usage-types.ts",
        "lib/pi-web-config.ts",
        "app/api/models-config/route.ts",
        "/Volumes/01/ExternalStorage/Projects/gitProjects/pi-agnet-web/node_modules/@earendil-works/pi-coding-agent/docs/models.md"
      ],
      "instructions": "根据用户批准记录冻结 cacheWrite 历史 API 与 totalTokens 口径。用隔离 fixture 验证 Pi models.json 对未知 metadata 的 schema 行为、modelOverrides/custom model cost 生效规则，以及 JSONC 注释/尾逗号的保真 merge 方案。只产出结论和测试，不先做页面。",
      "acceptance": [
        "五项未决问题均有明确批准记录",
        "explicit-free 有经验证且不破坏 Pi schema 的存储位置",
        "JSONC 读取/写入不会静默丢失无关字段；注释策略被批准",
        "内置、扩展、自定义三类模型价格写入路径均由 fresh ModelRegistry 验证"
      ],
      "validation": [
        "运行隔离临时 agentDir fixture",
        "比较写前写后语义与无关字段",
        "读取 fresh ModelRegistry resolved cost"
      ],
      "risks": [
        "Pi schema 拒绝未知 metadata",
        "JSONC serializer 丢失注释",
        "extension model override 生命周期不同"
      ],
      "parallelizable": false,
      "localReview": "architect"
    },
    {
      "id": "UI-01",
      "title": "完成模型价格与 Usage 展示 HTML 原型审批",
      "phase": "design",
      "order": 2,
      "dependsOn": ["PRE-01"],
      "files": [
        ".ypi/tasks/20260714-100411-完善计费模块与模型价格配置/ui.md",
        ".ypi/tasks/20260714-100411-完善计费模块与模型价格配置/model-prices-prototype.html"
      ],
      "instructions": "由 ui-designer 基于当前 Settings/Usage 视觉系统制作 HTML 原型，覆盖桌面/移动、缺价/免费、手填、智能候选/冲突/失败、diff、保存成功/409，以及 exact+M 和删除 Cache Write 后布局。提交用户审批并回填 ui.md。",
      "acceptance": [
        "存在可打开的 HTML 原型而非纯 Markdown",
        "所有关键状态和窄屏状态可交互预览",
        "ui.md 记录用户批准或明确修改意见"
      ],
      "validation": [
        "浏览器桌面与 390px 窄屏截图检查",
        "键盘 tab/escape/focus 检查",
        "用户显式审批记录"
      ],
      "risks": [
        "未批准原型导致实现返工",
        "密集表格在窄屏不可用"
      ],
      "parallelizable": false,
      "localReview": "ui-designer"
    },
    {
      "id": "USG-01",
      "title": "停止 cache-write 采集并保持账本兼容",
      "phase": "backend",
      "order": 3,
      "dependsOn": ["PRE-01"],
      "files": [
        "lib/llm-usage-types.ts",
        "lib/llm-usage-normalize.ts",
        "lib/llm-usage-query.ts",
        "lib/usage-stats.ts",
        "lib/types.ts",
        "lib/pi-types.ts"
      ],
      "instructions": "新事件不读取 cacheWrite/cacheWrite1h/cost.cacheWrite；根据批准口径让 v1 compatibility 字段归零或保留历史查询值。停止 legacy 聚合。保持事件文件 immutable、SDK totalTokens 与 cost.total 的批准语义，并给 coverage/API 添加口径说明。",
      "acceptance": [
        "新事件 cache-write 数据不再来自 SDK",
        "历史账本和 session 文件均不改写",
        "v1 调用方仍能解析数字兼容字段",
        "parent/child/archive rollup 不回归"
      ],
      "validation": [
        "新增 normalizer/query/legacy fixture tests",
        "检查含 cacheWrite 历史 fixture 的 API 输出",
        "检查 Studio parent/child rollup"
      ],
      "risks": [
        "可见分项和 SDK totalTokens 不相等",
        "旧客户端依赖 cacheWrite 的非零值"
      ],
      "parallelizable": true,
      "localReview": "implementer"
    },
    {
      "id": "USG-02",
      "title": "统一精确 token 与 M 展示并移除 Cache Write UI",
      "phase": "frontend",
      "order": 4,
      "dependsOn": ["UI-01", "USG-01"],
      "files": [
        "lib/token-format.ts",
        "components/UsageStatsModal.tsx",
        "components/UsageProviderModelTable.tsx",
        "components/SessionStatsChips.tsx",
        "components/MessageView.tsx",
        "components/ChatWindow.tsx",
        "hooks/useAgentSession.ts",
        "app/globals.css"
      ],
      "instructions": "实现共享 exact/M/compact formatter。删除所有 Cache Write 和 R/W 文案、列、tooltip 与本地 fallback 累加；Cache Read 独立显示。普通区域并列 exact + M，紧凑区域可用 M 但 tooltip 必须含 exact。",
      "acceptance": [
        "代码搜索无用户可见 Cache Write/Cache W/R-W 遗留",
        "1、999999、1000000、1234567 和大整数显示符合 PRD",
        "M 值不参与聚合或持久化",
        "缓存命中率公式保持正确"
      ],
      "validation": [
        "formatter unit tests",
        "Usage/顶栏/消息人工检查",
        "桌面和移动截图回归"
      ],
      "risks": [
        "紧凑顶栏溢出",
        "多个 formatter 造成舍入口径不一致"
      ],
      "parallelizable": false,
      "localReview": "implementer"
    },
    {
      "id": "PRC-01",
      "title": "建立模型价格读取与安全持久化服务",
      "phase": "backend",
      "order": 3,
      "dependsOn": ["PRE-01"],
      "files": [
        "lib/model-price-types.ts",
        "lib/model-price-config.ts",
        "lib/pi-web-config.ts"
      ],
      "instructions": "从 fresh ModelRegistry 生成脱敏 projection，区分 builtin/override/custom/free。实现有限非负价格校验、revision hash、builtin modelOverrides/custom models 定位、JSONC 安全最小 merge、原子 rename、权限与 reload 验证。保留 cost.cacheWrite、tiers 和所有无关配置。",
      "acceptance": [
        "价格列表不含 secret/path",
        "三类模型写入后 resolved cost 正确",
        "并发 revision 冲突不覆盖文件",
        "写失败保持原文件且无残留 tmp",
        "合法免费和缺价可区分"
      ],
      "validation": [
        "临时 agentDir fixture tests",
        "并发保存测试",
        "JSONC/tiers/headers 保留测试",
        "权限与原子失败测试"
      ],
      "risks": [
        "models.json 是用户文件且可能含命令/secret",
        "JSONC AST edit 复杂",
        "resolved source 识别错误"
      ],
      "parallelizable": true,
      "localReview": "implementer"
    },
    {
      "id": "PRC-02",
      "title": "实现模型价格查询与保存 API",
      "phase": "backend",
      "order": 4,
      "dependsOn": ["PRC-01"],
      "files": [
        "app/api/model-prices/route.ts",
        "lib/model-price-types.ts"
      ],
      "instructions": "实现 GET 与 revision-gated PATCH。cwd 仅用于 authorized ModelRegistry context；请求不接受路径。限制批次 50，返回结构化 400/409/422/500，错误脱敏，响应 no-store。",
      "acceptance": [
        "GET projection 完整且脱敏",
        "PATCH 只写批准字段并 fresh-read 返回 effective 值",
        "非法、未知、重复、stale 请求均不改文件",
        "API 不暴露绝对路径或完整 models.json"
      ],
      "validation": [
        "route contract tests",
        "secret redaction scan",
        "409/422 smoke tests"
      ],
      "risks": [
        "未授权 cwd 扩大读权限",
        "错误对象泄露本地路径"
      ],
      "parallelizable": false,
      "localReview": "implementer"
    },
    {
      "id": "AI-01",
      "title": "实现有来源的智能价格建议",
      "phase": "backend",
      "order": 5,
      "dependsOn": ["PRC-01"],
      "files": [
        "lib/model-price-sources.ts",
        "lib/model-price-assistant.ts",
        "lib/model-price-types.ts",
        "app/api/model-prices/suggest/route.ts",
        "lib/pi-web-config.ts",
        "app/api/web-config/route.ts"
      ],
      "instructions": "实现固定 HTTPS allowlist 来源适配器、重定向/MIME/大小/超时/并发限制、确定性 exact/alias 匹配。仅把 bounded evidence 交给 configured pricing assistant，以严格 JSON schema 解析；无证据禁止价格。返回引用、置信度、冲突和 partial failure，不写配置。",
      "acceptance": [
        "请求无法注入 URL/prompt/path",
        "每个非手工建议有可审计 evidence",
        "低置信度/路由不一致/tiers 冲突不自动选中",
        "AI/网络失败保留手填且不产生虚假 0",
        "日志和响应无凭据或完整远端正文"
      ],
      "validation": [
        "allowlist/redirect/timeout/oversize tests",
        "AI malformed/hallucinated JSON rejection tests",
        "partial/all-failed API tests",
        "single-flight/rate-limit smoke"
      ],
      "risks": [
        "官方页面结构变化",
        "同名模型在聚合商价格不同",
        "AI 把套餐价格误作 token 单价"
      ],
      "parallelizable": false,
      "localReview": "implementer"
    },
    {
      "id": "UI-02",
      "title": "实现模型价格设置页与确认流程",
      "phase": "frontend",
      "order": 6,
      "dependsOn": ["UI-01", "PRC-02", "AI-01"],
      "files": [
        "components/ModelPricesConfig.tsx",
        "components/SettingsConfig.tsx",
        "app/globals.css"
      ],
      "instructions": "严格按批准 HTML 原型实现 Settings 页面。提供搜索/状态筛选、手工抽屉、free 明示、智能建议状态机、逐字段 evidence/confidence、diff、显式确认、保存结果和 409 reload/合并。AI suggestion 与 PATCH 分离。",
      "acceptance": [
        "未确认建议永不调用 PATCH",
        "缺价与免费视觉/语义明确",
        "关闭/失败不改变配置",
        "409 不丢失用户草稿且引导 reload/重试",
        "键盘、焦点、移动端与 approved prototype 一致"
      ],
      "validation": [
        "浏览器完整手填与智能流程",
        "390px/桌面截图对比原型",
        "键盘与错误可访问性检查",
        "mock 409/partial/timeout 状态"
      ],
      "risks": [
        "复杂状态机误保存",
        "500 模型列表性能",
        "来源信息在移动端过密"
      ],
      "parallelizable": false,
      "localReview": "ui-designer"
    },
    {
      "id": "DOC-01",
      "title": "更新 Usage、价格和安全边界文档",
      "phase": "docs",
      "order": 7,
      "dependsOn": ["USG-02", "UI-02"],
      "files": [
        "docs/architecture/overview.md",
        "docs/modules/frontend.md",
        "docs/modules/api.md",
        "docs/modules/library.md",
        "docs/integrations/README.md",
        "docs/operations/troubleshooting.md",
        "AGENTS.md"
      ],
      "instructions": "记录 cacheWrite deprecated/归零口径、authoritative total、exact+M、models.json 唯一价格写源、API、安全来源、AI confirmation、JSONC/并发/回滚和排障。只有新增重大入口才更新 AGENTS 短索引。",
      "acceptance": [
        "新增/变更 route、component、lib 均有模块文档",
        "历史费用不重算和未来调用生效边界明确",
        "安全与失败兜底可供运维执行"
      ],
      "validation": [
        "rg 检查旧 Cache R/W 文档",
        "核对 route/type/file 名称",
        "检查 Markdown 链接"
      ],
      "risks": [
        "文档口径与最终批准决策不一致"
      ],
      "parallelizable": false,
      "localReview": "implementer"
    },
    {
      "id": "CHK-01",
      "title": "执行完整质量与回归检查",
      "phase": "checks",
      "order": 8,
      "dependsOn": ["DOC-01"],
      "files": [
        "checks.md",
        "review.md"
      ],
      "instructions": "checker 按 checks.md 执行 lint、tsc、focused tests、API 安全/兼容 fixture、浏览器桌面/移动验收。重点审计无自动保存、secret/path redaction、历史 immutable、parent/child rollup、JSONC 和并发冲突。",
      "acceptance": [
        "lint 与 typecheck 通过",
        "focused tests 通过",
        "HTML 原型批准记录存在且实现一致",
        "无 blocker/high finding；残余风险写入 review.md"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "npm run test:usage-accounting",
        "npm run test:model-prices",
        "人工浏览器/API 验收"
      ],
      "risks": [
        "只测新 ledger 而遗漏 legacy/session rollup",
        "测试 fixture 未覆盖用户 JSONC"
      ],
      "parallelizable": false,
      "localReview": "checker"
    }
  ],
  "execution": {
    "groups": [
      { "id": "g1", "subtaskIds": ["PRE-01"] },
      { "id": "g2", "subtaskIds": ["UI-01", "USG-01", "PRC-01"] },
      { "id": "g3", "subtaskIds": ["USG-02", "PRC-02"] },
      { "id": "g4", "subtaskIds": ["AI-01"] },
      { "id": "g5", "subtaskIds": ["UI-02"] },
      { "id": "g6", "subtaskIds": ["DOC-01"] },
      { "id": "g7", "subtaskIds": ["CHK-01"] }
    ]
  }
}
```

## 验证命令

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:usage-accounting
npm run test:model-prices
```

不要运行 `next build`；仅发布验证时使用 `npm run build`。

## 回滚

- UI/API：隐藏模型价格入口并停用 suggest；保留已写 models.json override，可通过相同 merge 服务恢复 diff 前值。
- Usage：恢复新事件 cache-write normalize/aggregate 即可；不回填兼容期产生的零值事件。
- 数据：不删除账本、不迁移 session；任何自动清理历史文件都不属于回滚。
- AI：关闭 pricing assistant/sources 后手填仍可独立工作。
