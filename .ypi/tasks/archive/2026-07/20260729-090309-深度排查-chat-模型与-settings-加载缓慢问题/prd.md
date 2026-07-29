# PRD — Chat / Settings 模型目录加载性能

## 目标与用户价值

让 Chat 模型选择器与 Settings 中所有模型策略控件快速、稳定地获得同一份本地模型目录；慢 provider、真实 OAuth、并发打开 Settings、切换设置页或关闭 Models 都不得形成分钟级队列。模型目录读取不得修改认证文件。

## 范围内

1. `GET /api/models` 的 runtime、provider 注册、availability/auth 扫描、缓存与失效。
2. AnyRouter 在 fixed-provider 目录装载时的重复 reconcile/无条件写。
3. Chat 与 `SettingsConfig` 的 `/api/models` 请求去重、生命周期和错误处理。
4. 分阶段 timing/counter、cold/warm/concurrent 回归基线。
5. `models.json`、auth/account/model mutation 后的显式目录失效。

## 范围外

- 不改变模型选择器、Settings IA、字段或视觉。
- 不改变 inference/session runtime 隔离；Chat 真正启动 AgentSession 仍使用独立 runtime。
- 不改变 OAuth、账号、quota、AnyRouter retry/failover 产品语义。
- 不修改/迁移用户 `auth.json`、`models.json`、账号池或 Session JSONL。
- 不重新实现 #23 的 Models 弹窗 progressive summary/verify。

## 需求与验收标准

### R1 目录 GET 纯读

- `/api/models` 不得因读取目录而改变 `auth.json`、AnyRouter runtime bridge 或 managed account metadata 的内容/mtime。
- 允许明确的账号/config mutation 路径重建 mirror；不得借目录 GET 做隐式修复写。

### R2 离线共享目录 runtime

- `/api/models` 使用固定 provider 的 admin catalog runtime/service，不创建 session runtime，不加载 cwd 项目扩展。
- catalog 初始化/refresh 明确 `allowNetwork:false`。
- 同 key 冷并发共享一个初始化和一个 refresh flight；失败清 pending，后续可重试。
- inference/Studio/session runtime 仍保持隔离。

### R3 有界 refresh 与读取

- 单个 catalog generation 不得因四个 provider 注册产生未追踪、响应后仍继续的 refresh 队列。
- 路由使用已刷新 snapshot，不再调用会额外触发 availability scan 的 `getAvailable()`。
- instrumentation 能给出每请求/runtime 的 fixed-provider load、availability refresh、credential raw-read、queue-wait、mirror-write计数。

### R4 一致失效

- models config 保存/同步/价格修改、认证登录/登出/Activate/账号 mutation 成功后，使共享 catalog 失效或推进 epoch。
- 失效后首个请求重建；同一 epoch 其余请求共享。
- 失败 mutation 不失效，不发布半成品。

### R5 浏览器去重

- Chat 初始 `defaultModel` 从未知变为具体值时，不重复下载同一 catalog generation。
- Chat 与 Settings 同时请求共享一个客户端 flight/cache；Settings 在 `yolk/studio/terminal/trellis` 间切换不重复请求，除非显式失效/重试。
- 关闭 Models 后可显式失效一次；不能为每个消费者各自产生一轮并发请求。
- 请求具备 AbortController + generation guard；旧响应不能覆盖新 catalog。

### R6 兼容性

- `/api/models` 成功响应字段保持：`models`、`modelList`、`defaultModel`、`thinkingLevels`、`thinkingLevelMaps`。
- provider/model id、display name、thinking map 与当前行为一致。
- 配置了 `yolk.defaultModel` 但当前目录不可用时，现有 fallback 口径不变。

### R7 性能门禁

在隔离数据目录、固定依赖、无真实网络的 30142 基线中：

- warm `/api/models` p95 ≤ 500ms；
- cold first usable ≤ 3s；
- 8 并发 p95 ≤ 单请求 warm 的 2 倍，且只发生一个 server catalog flight；
- Settings `/api/web-config` p95 ≤ 200ms，且模型目录慢不阻塞设置壳层；
- 请求结束后 1s 内相关 queue/pending 计数为 0。

真实凭据环境另做 UAT：任何 catalog 请求不得发 provider 网络；p95 不得随 OAuth provider 数线性增长。

## 非功能约束

- 日志只记录 stage ms、计数、cache hit/epoch、固定错误码；不记录路径、key/token、账号 id、模型 config 原文。
- 不降低 auth/mirror 原子写与跨进程锁安全。
- 不通过长期 stale 数据掩盖 mutation；TTL 只是防抖，epoch/invalidation 才是正确性边界。

## 未决问题

1. 用户所说“Settings 加载 5–6 分钟”是整个“正在加载设置…”还是默认模型控件无数据？主会话应向用户确认或获取 HAR。
2. 若后续要新增可见的超时、重试、降级提示，需另走 UI 设计员 HTML 原型和用户审批；本计划 P0 不改变 UI 信息结构。
