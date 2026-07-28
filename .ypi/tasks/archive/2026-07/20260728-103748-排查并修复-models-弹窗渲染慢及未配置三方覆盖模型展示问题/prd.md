# PRD — Models 弹窗渐进加载与覆盖项过滤

## 目标与背景

Models 弹窗同时承担 models.json 编辑、OAuth/managed account 入口和 API Key provider 管理。当前首屏 provider summary 会触发潜在认证刷新，导致本机出现 3–4 秒波动；同时，模型价格等功能写入的 `modelOverrides` 会让未配置 provider 以空节点出现在左树。

目标是：弹窗立即可见、本地配置先可操作、认证目录渐进加载；导航只展示用户当前可操作的 provider/model，不把纯覆盖元数据误当成已配置 provider。

## 用户价值

- 点击 Models 后立即获得稳定反馈，不再等待网络认证检查才看到有效内容。
- 左侧列表减少空节点与重复节点，真实自定义模型更容易找到。
- 模型价格和其他覆盖配置完整保留，不因 UI 过滤而丢失。

## 范围内

- Models 弹窗首屏与 provider catalog 的加载解耦。
- OAuth provider summary 使用本地状态投影，不主动做网络认证验证。
- 管理 ModelRuntime 冷启动 single-flight。
- `/api/auth/all-providers` 的本地聚合去串行/去重复扫描。
- 纯 `modelOverrides` provider 的导航过滤与重复消除。
- provider catalog 加载中/失败/重试状态。
- 对应纯逻辑、API/回归测试和模块文档。

## 范围外

- 不重构 6313 行 `ModelsConfig.tsx` 的全部子组件。
- 不做模型树虚拟化、搜索、折叠或信息架构改版。
- 不迁移/清理已有 `modelOverrides`。
- 不改变账号激活、OAuth 登录、额度刷新或 API Key CRUD。
- 不改变模型价格功能写入路径。
- 不修改 fixed provider 包或依赖版本。

## 需求与验收标准

### R1 — 弹窗壳体即时反馈

- 点击 Models 后无需等待任何 API 完成即可渲染 modal shell。
- `models.json` 内容完成后立即显示，不等待 auth provider catalog。
- 认证目录未完成时显示紧凑、非阻塞的加载状态。

### R2 — 本地 summary 先返回，在线验证只在后台合并

- Models 首屏使用的 OAuth provider summary 路径不得调用 `runtime.checkAuth()` 或 provider 外部网络。
- summary 的 `localConfigured` / account metadata 表示本地 stored/managed Active 存在，不承诺上游凭证仍有效，并且是 provider 行可见性与账号数量的权威来源。
- 本地 summary 成功提交后，可在后台启动有界 `checkAuth()`/刷新验证；该请求不得阻塞 modal、config tree、provider 点击或保存。
- 后台验证只能更新同一 provider、同一 `localStateRevision` 的 verification 状态；不得覆盖较新的账号数量、Active 名称、本地 configured 状态或用户 selection。
- 验证失败、超时、被新 mutation 取代时保留本地状态；进入 provider 详情后的 accounts/quota/auth 流程继续负责真实校验与恢复提示。

### R3 — 冷并发只初始化一个管理 runtime

- 同一 canonical `agentDir + modelsPath` 的并发 `getWebModelRuntime()` 共享一个初始化 Promise，固定 provider 只注册一次。
- 同 key 的并发 offline refresh 也应 single-flight；Models 本地 summary 不得等待后台 provider `checkAuth()`。
- 初始化或 refresh 失败后清除对应 pending entry，后续可重试；失败不得写入 resolved cache。
- 测试 reset 同时清除 resolved cache、初始化 pending 与 refresh pending。

### R4 — 覆盖项过滤

- provider config 仅含一个有效 `modelOverrides` 字段时，不渲染 raw models.json provider 行。
- 过滤只影响显示；保存任何其他编辑时，该 provider 及其 overrides 字节语义不被删除/清空。
- provider 若通过 OAuth/API Key 已配置，仍通过 active provider 行显示。
- provider 有 `models[]` 或除 `modelOverrides` 外任一配置/未知字段时继续显示，避免误隐藏未来配置。
- 空/畸形 provider config 不由该规则擅自修复。

### R5 — 不重复展示

- 同一 provider 由 auth catalog 显示时，不因 override-only raw config 再出现第二行。
- 有自定义 `models[]` 的同名 provider 保留 raw config 编辑入口；是否同时存在 auth 行沿用现有能力边界，不在本任务强行合并两个不同详情视图。

### R6 — 降级、超时与重试

- provider 本地 catalog 请求失败或超时时，已加载 models.json 树保持可用。
- 左树显示固定、安全的失败提示与重试入口；不得展示 raw credential/provider exception。
- 后台 verification 失败/超时不把本地成功状态降级成 catalog error，不清空 provider 行，也不自动重试形成请求风暴。
- 重试、重复打开与 mutation 后刷新必须使旧 generation 失效；即使底层 fetch/`checkAuth()` 不响应 abort，晚到结果也不得提交。
- 关闭弹窗后 AbortController、generation 与 active lifecycle 三重保护阻止未完成请求、timer、EventSource 继续更新已卸载实例。

### R7 — 性能验收

- 结构性门禁：summary 路径零 `checkAuth()`；管理 runtime 同 key init/offline-refresh single-flight；models config 不等待 catalog；后台 verify 不位于首屏关键路径。
- 同一 provider + 同一 local state 的并发/重复后台验证最多执行一次真实 `checkAuth()`；短 TTL 内重复打开复用安全验证缓存。
- 本机人工基准：记录修改前后每个 endpoint 连续 5 次耗时；warm provider summary 目标不高于 500ms，若环境 I/O 波动超标必须附数据解释。
- 浏览器人工验证：点击后一个 animation frame 内出现 shell/loading；配置树可见时间只取决于 `/api/models-config`，在线验证慢或超时不改变该时间。

### R8 — 兼容与安全

- 维持 models-config GET/PUT body、ETag/revision 与 CAS 行为。
- API 改动采用 query mode 与 additive 字段：默认完整验证语义保持兼容，Models 显式使用 summary → background verify 两阶段。
- `localStateRevision` 必须是不透明、进程盐化的安全版本标记；不得由浏览器反推出账号 id、token、key、路径或凭据内容。
- 不新增 secrets、paths、tokens、raw upstream errors 到 API/DOM/log；HTTP 仍为 `Cache-Control: no-store`，短 TTL 仅是服务端进程内验证缓存。

### R9 — 异步竞态正确性

- config、catalog、provider detail 各自拥有独立 request generation；一个 lane 的晚到响应不能写另一个 lane。
- 每次 catalog retry、provider mutation、账号 mutation、provider/account 切换都会先使旧 generation 失效并 abort 旧读请求，再启动新请求。
- provider/account mutation 的成功响应优先于 mutation 前启动的 GET；旧 GET 即使晚到也不能覆盖 POST 返回的新账号/Active 状态。
- OAuth/Grok/Kiro/Antigravity/Codex quota 与 account list 均按 `{ lifecycle, providerId, accountId, generation }` 校验；不能只保护 Antigravity。
- 用户 selection 由用户操作或“当前项已被最新本地投影删除”的确定性 fallback 改变；后台验证不得重排、隐藏或自动切换 selection。
- 共享服务端 verification flight 不因一个浏览器请求 abort 而取消其他 waiter；内部 deadline 后的底层晚到结果不得写 cache/response。
- 写请求不承诺因关闭弹窗而回滚；关闭后仅忽略其 UI 回调，重开时由本地 summary 读取最终服务端事实，且不得自动重放 mutation。

## 已确认产品口径与审批余项

1. 已按确认方向采用 `/api/auth/providers?mode=summary` 首屏本地投影，并在其成功后非阻塞调用后台 verify；默认 route 的完整验证语义保留。
2. 已确认仅 `modelOverrides` 的 raw provider 从导航隐藏但数据保留；验证结果不改变此过滤口径。
3. 黄色“覆盖项保留”说明只留在审批原型，不进入生产 UI；现有 HTML 原型无需因竞态方案改版。
4. 仍需主会话记录 HTML 原型与完整计划的正式审批，保存 implementationPlan 后才可进入实现。
