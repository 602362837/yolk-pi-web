# Checks — 模型目录加载性能

## 验收状态（MLP-07，2026-07-29）

| 类别 | 结果 |
| --- | --- |
| Focused catalog suites | **通过** |
| Provider / auth / models regression | **通过** |
| lint / tsc / git diff --check | **通过**（lint 仅既有 warnings，0 errors） |
| MLP-06 CredentialStore 缓存 | **跳过**（无必要性证据） |
| 隔离 30142 真服务 cold/warm | **未跑**（本机 suite 覆盖 offline catalog 路径） |
| 真实凭据 UAT / 手工 Chat+Settings | **未跑**（需主会话/操作者环境） |

## 需求覆盖

- [x] `/api/models` 使用 offline fixed-provider admin catalog，不创建 session runtime。
- [x] Chat inference / Studio runtime隔离不变（admin runtime 仅 catalog；session services 仍隔离）。
- [x] 路由不调用会追加 availability scan 的 `getAvailable()`（`getAvailable=0`）。
- [x] 同 epoch cold/concurrent 请求只产生一个 catalog flight（`cache_shared=7` on 8 concurrent）。
- [x] catalog-like 前后 auth/bridge 内容与 mtime 不变；reconcile/write=0。
- [x] AnyRouter 显式 mutation 仍能重建 bridge/auth，锁顺序不变（anyrouter accounts suite）。
- [x] Chat initial defaultModel 变化不重复 fetch（client resource generation + suite）。
- [x] Chat + Settings 并发共享客户端 flight。
- [x] Settings 相关 view 切换不重复 fetch（`useModelCatalog` 订阅，非 view effect）。
- [x] models/auth/account 成功 mutation 完整失效；失败不失效（races suite + 源码契约）。
- [x] `/api/models` wire 字段兼容（performance/client parse）。
- [x] Settings 壳层不等待模型目录（仍仅 `/api/web-config` 控制「正在加载设置…」）。

## 自动验证（本轮实测）

```text
npm run test:model-catalog-performance     # 7 passed
npm run test:model-catalog-read-purity     # 6 passed
npm run test:model-catalog-races           # 10 passed
npm run test:model-catalog-client          # 9 passed
npm run test:web-model-runtime             # 10 passed
npm run test:models-provider-auth-summary  # 6 passed
npm run test:models-config-races           # 6 scenarios
npm run test:models-config-sync            # 73 passed
npm run test:oauth-accounts                # all OAuth account tests passed
npm run test:anyrouter-provider            # 13 passed
npm run test:anyrouter-accounts            # 14 passed
npm run test:api-key-accounts              # 26 passed
npm run test:web-credential-store          # 14 passed
npm run lint                               # 0 errors / 13 pre-existing warnings
node_modules/.bin/tsc --noEmit             # clean
git diff --check                           # clean
```

## 性能矩阵（isolated temp `PI_CODING_AGENT_DIR`，`PI_OFFLINE`，无真实网络）

| 场景 | 指标 | 实测 |
| --- | --- | --- |
| isolated cold | first usable ≤3s；one init/refresh flight | **491ms**; `runtime.create=1` `admin_init=1` `admin_refresh=1` `services=0` `getAvailable=0` `anyrouter.reconcile=0` |
| isolated warm | p95 ≤500ms | **p50=1ms p95=105ms** (n=5 burst; 超过 PRD 20 次样本规模但远低于门禁) |
| 8 并发 | p95 ≤ warm×2；one server flight | **wall 75ms**; `cache_miss=1` `cache_shared=7`; one admin runtime |
| Chat + delayed web-config | one browser catalog flight | client suite: concurrent ensure shares one flight; ready generation no-op |
| Chat + Settings open | one shared flight | 同上 + frontend 订阅同一 resource |
| Settings 四 view 切换 | zero additional request | `SettingsConfig` 不再 per-view fetch |
| Models close 失效 | exactly one next-generation | `refreshModelCatalog({ force:true })` / invalidate + ensure |
| 请求完成后 | pending/queue 归零 | failed pending clears; success finally clears pending; metrics disable stops accumulation |

计数摘要（cold catalog build）：

- `refresh_calls=5`（SDK registerProvider detached + offline refresh；**无**额外 `getAvailable`）
- `credential.raw_read≈1125`（cold 仍高，但 PRD 时延门禁已满足 → **不启动 MLP-06**）
- `anyrouter.reconcile=0` / mirror write=0 on catalog path

## 竞态与一致性

- [x] old generation 晚到不能 publish（races suite）
- [x] catalog flight 失败后 pending 清理，下一请求可恢复
- [x] 一个订阅者卸载不取消其他共享 flight（client suite design + concurrent ensure）
- [x] stale generation response 不能覆盖 newer catalog
- [x] models.json 外部原子替换 + explicit invalidate 后读到新事实
- [x] 失败 mutation 不推进 epoch / 不清 last-good
- [x] AnyRouter Active 切换仍显式 reconcile；catalog 路径零写
- [x] MLP-06 **未执行**（无需其额外 credential 回归门禁）

## 网络与隐私

- [x] catalog suites 零 provider 网络（offline / no network asserts）
- [x] metrics line content-safe（无 path/credential/account/model 名）
- [x] API 未新增 credential/model config 原文
- [x] 测试仅临时 agentDir
- [!] 隔离 fixture 无 bridge 时 `pi-anyrouter` 仍可能向 stderr 打印 **绝对 bridge 路径**（上游包行为；Web metrics/API 不记录）

## 手工验收

仍需操作者在 dev UI 上完成（本成员未跑 30141/30142 手工 waterfall）：

1. 冷启动 Chat 模型框快速可用 + yolk specific default。
2. 模型加载中打开 Settings：壳层立即显示；默认模型控件随后填充。
3. 快速切换蛋黄π/Studio/Terminal/Trellis：无清空/闪回/重复 `/api/models`。
4. Models 变更后关闭：一次新目录 generation，无 selection 跳动。
5. AnyRouter Active / 无 Active：目录读不改文件。
6. 若原报告是整页「正在加载设置…」：单独 HAR `/api/web-config`，未复现前不声称该口径已修。

## MLP-06 门禁结论

**跳过。** 前置 MLP-02/03/04/05 后 isolated cold/warm/8并发时延与 pure-read 已达标；无需 WebCredentialStore parsed-snapshot 改造。`raw_read` 仍高可作为后续观测项，不构成本任务默认实施条件。

## 重点风险（仍有效）

- admin runtime 不随 epoch drop；descriptor 依赖 offline refresh。
- SDK detached refresh 仍存在（refresh_calls>1），但 catalog 不追加 `getAvailable`。
- AnyRouter 缺 bridge 时 catalog 降级（无 AnyRouter 模型）；显式 bootstrap 仍是遗留挂载点。
- 未做真实凭据分钟级 UAT / 30142 服务进程级证明。
- Active OAuth 路径可能双重 epoch bump（单调正确）。
