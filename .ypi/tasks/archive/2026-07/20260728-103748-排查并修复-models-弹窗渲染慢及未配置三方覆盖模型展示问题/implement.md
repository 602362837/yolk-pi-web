# Implement — Models 弹窗性能、覆盖项过滤与竞态收敛

## 实现前必须阅读

1. `AGENTS.md`
2. `docs/modules/frontend.md`
3. `docs/modules/api.md`
4. `docs/modules/library.md`
5. `docs/integrations/README.md`（Web ModelRuntime / OAuth / fixed providers）
6. `docs/standards/code-style.md`
7. `components/ModelsConfig.tsx`（ModelsConfig、OAuthDetail、ApiKeyAccountsDetail、ApiKeyDetail）
8. `app/api/auth/providers/route.ts`、`app/api/auth/all-providers/route.ts`
9. OAuth mutation routes：login/logout/accounts/activate
10. `lib/web-model-runtime.ts`
11. `lib/oauth-accounts.ts` 中 bootstrap/list/read Active 与 mutation锁语义
12. `scripts/test-web-model-runtime.mjs`、Grok/Kiro/Antigravity race/account/provider suites

## 人类可读子任务表

| ID | 阶段 | 顺序 | 依赖 | 内容 | 可并行 |
| --- | --- | ---: | --- | --- | --- |
| MOP-01 | domain | 1 | — | override-only可见性纯函数与测试 | 是 |
| MOP-02 | runtime | 1 | — | 管理runtime init/offline-refresh single-flight | 是 |
| MOP-03 | api | 2 | MOP-02 | local summary、revision-aware background verify、服务端cache/flight与聚合优化 | 与MOP-01并行 |
| MOP-04 | frontend | 3 | MOP-01, MOP-03 | Models分lane渐进加载、active/generation/abort、详情账号竞态与过滤 | 否 |
| MOP-05 | docs-checks | 4 | MOP-01..04 | 文档、race matrix、性能与跨provider回归 | 否 |

## 详细执行步骤

### MOP-01 — 可见性投影

- 新建 `lib/models-config-visibility.ts`，保持纯函数/unknown边界。
- 仅 keys 恰好为 `modelOverrides` 的 object 判为 override-only；未知字段 fail-visible。
- 不把过滤结果回写 config。
- 新建 `scripts/test-models-config-visibility.mjs` 并加入 `test:models-config-visibility`。
- 覆盖纯覆盖、额外字段、models字段、畸形值、输入不变、隐藏数据仍保留在序列化对象。

### MOP-02 — 管理 runtime single-flight

- 在 `lib/web-model-runtime.ts` 增加 init pending 与 offline-refresh pending。
- 共享初始化固定 offline；同 key fixed provider只注册一次。
- Models所需同 key offline refresh合并一次；不得与后台 `checkAuth()`组成一个阻塞首屏的flight。
- 成功后写resolved cache；初始化/refresh失败均finally清对应pending并允许重试。
- reset helper清resolved/init pending/refresh pending。
- 扩展 `scripts/test-web-model-runtime.mjs`：同key 20并发、不同key隔离、初始化reject重试、refresh reject重试、reset、首caller network选项不污染初始化。
- 不触碰main Chat / Studio isolated runtime。

### MOP-03 — provider summary、verify与服务端竞态

- 新建 `lib/models-provider-auth-summary.ts`，集中：
  - metadata-first local summary；
  - 进程盐化不透明 `localStateRevision`；
  - provider mutation epoch/invalidate；
  - `runtimeKey + providerId + revision` verification cache/single-flight；
  - 单provider deadline、late-result non-publish规则与test reset。
- summary不得调用 `bootstrapOAuthActiveAccountCredential()`、`runtime.checkAuth()`或provider网络；legacy bootstrap留在default/verify或明确mutation路径。
- `/api/auth/providers?mode=summary` 返回local字段；`mode=verify`返回allowlisted verification；默认完整模式兼容。
- verify按provider all-settled；一个provider timeout不清空其他结果。HTTP仍`no-store`。
- shared verification flight不绑定单个HTTP AbortSignal；一个waiter断开不取消其他waiter。
- timeout后底层 `checkAuth()`晚到不得写cache或旧response；flight retention内不得叠加真实check。
- login/logout/OAuth accounts/activate成功后、response前调用invalidate；失败mutation不bump。
- `all-providers`一次统计modelCount、并行managed summary，保留AnyRouter synthetic entry。
- 新建 `scripts/test-models-provider-auth-summary.mjs` 与package script，优先用真实helper+fake runtime/deferred promise，不以源码字符串断言作为唯一证明。

### MOP-04 — 前端分lane生命周期与详情竞态

- config/catalog/detail各自独立generation、AbortController、load/error状态；顶层active cleanup。
- `refreshCatalog()`作为唯一catalog入口：OAuth summary + all-providers并行；summary提交后后台verify；Retry/mutation开启新generation。
- verify只按相同provider id + `localStateRevision` merge verification；保留local configured/count/active name/order，禁止whole-object覆盖。
- active row visibility使用local status/account count；verify invalid不删除恢复入口，verify timeout/error保留local状态。
- config GET检查`res.ok`和payload；失败禁用Save且不写空providers。
- raw tree与selection fallback使用visible projection；late response不得重置用户selection；deep-link只在当前generation消费一次。
- OAuthDetail统一补齐Codex/Grok/Kiro/Antigravity accounts/quota generation + providerId/accountId guards；mutation前invalidate读generation，POST response优先。
- ApiKeyAccountsDetail/ApiKeyDetail的accounts/config/reveal请求补provider generation；close/switch立即清plaintext。
- EventSource捕获providerId/loginGeneration；close/provider switch后忽略晚到message/error。
- unmount按active=false→generation++→abort/clear timer/close EventSource清理；写请求不自动重放或假装回滚。
- 新建 `scripts/test-models-config-races.mjs`，用可控deferred请求覆盖乱序、abort失效、close/reopen、mutation-vs-GET、provider/account switch。
- 按现有HTML原型实现紧凑loading/error；不加入黄色常驻卡片。

### MOP-05 — 文档、性能与回归

- 更新frontend/api/library/integration/architecture docs：local vs verified字段所有权、server cache/flight、runtime single-flight、abort非正确性保证。
- 执行focused/race/provider suites；临时`PI_CODING_AGENT_DIR`，不改真实配置。
- 记录config/summary/verify/all-providers cold + warm各5次；browser记录shell/config tree首帧。
- 人工制造慢/乱序/timeout响应，验证旧结果无法覆盖。
- 证明回滚不需要数据迁移。

## Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "title": "Models 弹窗渐进加载、覆盖项过滤与竞态收敛",
  "strategy": "先建立纯可见性与admin runtime并发基础，再实现本地summary→后台revision-aware verify，最后用统一lifecycle/generation/abort模型接入Models及详情并完成乱序与provider回归。",
  "subtasks": [
    {
      "id": "MOP-01",
      "title": "实现override-only provider可见性投影",
      "phase": "domain",
      "order": 1,
      "dependsOn": [],
      "files": [
        "lib/models-config-visibility.ts",
        "scripts/test-models-config-visibility.mjs",
        "package.json"
      ],
      "instructions": [
        "实现unknown-safe的isOverrideOnlyProviderEntry与visibleModelsConfigProviders。",
        "仅当own keys恰好为modelOverrides且其值为非数组对象时隐藏；任何额外/未知字段均显示。",
        "过滤只生成展示投影，不修改输入或序列化数据。"
      ],
      "acceptance": [
        "纯modelOverrides provider被过滤。",
        "models/baseUrl/api/未知字段或畸形对象不会被误隐藏。",
        "hidden provider在原config JSON中完整保留。"
      ],
      "validation": [
        "npm run test:models-config-visibility",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "误隐藏未来provider字段",
        "过滤逻辑意外参与保存"
      ],
      "parallelizable": true,
      "localReview": {
        "required": true,
        "focus": ["fail-visible边界", "输入不可变", "空modelOverrides口径"]
      }
    },
    {
      "id": "MOP-02",
      "title": "为管理ModelRuntime增加init与offline-refresh single-flight",
      "phase": "runtime",
      "order": 1,
      "dependsOn": [],
      "files": [
        "lib/web-model-runtime.ts",
        "scripts/test-web-model-runtime.mjs"
      ],
      "instructions": [
        "增加adminRuntimePending与adminRuntimeRefreshPending，合并同agentDir+modelsPath冷并发初始化及offline refresh。",
        "共享初始化固定offline；后台checkAuth不进入该flight，不得阻塞首屏summary。",
        "成功写resolved cache；reject/finally清pending并允许重试；reset清全部cache。"
      ],
      "acceptance": [
        "同key 20并发只创建/注册一次runtime且offline refresh最多一次。",
        "不同key隔离。",
        "init/refresh首次reject后均可成功重试。",
        "首caller网络选项不污染共享初始化，Chat/Studio隔离不变。"
      ],
      "validation": [
        "npm run test:web-model-runtime",
        "npm run test:kiro-cold-auth",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "pending未清导致永久失败",
        "network选项污染首屏",
        "refresh flight与verification flight循环等待"
      ],
      "parallelizable": true,
      "localReview": {
        "required": true,
        "focus": ["init/refresh时序", "reject/finally", "cache key隔离", "offline不等checkAuth"]
      }
    },
    {
      "id": "MOP-03",
      "title": "实现本地OAuth summary、revision-aware verify与服务端去重",
      "phase": "api",
      "order": 2,
      "dependsOn": ["MOP-02"],
      "files": [
        "lib/models-provider-auth-summary.ts",
        "app/api/auth/providers/route.ts",
        "app/api/auth/all-providers/route.ts",
        "app/api/auth/login/[provider]/route.ts",
        "app/api/auth/logout/[provider]/route.ts",
        "app/api/auth/accounts/[provider]/route.ts",
        "app/api/auth/accounts/[provider]/activate/route.ts",
        "scripts/test-models-provider-auth-summary.mjs",
        "package.json"
      ],
      "instructions": [
        "summary只读本地metadata/runtime stored状态，零checkAuth/零legacy bootstrap/零provider网络。",
        "生成安全opaque localStateRevision；成功auth/account mutation bump epoch并invalidate。",
        "verify按runtimeKey+provider+revision短TTL cache和single-flight，8s deadline，late result non-publish；一个HTTP abort不取消shared owner。",
        "默认providers route保留完整语义；verify输出allowlisted state且不泄露raw error。",
        "all-providers一次modelCount并行managed enrichment，保留AnyRouter recoverable entry。"
      ],
      "acceptance": [
        "summary无checkAuth/网络/write并快速返回localConfigured/account metadata。",
        "同provider+revision并发只执行一次checkAuth，短TTL重复打开不新增check。",
        "revision变化/mutation invalidation后旧verify为superseded且不能命中新state。",
        "timeout后晚到completion不写cache；失败provider不清空其他provider。",
        "payload无secret/path/raw error，默认route与AnyRouter兼容。"
      ],
      "validation": [
        "npm run test:models-provider-auth-summary",
        "npm run test:web-model-runtime",
        "npm run test:oauth-accounts",
        "npm run test:grok-provider",
        "npm run test:kiro-provider",
        "npm run test:antigravity-provider",
        "npm run test:anyrouter-api-routes"
      ],
      "risks": [
        "local revision无法识别mutation",
        "shared flight被单waiter abort",
        "timeout底层仍settle并污染cache",
        "legacy bootstrap或checkAuth误入summary"
      ],
      "parallelizable": true,
      "localReview": {
        "required": true,
        "focus": ["字段所有权", "state-key与invalidation", "deadline/late settle", "secret allowlist", "默认wire兼容"]
      }
    },
    {
      "id": "MOP-04",
      "title": "接入Models分lane加载与provider/account竞态保护",
      "phase": "frontend",
      "order": 3,
      "dependsOn": ["MOP-01", "MOP-03"],
      "files": [
        "components/ModelsConfig.tsx",
        "app/globals.css",
        "scripts/test-models-config-races.mjs",
        "scripts/test-kiro-models-ui.mjs",
        "scripts/test-antigravity-models-ui.mjs",
        "scripts/test-grok-global-auth.mjs",
        "package.json"
      ],
      "instructions": [
        "拆分config/catalog/verification/detail state并实施active+generation+AbortController门禁。",
        "summary成功后后台verify；仅same provider+localStateRevision merge verification，不覆盖local counts/Active/order/selection。",
        "Retry、provider/account mutation、切换、close/reopen使旧generation失效；旧GET不能覆盖POST response。",
        "Codex/Grok/Kiro/Antigravity quota、accounts、API-key detail/reveal和login SSE统一provider/account guard。",
        "config GET失败禁用Save；raw tree/selection使用visible projection；按原型显示紧凑loading/error。"
      ],
      "acceptance": [
        "modal立即显示，config先到先可用，verify慢/失败不阻塞。",
        "S1慢/S2快、close/reopen、provider A→B、account A→B、GET→mutation所有晚到结果均丢弃。",
        "verify invalid保留本地已配置row与恢复入口；verify不导致selection跳动。",
        "override-only项隐藏且保存不丢；config GET失败不能PUT空providers。",
        "plaintext reveal与EventSource在switch/close后不能写入新实例。"
      ],
      "validation": [
        "npm run test:models-config-races",
        "npm run test:models-config-visibility",
        "npm run test:kiro-models-ui",
        "npm run test:antigravity-models-ui",
        "npm run test:grok-global-auth",
        "npm run test:models-config-sync",
        "npm run lint",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "只abort未guard commit",
        "mutation前旧GET覆盖新state",
        "selection/deep-link race",
        "关闭后write误以为回滚",
        "敏感reveal晚到"
      ],
      "parallelizable": false,
      "localReview": {
        "required": true,
        "focus": ["lane隔离", "merge字段所有权", "provider/account identity", "unmount cleanup", "save安全", "a11y"]
      }
    },
    {
      "id": "MOP-05",
      "title": "更新文档并完成乱序、性能与跨provider回归",
      "phase": "checks",
      "order": 4,
      "dependsOn": ["MOP-01", "MOP-02", "MOP-03", "MOP-04"],
      "files": [
        "docs/modules/frontend.md",
        "docs/modules/api.md",
        "docs/modules/library.md",
        "docs/architecture/overview.md",
        "docs/integrations/README.md"
      ],
      "instructions": [
        "记录local/verified字段所有权、request generation、server verification cache/flight与admin runtime single-flight。",
        "用deferred/timeout测试全部race matrix，并跑provider suites。",
        "使用临时PI_CODING_AGENT_DIR记录cold/warm各5次endpoint与浏览器首帧。",
        "验证回滚无需数据迁移且不依赖真实用户credential。"
      ],
      "acceptance": [
        "lint、tsc、focused/race/provider suites通过。",
        "summary零网络、same-state verify一次、late response零覆盖。",
        "性能基准和browser首帧有记录。",
        "文档与实现一致，HTML原型仍有效。"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "npm run test:models-config-races",
        "npm run test:models-provider-auth-summary",
        "npm run test:web-model-runtime",
        "npm run test:oauth-accounts",
        "npm run test:grok-all",
        "npm run test:kiro-accounts",
        "npm run test:antigravity-accounts",
        "npm run test:anyrouter-provider",
        "npm run test:api-key-accounts",
        "npm run test:models-config-sync"
      ],
      "risks": [
        "source-string测试替代行为测试",
        "只测warm遗漏cold/late settle",
        "真实agent目录污染",
        "网络/I-O波动误导绝对耗时"
      ],
      "parallelizable": false,
      "localReview": {
        "required": true,
        "focus": ["race matrix逐项证据", "cold/warm数据", "临时目录隔离", "文档完整性"]
      }
    }
  ],
  "execution": {
    "groups": [
      { "id": "G1", "mode": "parallel", "subtaskIds": ["MOP-01", "MOP-02"] },
      { "id": "G2", "mode": "serial", "subtaskIds": ["MOP-03"] },
      { "id": "G3", "mode": "serial", "subtaskIds": ["MOP-04"] },
      { "id": "G4", "mode": "serial", "subtaskIds": ["MOP-05"] }
    ],
    "maxConcurrency": 2
  },
  "approvalGate": {
    "required": true,
    "reason": "UI信息结构、local-vs-verified认证语义与竞态合并契约均发生变化；方向已确认，但仍需主会话记录HTML原型和完整计划正式审批。"
  },
  "rollback": [
    "先关闭前端background verify，保留local summary可作为竞态止血。",
    "撤回过滤与summary URL可恢复旧投影；additive API可独立保留。",
    "verification single-flight与runtime single-flight均无持久数据，可独立回滚。",
    "不得删除或迁移models.json、auth.json或account slots。"
  ]
}
```

## 验证命令

```bash
npm run test:models-config-visibility
npm run test:web-model-runtime
npm run test:models-provider-auth-summary
npm run test:models-config-races
npm run test:oauth-accounts
npm run test:grok-all
npm run test:kiro-provider
npm run test:kiro-accounts
npm run test:antigravity-provider
npm run test:antigravity-accounts
npm run test:anyrouter-provider
npm run test:anyrouter-api-routes
npm run test:api-key-accounts
npm run test:models-config-sync
npm run lint
node_modules/.bin/tsc --noEmit
```

## 实现/评审门禁

- 主会话已记录 [models-popup-prototype.html](./models-popup-prototype.html) 与完整计划审批。
- implementationPlan已由主会话保存；本规划文档本身不代表可以开始实现。
- checker必须重点证明：
  1. summary零network/checkAuth；
  2. same-state verification single-flight + timeout late-result不发布；
  3. mutation前GET、provider/account切换、close/reopen的晚到response全部被拒；
  4. hidden overrides保存不丢；
  5. config GET失败Save disabled。
- 所有数据场景使用临时`PI_CODING_AGENT_DIR`，不得改真实`~/.pi/agent`。
