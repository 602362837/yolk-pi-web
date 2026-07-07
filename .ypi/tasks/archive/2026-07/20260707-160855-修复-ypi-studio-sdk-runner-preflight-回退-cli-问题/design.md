# Design

## 根因

`SessionManager.create()` 会分配 session id/file path，但不会立即落盘 JSONL。`lib/ypi-studio-child-session-runner.ts` 当前在 prompt 前调用 `writeSessionHeader(childSessionFile, ...)`，该 helper 会 `readFileSync(filePath)`，文件不存在时抛 `ENOENT`。在 `auto` 模式下此错误被视为 SDK preflight 失败并回退 CLI。

## 方案

### 1. 延迟/确保 SDK child header 写入

在 SDK child runner 中新增安全的 header 初始化方式：

- 优先使用 Pi SDK/SessionManager 已有 header 写入 API（若存在）。
- 若没有公开 API，则在 `childSessionFile` 不存在时主动创建最小 session header JSONL，字段与现有 SessionManager header 兼容：`type=session`, `id`, `cwd`, `timestamp`, `parentSession` 等，再合并 `projectId/spaceId/studioChild`。
- 若文件已存在，则保留原有 first-line merge 行为。

实现建议：把 `writeSessionHeader()` 改造为 `ensureAndWriteSessionHeader(filePath, baseHeader, patch)` 或同名 helper，使它能处理不存在文件。

### 2. 保留 SDK preflight 诊断

`lib/ypi-studio-extension.ts` 的 auto fallback 分支已经构造 `warnings`，但最终 run 里容易被后续 CLI snapshot 覆盖。需要：

- 将 SDK preflight error 存到 `ChildRunMeta` 或 CLI fallback meta warnings 中。
- CLI `runSnapshot()` / final result 合并 preflight warnings。
- fallback run summary 明确包含错误摘要。

### 3. 强制 sdk async 失败持久化

当前 async start 返回后，如果 SDK preflight Promise 很快 reject，runtime handle 可能未注册，后续 poll/collect 只看到 `runtime_lost`。需要在 `childPromise.catch` 或 SDK branch catch 中：

- 对非 auto fallback 错误调用 `persistRunSnapshot(failedRun)`。
- finalized transcript status=failed。
- unregister runtime handle。
- 让 async wait/collect 读到真实 failed run，而不是 runtime_lost。

### 4. 验证脚本

增加小型脚本（建议 `scripts/test-ypi-studio-sdk-runner.mjs`）：

- 使用项目 ts loader 导入 `runYpiStudioSdkChildSession` 或更低成本 helper。
- 验证 `SessionManager.create()` 后不存在文件时 helper 能创建 header。
- 可选：不发真实模型请求，只测试 header helper；真实 SDK smoke 作为手工/可选命令。

## 风险

- 手写 header 必须与 Pi session reader 兼容。
- 不应把 child session 暴露到普通 Sidebar 根列表；已有 `studioChild` 过滤保持不变。
- fallback 诊断不应污染用户主聊天内容，只进入 run warnings/summary。
