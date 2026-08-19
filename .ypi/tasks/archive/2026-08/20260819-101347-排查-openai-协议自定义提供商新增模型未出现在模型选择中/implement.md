# Implement — custom provider/model 配置可见性系统修复

> **Remediation revision:** MCR-01…06 已完成实现但 checker 判定 `Needs work`。本版保留原计划并新增 MCR-07…09，专门关闭 existing-session 行为证据与 sync `runtimeReload` 真值 blocker；不扩大产品/UI范围。

## 1. 执行原则

- 用户批准本次 remediation 计划前不继续改生产代码；
- 测试先覆盖新增 model、新增 provider、新会话共享 catalog、auth gate、semantic false-success；
- custom OpenAI provider 从 `models.json` composition 加载，不新增手工 provider registry；
- config 变化用 fresh runtime/`reloadConfig()`；auth-only 仍用 `refresh()`；
- admin/verification 离线，测试不访问真实 provider；
- 建议 `maxConcurrency=2`。

## 2. 优先阅读

| 顺序 | 文件 | 目的 |
| --- | --- | --- |
| 1 | `brief.md`, `prd.md`, `design.md`, `checks.md`, `plan-review.md` | 修订根因与验收 |
| 2 | `lib/web-model-runtime.ts`, `lib/model-catalog-service.ts` | admin runtime/cache/catalog |
| 3 | `app/api/models-config/route.ts`, `lib/models-config-store.ts` | direct candidate与 durable boundary |
| 4 | `lib/models-config-sync.ts`, `lib/model-price-config.ts` | 其他 writers与 verification |
| 5 | `lib/rpc-manager.ts`, `lib/pi-types.ts`, `lib/session-model-pin.ts` | live reload与 set_model |
| 6 | `hooks/useModelCatalog.ts`, `components/AppShell.tsx`, `components/ChatInput.tsx`, `components/ModelSelect.tsx` | 证明新会话/前端链路无需改 |
| 7 | Pi `docs/models.md`, `docs/custom-provider.md`, `docs/sdk.md` | custom provider/auth/public API语义 |
| 8 | Pi `dist/core/model-runtime.js`, `model-config.js`, `provider-composer.js` | 仅作 0.80.10 行为证据，不 deep import |
| 9 | model catalog/config/runtime focused scripts | 测试样板 |

## 3. 人类可读子任务表

| ID | Phase | 标题 | dependsOn | 并行 |
| --- | --- | --- | --- | --- |
| MCR-01 | test-first | 完整 custom provider/model 链路失败回归 | — | 先做 |
| MCR-02 | validation | direct PUT candidate 语义验证与安全错误 | MCR-01 | 可与 MCR-03 并行 |
| MCR-03 | runtime-catalog | admin config generation 与 catalog fail-closed | MCR-01 | 可与 MCR-02 并行 |
| MCR-04 | live-session | live reloadConfig、descriptor reconcile、set_model自愈 | MCR-01 | MCR-02/03后执行以控制并发 |
| MCR-05 | integration | 三类 writer统一 commit notification与 sync truth | MCR-02, MCR-03, MCR-04 | 串行 |
| MCR-06 | verify-docs | 全量验证、UAT、文档同步 | MCR-05 | 已完成，checker要求补证据 |
| MCR-07 | remediation-live-tests | Existing session / exact retry / side-effect 行为回归 | MCR-06 | 可与 MCR-08 并行 |
| MCR-08 | remediation-sync-truth | Sync commit coordinator import-failure 真值修复 | MCR-06 | 可与 MCR-07 并行 |
| MCR-09 | remediation-verify | Blocker复验、model-price证据与最终交接 | MCR-07, MCR-08 | 串行收尾 |

## 4. 实现要点

### MCR-01 — Test first

- Warm admin catalog：现有 provider追加 model，仅 production invalidate，修复前仍 stale；
- Warm admin catalog：新增完整 provider，fresh session runtime已有 provider/model/available，但 shared catalog仍缺失；
- SDK contract：`refresh` stale、`reloadConfig`/fresh runtime fresh；reload后 extension registration保留；
- Auth controls：no key/missing env loaded-but-unavailable，literal/stored key available；
- False-success：missing baseUrl direct PUT当前 200 + runtime error + catalog 200 missing；空 id导致 whole config被拒；
- Error catalog：runtime `getError` 应使 route非2xx并保留client last-good；
- 禁止使用 `__resetWebModelRuntimeCacheForTests()` 模拟生产修复。

### MCR-02 — Candidate verification

- 新增 server-only verifier，候选写入 private temp file；
- 使用 `createTemporaryWebModelRuntimeServices` fixed providers only，并确保 initial load `allowModelNetwork:false`；
- 检查 `runtime.getError()` 与 candidate exact model presence；不检查 available/auth；
- direct PUT 在写盘前验证 normalized candidate；失败返回固定422；
- 验证失败不写盘、不更新 revision/backup、不 invalidate/reload；
- catch 不返回 `String(error)` 等内部原文。

### MCR-03 — Runtime/catalog

- `web-model-runtime.ts` 增 production per-key config generation invalidation，与 test reset分离；
- 清匹配 resolved/init-pending/refresh-pending，old settle不得回填；
- 新 generation请求不得加入旧 flight；不同 agentDir/modelsPath隔离；
- catalog build在 projection前检查 runtime health；错误抛到既有500 safe route；
- ordinary warm performance与 fixed provider registration不回退。

### MCR-04 — Live session

- 抽 descriptor reconciliation内核；
- auth path继续 offline `refresh`；新增 config path调用公开 `reloadConfig`；
- 返回 attempted/succeeded/failed summary，单 wrapper隔离；
- same exact id只替换 descriptor，不 `setModel`；删除 current不fallback；
- `set_model` exact miss只 reload一次+exact retry；eventual setModel仍session-scoped；
- 测试设置 `PI_OFFLINE=1`，不请求真实 endpoint。

### MCR-05 — Writer integration

- 建立唯一 commit notification owner：先 admin config invalidation，再 catalog epoch，再 best-effort live reload；
- direct PUT只在 verified + written后调用；
- sync只在 write + fresh verification后调用；实际 warm runtime含新 id才可 `ok`；
- price只在 successful written后调用；
- stale/parse/semantic invalid/rollback/skip/no-write不触发；
- direct/price success wire不变，sync partial warning不变。

### MCR-06 — 收尾

- 更新 architecture/API/library/integrations docs；无需改 AGENTS 顶层导航；
- 跑 checks全部命令；
- 临时 agentDir执行 U1–U4，不使用 operator配置/真实网络；
- 审查无前端生产改动、无无关用户文件修改。

### MCR-07 — Existing-session 行为回归（checker blocker 1）

在 `scripts/test-session-model-pin.mjs` 增加对实际 `AgentSessionWrapper` / `reloadRpcModelsConfigState()` 行为的回归，不再以源码字符串或纯 helper 测试代替：

- 用 `createRuntimeJiti`/项目既有 jiti方式加载 `lib/rpc-manager.ts`，构造最小 fake `AgentSessionLike`；测试前后保存并恢复 `globalThis.__piSessions`，无论成功失败都 `destroy()`/清 timer，避免污染其他测试；
- 将一个 alive existing wrapper 放入 registry，模拟 `reloadConfig()` 后同 provider/id 返回新 descriptor；断言 summary 为 `attempted=1/succeeded=1/failed=0`、`agent.state.model` 引用被 exact replacement；
- 对上述 config reload 断言 `inner.setModel`、settings default writers、session `model_change` append 均为 0；当前 model 被删除时不 fallback、不调用 `setModel`；至少再放一个失败 wrapper验证 failure isolation与summary；
- 调 `wrapper.send({type:"set_model", provider, modelId})`：首次 exact miss、`reloadConfig()` 后 exact hit，断言只 reload 一次、只重试相同 provider/id、最终 `setModel` 一次、返回 exact identity；
- unknown model 在第二次 exact miss 后保持既有 `Model not found`，断言 reload恰好一次、`setModel`/`model_change` 为0、无循环/fuzzy/fallback；
- 成功 `set_model` 可产生SDK既有的**一次** session `model_change`，但 retry/reconcile不得额外追加；同时断言 `withSessionScopedSettingsDefaults` 使默认 model/thinking写入为0。

如重型模块无法被现有测试加载，只允许增加最小、production-neutral test seam；不得把行为重新降级为源码正则。

### MCR-08 — Sync truth 修复（checker blocker 2）

- 审查 `applyModelsConfigSyncWithVerification()` 的 unified commit coordinator 边界；`runtimeReload:"ok"` 的充分条件固定为：`notifyModelsConfigCommitted` 成功完成 admin generation + catalog epoch，并返回 `live.failed===0`；
- coordinator 动态 import/执行失败时，durable write不回滚，但响应必须为 `runtimeReload:"partial"` + 既有 safe warning；不得再调用仅能证明 live reload 的 fallback/stub并据此提升为`ok`；
- 为测试注入 coordinator/notifier seam（若需要），其成功返回即代表 admin/catalog notification已完成；现有 `reloadLiveRuntimes` stub只能作为 coordinator内部live行为，不能独立证明commit freshness；
- `scripts/test-models-config-sync.mjs` 增加：coordinator import/reject → partial，即使 live stub返回ok也仍partial；coordinator成功+failed=0 → ok；coordinator成功+failed>0/throw → partial；skip/no-write不调用coordinator；
- 保持direct/price/sync wire shape、fixed warning与success-only gate，不为测试加入生产环境特判。

### MCR-09 — Remediation复验与交接

- 先跑 MCR-07/08 专项，再跑原全量矩阵；必须记录实际命令结果，不能只记录源码contract；
- 复核 `scripts/test-model-prices.mjs` 是否已有 successful-written通知与422/409/500/no-write不通知的行为证据；缺失则补测试，但不扩大production scope；
- 执行离线 U3 或其等价的真实 wrapper harness，证明existing session exact切换与无额外side effect；
- 更新 `handoff.md` 为 remediation 实际结果并请求 checker重审；checker工具若因策略拒绝执行，精确报告，但 implementer仍需提供本地命令输出。

## 5. 验证命令

```bash
npm run test:web-model-runtime
npm run test:model-catalog-races
npm run test:model-catalog-performance
npm run test:model-catalog-read-purity
npm run test:model-catalog-client
npm run test:models-config-races
npm run test:models-config-sync
npm run test:model-prices
npm run test:session-model-pin
npm run lint
node_modules/.bin/tsc --noEmit
```

不要运行裸 `next build`。

## 6. 评审门禁

- 必须展示修复前失败、修复后通过的 whole-provider warm test；
- 必须区分 loaded 与 available，不把无 auth当 bug；
- 不接受前端重复 fetch/timeout；
- 不接受 direct PUT先返回成功再由 catalog静默丢 provider；
- 不接受 runtime error下200 partial/empty；
- 不接受 auth reload全部改为 `reloadConfig()`；
- 不接受 test reset掩盖生产 cache；
- 不接受用源码正则/纯helper代替 R9/R10 existing-session行为测试；
- 不接受 coordinator import失败后仅凭live reload stub返回`runtimeReload:"ok"`；
- 成功`set_model`允许SDK既有的一次`model_change`，但reload/reconcile/retry不得额外写，settings defaults必须为0；
- 任何新增 UI 需退回 planning + ui-designer HTML审批。

## 7. 回滚

纯代码回滚；无 schema/数据迁移。保留合法 `models.json` 与 auth/session。回滚后临时恢复方式为服务重启。

---

## Implementation Plan (machine-readable)

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "summary": "系统修复 custom model/whole provider 可见性，并执行 checker remediation：补齐 existing-session reload/exact retry/side-effect 行为测试，修正 sync coordinator import-failure 时 runtimeReload 真值。",
  "strategy": "保留已完成的 MCR-01…06；MCR-07 与 MCR-08 并行关闭两个 checker blocker，MCR-09 串行复验完整矩阵并交回 checker。",
  "maxConcurrency": 2,
  "sourceArtifact": "implement.md",
  "subtasks": [
    {
      "id": "MCR-01",
      "title": "Add full custom provider and model visibility regressions",
      "phase": "test-first",
      "order": 10,
      "dependsOn": [],
      "relation": "serial",
      "files": [
        "scripts/test-model-catalog-races.mjs",
        "scripts/test-web-model-runtime.mjs",
        "scripts/test-models-config-races.mjs",
        "scripts/test-model-catalog-client.mjs"
      ],
      "instructions": [
        "Add temp-agentDir tests for both appending a model to an existing custom OpenAI-compatible provider and adding a complete new provider after the admin catalog is warm.",
        "Prove a fresh session-style ModelRuntime sees the new provider while the current shared admin catalog remains stale after epoch-only invalidation.",
        "Lock SDK 0.80.10 semantics: refresh does not reread modelsPath; reloadConfig and fresh runtime do; extension registrations survive reloadConfig.",
        "Add no-auth, missing-env-key, literal-key, and stored-key controls that distinguish getModel from getAvailableSnapshot.",
        "Reproduce direct PUT false success for missing baseUrl and whole-file rejection for an empty model id, plus catalog 200 partial/empty behavior when runtime.getError is present.",
        "Keep PI_OFFLINE/temp paths/fake credentials and do not use __resetWebModelRuntimeCacheForTests as the production fix."
      ],
      "acceptance": [
        "At least one valid whole-provider regression fails before the fix because the shared admin runtime is stale.",
        "At least one semantic-invalid regression fails before the fix because PUT/catalog report success.",
        "Tests clearly label unauthenticated loaded-but-unavailable behavior as expected.",
        "No operator data or real provider network is used."
      ],
      "validation": [
        "npm run test:model-catalog-races",
        "npm run test:web-model-runtime",
        "npm run test:models-config-races",
        "npm run test:model-catalog-client"
      ],
      "risks": [
        "Fixed providers can add unrelated rows; assert exact isolated provider/model identities.",
        "A key fixture is required for available-snapshot assertions."
      ],
      "parallelizable": false,
      "member": "implementer",
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "MCR-02",
      "title": "Validate direct models-config candidates before durable success",
      "phase": "validation",
      "order": 20,
      "dependsOn": ["MCR-01"],
      "relation": "parallel",
      "files": [
        "app/api/models-config/route.ts",
        "lib/web-model-runtime.ts",
        "lib/models-config-store.ts",
        "lib/models-config-runtime.ts",
        "scripts/test-models-config-races.mjs"
      ],
      "instructions": [
        "Add a server-only candidate verifier using a private temporary modelsPath and fixed-provider-aware fresh ModelRuntime with initial model network disabled.",
        "Reject runtime.getError and missing exact provider/model composition while deliberately not requiring auth availability.",
        "Run verification on the normalized full direct-PUT candidate before mutateModelsJsonUnderLock commits it.",
        "Return a fixed path-free 422 models_config_invalid body; do not expose SDK errors, config, baseUrl, headers, keys, or temp paths.",
        "Ensure semantic failure leaves disk bytes, revision, backup, admin generation, catalog epoch, and live wrappers untouched.",
        "Always cleanup the temp directory and preserve existing atomic/revision behavior."
      ],
      "acceptance": [
        "Missing baseUrl, empty id, invalid schema/cost/compat cannot return success or alter disk.",
        "A structurally valid provider without auth can still be saved.",
        "A valid complete provider passes and retains the existing success wire.",
        "Candidate verification performs zero model endpoint calls."
      ],
      "validation": [
        "npm run test:models-config-races",
        "npm run test:web-model-runtime",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "Temporary files can contain credentials; enforce private modes, cleanup, and fixed errors.",
        "Over-validating availability would incorrectly reject providers configured later through auth.json."
      ],
      "parallelizable": true,
      "member": "implementer",
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "MCR-03",
      "title": "Make admin config invalidation generation-aware and catalog fail closed",
      "phase": "runtime-catalog",
      "order": 30,
      "dependsOn": ["MCR-01"],
      "relation": "parallel",
      "files": [
        "lib/web-model-runtime.ts",
        "lib/model-catalog-service.ts",
        "app/api/models/route.ts",
        "scripts/test-model-catalog-races.mjs",
        "scripts/test-model-catalog-performance.mjs",
        "scripts/test-model-catalog-read-purity.mjs"
      ],
      "instructions": [
        "Add a production per-canonical-agentDir/modelsPath config invalidation API separate from the test reset.",
        "Evict matching resolved/init-pending/refresh-pending slots and generation-gate all late settlements so new requests never join or republish old config work.",
        "Preserve fresh fixed-provider registration and ordinary warm runtime reuse.",
        "Before catalog projection, treat runtime.getError as a build failure and map it through the existing path-free 500 model_catalog_unavailable route.",
        "Keep auth/account invalidations as catalog/auth refresh events rather than config generation changes.",
        "Test distinct keys, late init/refresh, recovery, last-good, fixed providers, zero network, and warm performance."
      ],
      "acceptance": [
        "The next admin catalog after config invalidation reads the current models.json without restart.",
        "Old generation work cannot refill or serve a new-generation request.",
        "Runtime config/composition errors never produce a 200 partial/empty catalog.",
        "Warm/concurrent performance and read purity remain within current gates."
      ],
      "validation": [
        "npm run test:model-catalog-races",
        "npm run test:model-catalog-performance",
        "npm run test:model-catalog-read-purity",
        "npm run test:web-model-runtime"
      ],
      "risks": [
        "Incorrect finally cleanup can delete a newer pending slot.",
        "Health gating must return only fixed safe errors and avoid optional-provider log leakage."
      ],
      "parallelizable": true,
      "member": "implementer",
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "MCR-04",
      "title": "Reload live model config and self-heal exact set_model misses",
      "phase": "live-session",
      "order": 40,
      "dependsOn": ["MCR-01", "MCR-02", "MCR-03"],
      "relation": "serial",
      "files": [
        "lib/rpc-manager.ts",
        "lib/pi-types.ts",
        "scripts/test-session-model-pin.mjs",
        "scripts/test-model-catalog-races.mjs"
      ],
      "instructions": [
        "Extract exact provider/id descriptor reconciliation shared by auth refresh and models-config reload without calling setModel.",
        "Keep reloadRpcAuthState on offline refresh and add reloadRpcModelsConfigState using public runtime.reloadConfig with per-wrapper attempted/succeeded/failed summary and failure isolation.",
        "Retain provider session resource cleanup and do not invent a replacement when the current model was deleted.",
        "On the first exact set_model miss only, reloadConfig once and retry the same provider/id; preserve the existing error after a second miss.",
        "Keep the eventual setModel inside withSessionScopedSettingsDefaults: default model/thinking writes stay zero; config reload/reconciliation adds no model_change, while a successful normal setModel may append exactly its one expected model_change.",
        "Use PI_OFFLINE/network guards in tests; do not deep-import SDK internals."
      ],
      "acceptance": [
        "An existing session can select a newly added provider/model.",
        "Same-id current descriptor refreshes without setModel or settings/JSONL writes.",
        "Unknown/deleted models do not loop or fall back.",
        "Auth-only reload semantics remain unchanged."
      ],
      "validation": [
        "npm run test:session-model-pin",
        "npm run test:model-catalog-races",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "Reloading a live runtime can race an active turn; preserve exact current identity and isolate failures.",
        "Pi reloadConfig has no per-call network option; retain runtime policy and keep tests offline."
      ],
      "parallelizable": false,
      "member": "implementer",
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "MCR-05",
      "title": "Unify writer commit notifications and truthful sync reload status",
      "phase": "integration",
      "order": 50,
      "dependsOn": ["MCR-02", "MCR-03", "MCR-04"],
      "relation": "serial",
      "files": [
        "app/api/models-config/route.ts",
        "lib/models-config-runtime.ts",
        "lib/models-config-sync.ts",
        "lib/model-price-config.ts",
        "scripts/test-models-config-races.mjs",
        "scripts/test-models-config-sync.mjs",
        "scripts/test-model-prices.mjs",
        "scripts/test-model-catalog-races.mjs"
      ],
      "instructions": [
        "Create one success-only commit notification owner that invalidates admin config generation, advances catalog epoch, and best-effort reloads live model config.",
        "Wire direct PUT only after candidate verification and written success; wire sync only after verified write; wire price only after successful written patch.",
        "Never notify on stale, parse/semantic invalid, write fail, verification fail/rollback, preview, cancellation, skip, or no-write.",
        "Make sync runtimeReload ok require actual admin freshness and zero failed live wrappers; otherwise preserve partial plus the existing safe warning.",
        "Avoid duplicate epoch/generation owners and preserve direct/price/sync response shapes."
      ],
      "acceptance": [
        "Both appended model and whole new provider appear through the normal save-close-select path.",
        "Sync ok is backed by actual warm runtime exact model presence.",
        "Price descriptor changes use the same config freshness boundary.",
        "All no-write/failure gates have zero notification side effects."
      ],
      "validation": [
        "npm run test:models-config-races",
        "npm run test:models-config-sync",
        "npm run test:model-prices",
        "npm run test:model-catalog-races"
      ],
      "risks": [
        "Multiple invalidation owners can cause extra cold builds or races.",
        "Live partial failure must not roll back a valid durable direct/price commit."
      ],
      "parallelizable": false,
      "member": "implementer",
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "MCR-06",
      "title": "Run full validation and document provider/config/catalog semantics",
      "phase": "verify-docs",
      "order": 60,
      "dependsOn": ["MCR-05"],
      "relation": "serial",
      "files": [
        "docs/architecture/overview.md",
        "docs/modules/api.md",
        "docs/modules/library.md",
        "docs/integrations/README.md",
        "scripts/test-model-catalog-client.mjs"
      ],
      "instructions": [
        "Document custom provider composition versus fixed extension registration, loaded-versus-available auth gating, candidate validation, admin generation, catalog fail-closed, and live exact-id reload.",
        "Keep success API/frontend selector wire explicitly unchanged and document semantic-invalid 422.",
        "Run every command in checks.md and execute temp-agentDir manual flows for append model, whole provider, existing session, no-auth control, and invalid save.",
        "Review the final diff for unrelated user changes; do not modify them or add UI behavior."
      ],
      "acceptance": [
        "All focused suites, lint, and TypeScript pass or unrelated pre-existing failures are precisely reported.",
        "U1-U4 work without process restart or real provider network.",
        "Docs match code and no HTML prototype is required.",
        "No commit, push, or merge is performed."
      ],
      "validation": [
        "npm run test:web-model-runtime",
        "npm run test:model-catalog-races",
        "npm run test:model-catalog-performance",
        "npm run test:model-catalog-read-purity",
        "npm run test:model-catalog-client",
        "npm run test:models-config-races",
        "npm run test:models-config-sync",
        "npm run test:model-prices",
        "npm run test:session-model-pin",
        "npm run lint",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "Broad lint may expose unrelated worktree failures; report without overwriting user changes.",
        "Source assertions alone are insufficient; retain runtime behavior tests."
      ],
      "parallelizable": false,
      "member": "implementer",
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "MCR-07",
      "title": "Add behavioral regressions for existing-session config reload and exact set_model retry",
      "phase": "remediation-live-tests",
      "order": 70,
      "dependsOn": ["MCR-06"],
      "relation": "parallel",
      "files": [
        "scripts/test-session-model-pin.mjs",
        "lib/rpc-manager.ts",
        "lib/pi-types.ts"
      ],
      "instructions": [
        "Load the actual rpc-manager through the project runtime-jiti path and build minimal fake AgentSessionLike wrappers; preserve and restore globalThis.__piSessions and destroy wrappers in finally blocks.",
        "Behavior-test reloadRpcModelsConfigState on an existing alive session: reloadConfig runs, same exact provider/id descriptor is replaced, deleted current models do not fallback, and per-wrapper failures are isolated in attempted/succeeded/failed.",
        "Assert config reload/reconciliation calls neither setModel nor settings default writers and appends no model_change record.",
        "Behavior-test AgentSessionWrapper.send(set_model): first exact miss reloads config once, retries the identical provider/id once, then calls setModel once on hit; a second miss preserves Model not found with no loop/fuzzy/fallback.",
        "Assert successful set_model has at most the SDK's one expected model_change and no extra retry/reconcile record, while default model/thinking writes stay zero through withSessionScopedSettingsDefaults.",
        "Do not substitute source-regex assertions or pure session-model-pin helper tests for wrapper behavior; add only a minimal production-neutral test seam if runtime loading otherwise cannot work."
      ],
      "acceptance": [
        "scripts/test-session-model-pin.mjs directly exercises actual wrapper reload and set_model behavior.",
        "Existing-session descriptor refresh has zero setModel/model_change/default side effects and no deletion fallback.",
        "Exact retry occurs once and only once; success and second-miss paths are both covered.",
        "Registry/timers/environment are restored and no real provider network or operator session is used."
      ],
      "validation": [
        "npm run test:session-model-pin",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "Importing rpc-manager is dependency-heavy; use createRuntimeJiti and deterministic fakes rather than weakening assertions.",
        "The normal successful set_model writes one model_change; distinguish it from forbidden extra writes caused by reload/reconcile."
      ],
      "parallelizable": true,
      "member": "implementer",
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "MCR-08",
      "title": "Fail sync runtimeReload truthfully when unified commit notification cannot run",
      "phase": "remediation-sync-truth",
      "order": 80,
      "dependsOn": ["MCR-06"],
      "relation": "parallel",
      "files": [
        "lib/models-config-sync.ts",
        "lib/models-config-commit.ts",
        "scripts/test-models-config-sync.mjs"
      ],
      "instructions": [
        "Make runtimeReload ok require successful completion of the unified commit notifier (admin generation plus catalog epoch) and live.failed equal to zero.",
        "On notifier dynamic-import or execution failure, keep the verified durable write but return partial with the existing safe warning; never promote an injected live-only reload stub to ok.",
        "If test injection is needed, inject the commit notifier contract itself; reloadLiveRuntimes may only be consumed inside a successfully running notifier and is not independent freshness proof.",
        "Add behavioral cases for notifier reject/import-failure even when live stub says ok, notifier success with zero failures, notifier success with live failures, notifier throw, and skip/no-write zero calls.",
        "Preserve response shape, privacy, rollback behavior, and the single success-only notification owner."
      ],
      "acceptance": [
        "No path can return runtimeReload ok without proof that admin/catalog notification completed.",
        "Import/notifier failure returns partial plus MODELS_CONFIG_SYNC_PARTIAL_RELOAD_WARNING and does not roll back a verified write.",
        "Successful notifier with live.failed===0 remains ok; live failure remains partial.",
        "No-write and verification rollback paths never notify."
      ],
      "validation": [
        "npm run test:models-config-sync",
        "npm run test:model-catalog-races",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "A test-only live stub can accidentally bypass the commit owner unless the injection boundary is raised to the notifier contract.",
        "Notifier failure occurs after durable success, so the safe response is partial rather than rollback or false ok."
      ],
      "parallelizable": true,
      "member": "implementer",
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "MCR-09",
      "title": "Re-run remediation gates and provide checker-verifiable evidence",
      "phase": "remediation-verify",
      "order": 90,
      "dependsOn": ["MCR-07", "MCR-08"],
      "relation": "serial",
      "files": [
        "scripts/test-model-prices.mjs",
        "scripts/test-session-model-pin.mjs",
        "scripts/test-models-config-sync.mjs",
        ".ypi/tasks/20260819-101347-排查-openai-协议自定义提供商新增模型未出现在模型选择中/handoff.md"
      ],
      "instructions": [
        "Run the two blocker suites first and capture actual behavioral results, then run every command in checks.md, lint, and TypeScript.",
        "Review model-price successful-written and failure/no-write commit-notification coverage; add focused tests if evidence is absent without changing product scope.",
        "Run offline U3 or an equivalent actual-wrapper harness and report exact retry counts plus model_change/default-write counts.",
        "Update handoff.md with remediation files/results and request checker re-review; precisely report any policy-rejected checker command without claiming it passed.",
        "Do not modify UI, commit, push, or merge."
      ],
      "acceptance": [
        "Both checker blockers have behavior-level passing evidence, not source-only assertions.",
        "Model-price success-only notification risk is either covered by an existing cited test or a new focused test.",
        "All original focused suites plus lint and tsc pass, or unrelated pre-existing failures are precisely isolated.",
        "No frontend production change, real provider network, operator data mutation, commit, push, or merge occurs."
      ],
      "validation": [
        "npm run test:session-model-pin",
        "npm run test:models-config-sync",
        "npm run test:model-prices",
        "npm run test:web-model-runtime",
        "npm run test:model-catalog-races",
        "npm run test:model-catalog-performance",
        "npm run test:model-catalog-read-purity",
        "npm run test:model-catalog-client",
        "npm run test:models-config-races",
        "npm run lint",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "Checker execution policy may reject commands; retain local deterministic output and report the distinction.",
        "Untracked production modules must be included in the checker-visible diff for complete review."
      ],
      "parallelizable": false,
      "member": "implementer",
      "localReview": { "required": true, "reviewer": "checker" }
    }
  ]
}
```
