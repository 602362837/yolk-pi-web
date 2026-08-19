# Handoff — implementer（MCR-09 remediation 收尾）

## Status

- **MCR-01…09 全部完成**；当前子任务 **MCR-09 done**。
- Checker 两个 blocker 均有行为级证据（非源码正则替代）。
- 无 UI / 前端生产逻辑改动。
- 未 `commit` / `push` / `merge`。
- 未派发其他 Studio member / subagent。

## Blocker closure

### Blocker 1 — R9/R10 existing-session 行为（MCR-07）

`scripts/test-session-model-pin.mjs` 通过 runtime-jiti 实际加载 `AgentSessionWrapper` / `reloadRpcModelsConfigState`：

| Case | Evidence |
| --- | --- |
| same-id descriptor replace | `reloadConfig=1`, `setModel=0`, `model_change=0`, defaults=0 |
| deleted current | no fallback / no `setModel` |
| failure isolation | summary `attempted/succeeded/failed` accurate |
| exact miss → hit | `reloadConfig=1`, same provider/id retry once, `setModel=1`, SDK `model_change=1` only |
| unknown second miss | keeps `Model not found`; `reloadConfig=1`; `setModel=0`; no loop/fuzzy |

Registry/`globalThis.__piSessions` 在 finally 中恢复；wrapper destroy。

### Blocker 2 — R11 sync notifier false-ok（MCR-08）

`lib/models-config-sync.ts`：`runtimeReload:"ok"` 仅当 unified `notifyCommitted` 成功且 `live.failed===0`。

| Case | Result |
| --- | --- |
| notifier import/reject + live stub ok | `partial` + fixed warning |
| notifier success + failed=0 | `ok` |
| notifier success + failed>0 | `partial` |
| notifier throw after durable write | `partial`（不回滚） |
| skip/no-write | notifier 不调用 |

### MCR-09 incremental — model-price success-only 证据

原先缺少 price writer 行为级通知证据。本轮补齐：

- `lib/model-price-config.ts`：生产中立可选 `notifyCommitted` seam（默认仍动态 import `notifyModelsConfigCommitted`）。
- `scripts/test-model-prices.mjs`：
  - written success → 通知一次 `model_prices`
  - 409 stale → 0 通知
  - 422 invalid/no-write → 0 通知且磁盘不变
  - notify throw 后仍 200，durable write 保留
- `scripts/test-model-catalog-races.mjs` 源码契约同步适配 seam，仍要求 written-only + 统一 owner。

## Files changed（本轮 MCR-09）

- `lib/model-price-config.ts` — 可选 `notifyCommitted` test seam；默认路径不变
- `scripts/test-model-prices.mjs` — success-only 通知行为测试
- `scripts/test-model-catalog-races.mjs` — price writer 源码契约适配
- `.ypi/tasks/.../handoff.md` — 本交接

## Prior remediation surface（MCR-01…08，供 checker 可见）

生产：

- `app/api/models-config/route.ts`
- `lib/web-model-runtime.ts`
- `lib/model-catalog-service.ts`
- `lib/models-config-runtime.ts`（untracked 新模块）
- `lib/models-config-commit.ts`（untracked 新模块）
- `lib/models-config-sync.ts`
- `lib/model-price-config.ts`
- `lib/rpc-manager.ts`
- `lib/pi-types.ts`

测试：

- `scripts/test-session-model-pin.mjs`
- `scripts/test-models-config-sync.mjs`
- `scripts/test-model-prices.mjs`
- `scripts/test-model-catalog-races.mjs`
- `scripts/test-models-config-races.mjs`
- `scripts/test-web-model-runtime.mjs`

文档（已与代码一致，本轮无需再改）：

- `docs/architecture/overview.md`
- `docs/modules/api.md`
- `docs/modules/library.md`
- `docs/integrations/README.md`

## Validation run（本地 implementer，`PI_OFFLINE=1`）

| Command | Result |
| --- | --- |
| `npm run test:session-model-pin` | **pass**（含 5 个 MCR-07 actual wrapper cases） |
| `npm run test:models-config-sync` | **pass**（79；含 MCR-08 notifier 真值 cases） |
| `npm run test:model-prices` | **pass**（49；含 4 个 commit notification cases） |
| `npm run test:web-model-runtime` | **pass**（13） |
| `npm run test:model-catalog-races` | **pass**（19；含 F1/F2/fail-closed/price contract） |
| `npm run test:model-catalog-performance` | **pass**（7） |
| `npm run test:model-catalog-read-purity` | **pass**（6） |
| `npm run test:model-catalog-client` | **pass**（14；含 500 last-good） |
| `npm run test:models-config-races` | **pass**（7；含 semantic 422 no-write） |
| `npm run lint` | **exit 0**；12 既有/无关 warnings，无 error |
| `node_modules/.bin/tsc --noEmit` | **pass**（exit 0） |

### U3 自动化等价（offline wrapper harness）

来自 `test:session-model-pin` MCR-07：

- exact miss：`reloadConfig=1` + identical provider/id retry + `setModel=1`
- reload/reconcile：`model_change=0`、default writes=0
- 成功 `set_model`：仅允许 SDK 正常一次 `model_change`
- unknown 第二次 miss：原错保留，无循环/fuzzy/fallback

未对真实 operator `models.json` / 真实 provider 网络做手工 U1–U5；自动矩阵已覆盖等价契约。

## Remaining risks

1. `lib/models-config-commit.ts` / `lib/models-config-runtime.ts` 仍为 **untracked**；checker 复审 diff 时需显式包含，否则会漏掉核心模块。
2. WorkTree Check / checker 执行策略可能拒绝跑命令；本 handoff 记录的是 implementer 本地 PASS，不等于 checker 已复跑。
3. temp agentDir 下 AnyRouter 缺 runtime bridge 会打 stderr warning；不计入失败，也不代表 fixed provider 丢失。
4. live `reloadConfig` 与 active turn 竞态仍属已知残余风险；现有隔离与 exact-id 契约已覆盖，但不消灭并发窗口。
5. lint 的 12 条 warning 为既有/无关；未在本任务清扫。

## Decisions needed from main session

1. 将 MCR-09 标为 done，计划进度 9/9，进入 checker 复审。
2. 派 checker 时确保可见 untracked 生产模块：`lib/models-config-commit.ts`、`lib/models-config-runtime.ts`。
3. 不 commit / push / merge，直到 checker + 用户确认。
4. 若 checker 因策略无法执行命令，以本 handoff 的本地命令输出为证据，并在 review 中区分“本地 PASS / checker 未复跑”。
