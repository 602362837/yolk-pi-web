# Brief: 左侧 session 列表偶发加载缓慢

## 问题陈述

左侧 session 列表按项目空间加载时存在明显长尾。当前链路为：

`SessionSidebar.loadSessions` -> `GET /api/projects/:projectId/spaces/:spaceId/sessions` -> `listAllSessions()` -> `SessionManager.listAll()` 全量扫描 active session -> 每个文件再次读取首行 -> 可选读取 Studio task 详情 -> 路由过滤目标空间并扫描 archive 目录。

## 证据与初步根因

1. **目标空间请求仍全量扫描。** 专用 project-space route 调用 `listAllSessions({ includeStudioChildren: true, includeStudioChildDisplay: true })`，先处理所有 active session，最后才按 `projectId/spaceId` 过滤。
2. **重复 I/O。** `SessionManager.listAll()` 已生成 session 摘要，`listAllSessions()` 又逐文件同步读取首行以取 project/space/Studio 元数据；`scanArchivedCwds()` 每次请求还同步遍历 archive 目录。
3. **Studio 标题投影放大全量扫描。** `includeStudioChildDisplay` 对每个 Studio child 调用 `projectStudioChildDisplay()`，后者读取 task detail，未按 task 去重；子会话多时会重复解析同一 task。
4. **性能索引未进入读取链路。** `pi-web-session-index.json` 已在新建/fork时维护，也提供 `listIndexedSessionsForSpace()`，但 sessions route 没有调用。当前本机索引覆盖 16/50 active session，不能直接作为唯一真相。
5. **前端会制造重复请求。** `loadSessions` 依赖整个 `projects` 数组；`loadProjects` 更新数组后会重建 callback 并触发 sessions effect。刷新按钮又同时调用 `loadProjects(false)` 和 `loadSessions(false)`，因此一次刷新通常会产生当前请求加 projects 更新后的第二次请求。token 只阻止旧响应写 state，不取消服务端工作。
6. **竞态保护不完整。** token 能避免旧空间响应覆盖新空间，但没有 `AbortController`，切换/刷新后的过期请求仍继续占用服务端扫描和事件循环。
7. **列表渲染不是首要瓶颈。** `buildSessionTree()` 为当前空间范围 `O(n + Σ k log k)`；当前没有虚拟化，但相较全局文件扫描，只有单空间达到数百/数千行时才可能成为主要问题。

本机只读样本：50 个 active JSONL、约 22 MB，其中 34 个含 `studioChild`；连续 HTTP 探测观察到约 0.27s 至 11.58s 长尾。该探测使用无效 project id 并在 registry 校验处返回 404，只能证明进程存在长尾，不能替代完整 route 基准。

## 推荐方向

- 先增加服务端分阶段计时和请求相关 id，确认长尾落在 registry、SessionManager、header、Studio projection、archive 还是 JSON serialization。
- 前端将请求身份收敛为稳定的 `projectId/spaceId`，刷新串行/合并，并 abort 过期请求。
- 服务端增加 single-flight 的 session summary snapshot；按文件 `path + mtime + size` 复用未变化摘要，并按 task id 去重 Studio title projection。
- 将 project-session index 用作候选加速和写穿数据源，但在覆盖率不足、文件缺失或元数据不一致时回退/修复，不能把 best-effort sidecar 升格为真相。
- archive count 独立缓存或按 archive 目录变更失效，避免每次 active list 请求全量重扫。

## UI 门禁

当前推荐方案不改变用户可见信息、加载状态或交互，只优化同一契约和时延，因此不触发 UI 原型门禁。若采用 stale-while-revalidate、保留旧空间列表、骨架屏、性能提示或任何加载状态改版，必须先派发 `ui-designer` 产出 HTML 原型并由用户审批。

## 待确认决策

1. 是否接受第一版只做内部计时、请求去重、abort、single-flight/增量缓存，不改变加载 UI（推荐：接受）。
2. 缓存新鲜度目标：推荐 active list 最多允许 1 秒进程内复用，同时由新建/fork/archive/delete/rename 显式失效；跨进程仍以文件为真相。
3. 是否要求支持外部进程直接写入 session JSONL 后 1 秒内出现在侧栏（推荐：要求；因此不能只读 sidecar index）。
