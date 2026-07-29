# Brief — Chat 模型与 Settings 加载缓慢深度排查

## 目标

定位 Chat 模型列表约 2 分钟、Settings 中模型相关内容约 5–6 分钟才可用的完整链路，区分配置壳层、模型目录、认证验证、Provider 装载、锁/队列与前端重复请求，并形成可证伪的修复计划。本阶段不改生产代码。

## 口径澄清

项目里有两个容易混称为 Settings 的入口：

1. `SettingsConfig`：左下角 Settings；壳层依赖 `GET /api/web-config`，默认 `yolk` 页另行请求 `GET /api/models`。
2. `ModelsConfig`：左下角 Models；并发请求 `/api/models-config`、`/api/auth/providers?mode=summary`、`/api/auth/all-providers`，后台再 verify。该路径已由 #23 做过 progressive loading 与 admin runtime single-flight。

本次证据显示：`/api/web-config` 本身当前很快；真正可复用的慢链路是 Chat 与 Settings 默认模型控件共同依赖的 `GET /api/models`。若用户所说的“Settings 页面”实际指整个弹窗一直显示“正在加载设置…”，仍需提供当次 Network/HAR 与服务端时间线，因为现有 warm 证据不支持把 `/api/web-config` 判为根因。

## 完整加载链路

### Chat

```text
AppShell mount
  ├─ GET /api/web-config
  └─ ChatWindow/useAgentSession mount
       └─ effect(defaultModel=null, isNew, modelsRefreshKey)
            └─ GET /api/models

/api/web-config 返回 yolk.defaultModel=specific
  └─ defaultModel prop 从 null 变为具体模型
       └─ 同一 effect 再次 GET /api/models
```

关闭 Models 弹窗还会递增 `modelsRefreshKey`，再次触发 Chat `/api/models`。

### SettingsConfig

```text
SettingsConfig mount
  ├─ GET /api/web-config                 -> 仅控制“正在加载设置…”
  └─ 初始 view=yolk 的 effect
       └─ GET /api/models                -> 默认模型/思考等级目录

切换 yolk/studio/terminal/trellis
  └─ 每次都重新 GET /api/models
```

Settings 与 Chat 没有共享浏览器端 catalog flight/cache；打开 Settings 时可与 Chat 的重复请求叠加。

### `/api/models`

```text
GET /api/models
  -> stat(cwd)
  -> createWebAgentSessionServices(fixedProvidersOnly=true)
       -> createWebModelRuntime()                 # 每个请求新 runtime
            -> ModelRuntime.create()
                 -> allowModelNetwork 默认 true
                 -> refresh + availability/auth scan
       -> ResourceLoader 顺序加载 4 个 fixed factories
            Grok -> Kiro -> Antigravity -> AnyRouter
       -> AnyRouter cold-load reconcile
            -> provider mkdir lock
            -> 重写 runtime bridge
            -> WebCredentialStore.modify(auth.json)
       -> 每次 registerProvider() 启动 detached refresh
       -> createAgentSessionServices() 再 await 一次 offline refresh
  -> runtime.getAvailable()                       # 再触发 availability refresh
  -> 构建 modelList/thinking/defaultModel
```

## 关键证据

### 源码级确认

1. `app/api/models/route.ts` 没有使用已有的 `getWebModelRuntime()` admin cache/single-flight，而是每次创建隔离 runtime。
2. `createWebModelRuntime()` 未显式传 `allowModelNetwork:false`；SDK 0.80.10 的 `ModelRuntime.create()` 默认在 `PI_OFFLINE` 未设置时允许网络，并仅给首次 refresh 15 秒 abort。
3. SDK `DefaultResourceLoader.loadExtensionFactories()` 按数组顺序 `await` 四个 fixed provider factory。
4. SDK `ModelRuntime.registerProvider()` 对每次注册执行未 await 的 `void refresh({ allowNetwork:false })`；services 创建末尾再 refresh；路由随后 `getAvailable()` 又 refresh availability。
5. SDK 每次 availability refresh 同时调用 `models.getAvailable()`、逐 provider `checkAuth()`、`credentials.list()`；前两者都会逐 provider `CredentialStore.read()`。
6. `FileWebCredentialStore.read()` 将所有读取放入按 `authPath` 的同一进程队列，且每次重新读取/解析完整 `auth.json`。因此它是“串行互斥队列”，不是 read single-flight；多个 runtime 会把大量重复读排到同一尾部。
7. `anyrouterProviderExtension` 每次装载都会 `reconcileAnyRouterRuntimeMirrors()`；`mirrorAuthJson(set)` 无相等值短路，固定调用 `store.modify()`，导致目录 GET 发生磁盘写和 auth 锁竞争。
8. admin runtime 的初始化/refresh single-flight 已存在，但 `/api/models` 绕过了它。

### 当前 30141 服务只读采样（2026-07-29）

| Endpoint | HTTP | 单次 warm |
| --- | ---: | ---: |
| `/api/web-config` | 200 | 0.003s |
| `/api/models` | 200 | 0.268s；另一次出现 10.417s |
| `/api/auth/providers?mode=summary` | 200 | 0.281s |
| `/api/auth/providers?mode=verify` | 200 | 0.075s |
| `/api/auth/all-providers` | 200 | 0.063s |
| `/api/models-config` | 200 | 0.003s |

8 个并发 `/api/models` 均成功，但耗时集中在 1.51–1.76s，明显高于单请求 warm，证明并发会放大而非共享同一结果。

对一次 `/api/models` 前后只比较 `auth.json` stat：文件大小不变，但 mtime 改变；该请求耗时 10.417s。当前样本没有 `auth.json.lock` 或 AnyRouter provider lock 残留，且 auth 配置没有 `!command` key，因此本次不能归因于陈旧锁或命令型 key；“目录 GET 触发 auth 写”已被直接证实。

当前目录响应含 144 个可用模型、15 个可用 provider；admin API 投影 36 个 provider。数据量不足以支持“React 渲染 144 行造成分钟级卡顿”。

## 根因假设与置信度

| ID | 假设 | 置信度 | 判定 |
| --- | --- | --- | --- |
| H1 | `/api/models` 每请求新建 provider-aware runtime，绕过 admin cache/single-flight | 高 | 源码确认，首要根因 |
| H2 | SDK 注册触发多轮 detached availability refresh；WebCredentialStore 将大量重复 auth 读串行化，多个请求形成队列尾积压 | 高 | SDK/Web 源码确认；需计数 instrumentation 定量 |
| H3 | AnyRouter provider 装载在 GET 热路径重复 reconcile 并无条件重写 bridge/auth | 高 | 源码 + mtime 实测确认 |
| H4 | Chat 初始 defaultModel 变化、Settings view effect、Models 关闭导致浏览器重复 `/api/models`，且没有共享 flight | 高 | React 依赖链确认 |
| H5 | 首次 `ModelRuntime.create` 的 network refresh 在真实凭据/远程 catalog 下接近 timeout | 中高 | SDK 默认值确认；需 cold/real-credential trace 定量 |
| H6 | 15 秒 auth/AnyRouter 文件锁等待是分钟级主因 | 低（当前样本） | 当前无残留锁；只可能是 H2/H3 的放大器 |
| H7 | `/api/web-config` scheduler await 导致 Settings 壳层 5–6 分钟 | 低（当前样本） | 当前 3ms；必须用慢现场 HAR 才能升级 |

## 推荐结论

优先修复共享 `/api/models` 的服务端纯读热路径与前端请求去重，不先改 React 展示结构，也不把 #23 已解决的 Models verify 路径重新设计。先用 instrumentation 证明 refresh/read/write 次数归零或显著收敛，再决定是否需要改 `WebCredentialStore` 的通用读取模型。
