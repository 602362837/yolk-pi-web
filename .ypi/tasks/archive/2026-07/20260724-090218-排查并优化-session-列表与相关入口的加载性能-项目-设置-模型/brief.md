# Brief：project/space session 列表加载性能

## 任务背景

用户已选择 **方案 B：逻辑分片 / 索引优先，暂不物理迁移 JSONL**。目标是让某一 project/space 的列表只处理该 space 的候选 session，避免每次请求先扫描 `~/.pi/agent/sessions/**` 的全部约 300 个文件，再过滤出 1–22 个结果。

## 已核证现象

- `GET /api/projects/:projectId/spaces/:spaceId/sessions` 实测约 13–29s。
- `inventory` 约 7–13s；`studioProjection` 约 6–16s；`studioProjectionCalls=182`。
- 样本约 `activeSessions=297`、`studioChildren=182`，而目标 space 的 `linkedRoots` 通常仅 1–22。
- 设置页和模型页主要调用 `/api/web-config`、`/api/models`、`/api/models-config`，不直接扫描 session；其半分钟体感主要是同进程全量 I/O 与同步 Studio task 投影造成的间接争用，不能误判为这三个接口共享同一业务查询。

## 代码证据

1. `app/api/projects/[projectId]/spaces/[spaceId]/sessions/route.ts` 调用 `listAllSessions({ includeStudioChildren: true, includeStudioChildDisplay: true })`，之后才按 `projectId/spaceId` 过滤。
2. `lib/session-reader.ts` 的 `listAllSessionsUncached()` 调用 `scanSessionInventory()`；`lib/session-metadata-scanner.ts` 会枚举全局 active session 目录并流式扫描每个 JSONL。
3. `projectStudioChildDisplay()` 的 task 读取按 child 执行，缓存仅 1s；全局 child 先投影、目标 space 后过滤，形成明显 N+1。
4. `lib/project-session-index.ts` 已维护 `~/.pi/agent/pi-web-session-index.json`，但列表热路径未读取；其覆盖不完整，且 JSONL header 才是 project/space 关联真相。
5. Pi SDK 默认布局已经按 cwd 分目录：`~/.pi/agent/sessions/<encoded-cwd>/*.jsonl`；因此可以对 space cwd 做定向目录核对，但必须兼容 symlink/realPath、历史 alias 和显式 header link。
6. `components/SessionSidebar.tsx` 已有 generation token 与 `AbortController`，本任务不重复改造已落地的请求取消逻辑。
7. create/fork 当前只写全局 sidecar；rename/archive/unarchive/delete、WorkTree cwd 删除和 Studio child 创建没有统一的本地 space-index 生命周期。

## 选定方向

- 每个 registry space 在其**自身物理根目录**保存独立索引：`<space-root>/.ypi/sessions/index.v1.json`。
  - main：`project.rootPath/.ypi/sessions/index.v1.json`。
  - worktree：`worktree space.path/.ypi/sessions/index.v1.json`，不集中回 main root。
- JSONL 继续留在 `getAgentDir()/sessions/**`；项目内文件只是候选集与摘要缓存，不是会话内容真相。
- 热路径：本地索引 + 该 space 对应 encoded-cwd 目录定向核对 + 候选文件 stat/header 校验；只对变化文件扫描摘要。
- 索引缺失、损坏或覆盖不明时，执行一次**全局 header-only 恢复扫描**并重建本地索引；不得返回静默缺项的 200。
- Studio child 保持现有可见语义，但只对已筛入该 space 且父 root 可见的 child 做按 task 去重的批量投影。
- `.ypi/sessions/` 精确忽略；不得忽略整个 `.ypi/`。

## 性能目标

在本机约 300 sessions / 180 Studio children 规模：

- 完整/热索引：space session route **P50 ≤ 500ms、P95 ≤ 1.5s**，单次请求不调用全量 `scanSessionInventory()`，不为全局 180 个 child 做投影。
- 冷启动或索引恢复：header-only 重建目标 **P95 ≤ 5s**，请求硬预算 10s；超预算且没有 last-good 数据时返回可重试错误，不返回缺项列表，并输出内容安全的阶段日志。
- session 列表并发加载时，`/api/web-config`、`/api/models`、`/api/models-config` 不再出现由 session 全量扫描造成的 10s 级额外阻塞；并发 P95 相对各自隔离基线的新增延迟目标 ≤ 500ms。

## 范围约束

- 不移动、不改写历史 JSONL；不改变 Pi SDK session 存储约定。
- 不改变 Sidebar 的信息结构、child 行语义、loading/error UI 或 API 成功响应字段。
- 不把旧全局 sidecar升级为主读路径。
- 模型 runtime/provider 冷启动本身的优化属于第二批，只有在 session 修复后的隔离基准仍慢时再立项。
