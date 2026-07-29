# Design — 模型目录纯读共享快照

## 方案摘要

采用“**一个服务端 catalog generation + 一个浏览器 catalog resource**”方案：

1. `/api/models` 改用 fixed-provider admin runtime，不再创建 session services/runtime。
2. catalog 初始化完全离线，路由读取已经刷新好的 available snapshot，不再追加 `getAvailable()` refresh。
3. 以 catalog epoch + single-flight 管理快照，auth/model 成功 mutation 显式失效。
4. AnyRouter 将全局 bridge reconcile 从每个 target runtime 的 provider factory 热路径移出；至少做到 fingerprint/no-op，目录 GET 零写。
5. Chat 与 Settings 复用同一客户端 catalog resource，消除 mount/defaultModel/view 切换造成的重复请求。
6. 先 instrumentation，再决定是否必须改通用 `WebCredentialStore`；避免在无定量证据时放宽认证一致性。

## AS-IS 问题模型

### 请求级放大

`/api/models` 每次创建新 runtime。SDK `ModelRuntime.create` 有一次 refresh；四次 `registerProvider` 各自产生 detached refresh；services 尾部 refresh；路由 `getAvailable` 再做 availability。每轮 availability 又双路径遍历 provider，并通过同一个 `authPath` 进程队列反复读取/解析文件。

客户端至少可能产生：

- Chat 初始 `defaultModel=null` 请求；
- `/api/web-config` 到达后 specific default 引发第二次；
- Settings 默认 yolk 引发第三次；
- Settings 四个模型策略页切换继续触发；
- Models close 的 refreshKey 再触发。

不同 runtime 的 `FileWebCredentialStore` 实例最终共享模块级 `processQueues[authPath]`，因此不是隔离并行，而是共同排队。

### 读路径写副作用

AnyRouter factory 是每个 target runtime 都必须注册的模型/provider扩展，但 runtime bridge 是进程/agentDir 全局派生物。当前 factory 把两件事绑定：每次目标 runtime 注册前都锁 provider、重写 bridge、`store.modify(auth.json)`。这既破坏 GET 纯读，也让 auth mtime/authority revision 抖动，引发更多失效与锁等待。

## TO-BE 数据流

```text
Browser modelCatalogResource (epoch E)
  ├─ Chat subscribe
  ├─ Settings subscribe
  └─ one GET /api/models

GET /api/models
  -> getModelCatalogSnapshot(E)
       -> hit: return immutable safe projection
       -> miss:
            shared pending(E)
              -> getWebModelRuntime({ allowModelNetwork:false })
                   -> cold only: fixed provider registration
                   -> offline refresh single-flight
              -> getAvailableSnapshot()          # no new availability refresh
              -> project model/thinking/default
              -> publish snapshot(E, fingerprint)
  -> response unchanged

successful model/auth/account mutation
  -> commit storage/mirror
  -> invalidateModelCatalog(reason) => E+1
  -> live wrapper reload (existing behavior)
  -> next browser refresh/Models close fetches E+1
```

## 模块设计

### 1. `lib/model-catalog-service.ts`（新增建议）

职责：

- 服务端 safe response projection；
- keyed single-flight；
- short bounded cache（建议 2–5s，只作 burst collapse）；
- monotonic epoch/invalidation；
- slow-stage counters。

建议接口：

```ts
export type WebModelCatalogResponse = {
  models: Record<string, string>;
  modelList: Array<{ id: string; name: string; provider: string; providerDisplayName?: string }>;
  defaultModel: { provider: string; modelId: string } | null;
  thinkingLevels: Record<string, string[]>;
  thinkingLevelMaps: Record<string, Record<string, string | null>>;
};

export async function getWebModelCatalogSnapshot(): Promise<WebModelCatalogResponse>;
export function invalidateWebModelCatalog(reason: ModelCatalogInvalidationReason): void;
```

正确性：

- pending rejection 必须删除；reset/invalidate 后旧 generation 即使晚到也不得发布。
- snapshot 对外返回只读/克隆投影，调用方不能污染共享对象。
- default model 从 SettingsManager 读取；若 settings 默认变化而未显式失效，应把 `settings.json` stat/revision 纳入 key，或在明确默认写入口失效。
- 不接受 cwd 项目扩展；当前 `/api/models` 已声明 admin fixed-only，响应行为不应引入项目扩展差异。

### 2. `app/api/models/route.ts`

- 保留 cwd 合法性检查（兼容现有 contract），但 catalog identity 不按 cwd 拆 runtime。
- 调用 catalog service。
- 不吞掉所有异常后返回伪成功空数组；使用固定 safe `model_catalog_unavailable` 500，客户端保留上次好值。若为兼容必须保留 200 空值，应在实现评审中明确，不可无声决定。
- `Cache-Control: no-store`；进程内 cache 不等于浏览器 HTTP cache。
- 可加 `Server-Timing` 的固定 stage 名或仅服务端慢日志；不能含路径/provider/account id。

### 3. `lib/web-model-runtime.ts`

- 复用现有 `getWebModelRuntime` init/offline-refresh single-flight。
- 检查 admin `get` 每次都 refresh 的成本：catalog service burst cache应避免每个 HTTP 请求都进入 refresh。
- cold provider registration 仍可能触发 SDK detached refresh；增加 focused fake-runtime 测试及 pending drain 观测。若无法从公共 SDK 等待全部 refresh，应优先提 upstream 修复/升级适配，不用定时 sleep 猜测稳定。
- 禁止把 admin runtime用于 main Chat/Studio inference。

### 4. AnyRouter loader / bridge

目标边界：target runtime provider registration 与 global derived mirror repair分离。

推荐顺序：

1. `anyrouterProviderExtension` 只确保稳定 env pointer并加载/注册 provider；
2. App/server cold bootstrap或账号/config mutation负责 reconcile；
3. `syncAnyRouterDerivedMirrorsUnlocked` 对 bridge bytes与 auth credential做相等值 no-op；
4. 引入 authority fingerprint/generation single-flight，重复 cold callers共享；失败清 flight可重试；
5. catalog GET 不做 repair write。若 bridge缺失，provider可降级不注册 AnyRouter模型或从 source读取无 secret catalog；不得偷偷写认证文件。

安全不变：Active slot仍为 authority；mutation lock order仍是 AnyRouter provider → auth.json；非 Active mutation不写 mirror。

### 5. `lib/web-credential-store.ts`（测量后门禁）

优先通过“共享 catalog + 去掉重复 refresh/GET写”消除绝大多数 fan-out。只有 instrumentation 仍显示 auth raw-read/queue-wait超标，才实施通用优化：

- 在原子 rename 前提下，read/list共享按 authPath + stat fingerprint 的 parsed snapshot；
- mutation queue内提交后同步更新/失效 snapshot；
- 外部进程修改通过 inode/mtime/size或内容 revision失效；
- `list()`永不解析执行 key；`read(provider)`只解析对应 API key config value；
- 不缓存 plaintext 到浏览器/日志；进程内缓存生命周期与现有 CredentialStore同级；
- 保留写锁，不能把 mutation 改成无锁。

该项风险高于路由修复，不应作为第一刀。

### 6. 客户端 `hooks/useModelCatalog.ts`（新增建议）

模块级 external resource：

- 状态 `idle|loading|ready|error` + generation；
- 同一 generation one Promise + one AbortController owner；订阅者卸载不应取消其他订阅者需要的共享 flight；
- last-good 保留；显式 `invalidateModelCatalog()` 后下一订阅/refresh拉取；
- payload shape校验与 `res.ok` 检查；旧响应 generation guard；
- `useAgentSession` 仅用 catalog选择 new-session seed，不自行 fetch；
- `SettingsConfig` 订阅 catalog，不因 view切换重取；
- AppShell Models close 调一次 invalidate/refresh，而不是只 bump Chat 私有 key。

不改 UI：error 继续落到现有 Settings `modelsError`；Chat 沿用现状静默/last-good。新增可见 Retry 属条件性 UI门禁。

## 缓存失效矩阵

| Mutation | 失效时点 |
| --- | --- |
| ModelsConfig PUT / sync apply | 持久化 + runtime verification成功后 |
| model price PATCH | models.json提交与验证成功后 |
| OAuth/API key login/logout/Activate/create/update/delete/disable | authority/mirror提交成功、返回成功前 |
| AnyRouter config PATCH | source + bridge重建成功后 |
| `settings.json` default writer | 默认值写成功后；若入口无法集中则 catalog key含revision |
| 失败/取消 mutation | 不失效 |

不得使用 auth mtime作为唯一 epoch，因为旧实现的无条件 mirror写会制造假失效；先修no-op/纯读。

## 可观测性与证据计划

### 服务端安全 stage

- `catalog.cache`: hit/miss/shared/epoch；
- `catalog.runtime`: admin init/refresh ms；
- `catalog.providers`: fixed factory count/load ms；
- `catalog.availability`: refresh rounds/count；
- `credential`: raw reads、queue wait total/max、parsed snapshot hit；
- `anyrouter.mirror`: reconcile attempts、no-op/write；
- `catalog.project`: models/providers/thinking counts。

仅在慢阈值或 `PI_MODEL_CATALOG_TIMING=1` 输出；不记录路径/模型名/账号信息。

### 诊断矩阵

1. cold/warm单请求；
2. 8并发；
3. Chat mount + delayed `/api/web-config` specific default；
4. Chat打开Settings默认yolk；
5. Settings四个相关view快速切换；
6. Models close失效；
7. AnyRouter active/no active/bridge缺失/陈旧锁；
8. OAuth过期、API key env/literal/`!command` fixture；
9. models/auth外部原子替换；
10. mutation与catalog并发，旧generation晚到。

## 兼容、风险与回滚

### 风险

- 共享 admin runtime可能暴露 stale auth/model目录：用显式epoch +短burst cache，不能只靠长TTL。
- AnyRouter移出GET repair后，旧安装bridge缺失：在server cold bootstrap或显式设置入口修复，并提供safe degraded结果。
- WebCredentialStore通用缓存若处理外部写不完整会用旧credential：因此为测量后可选，不与P0路由改动绑死。
- SDK detached refresh无法可靠drain：不能用任意sleep；必要时做SDK适配/升级决策。

### 回滚

- catalog service可回滚为当前 route创建runtime，不涉及数据迁移；
- 客户端resource可回滚为各组件fetch；
- AnyRouter保留显式mutation reconcile接口；回滚仅恢复cold repair，不删除bridge/账号；
- 不改写历史auth/models/session数据。
