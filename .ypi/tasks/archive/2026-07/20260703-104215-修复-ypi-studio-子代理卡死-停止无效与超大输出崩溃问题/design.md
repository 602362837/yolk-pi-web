# design

## 1. 根因假设与 ERR_STRING_TOO_LONG 关联判断

高置信根因在 `lib/ypi-studio-extension.ts` 的 `runChildPi()`：

- `const stdout: Buffer[] = []; const stderr: Buffer[] = [];` 会保存所有 child 输出。
- `flushStdoutLines()` 每个 chunk 都 `stdout.push(chunk)`，并通过 `stdoutBuffer += chunk.toString("utf8")` 累加未换行内容；如果 child 连续输出一个超长行，`stdoutBuffer` 本身会变成超大字符串。
- `stderr` 同样完整保存，虽然 transcript item 会截断，但原始 `stderr` Buffer 不截断。
- `finish()` 中 `Buffer.concat(stdout).toString("utf8")` / `Buffer.concat(stderr).toString("utf8")` 会一次性创建巨大字符串；V8 单字符串上限约 `0x1fffffe8`，与用户报错完全吻合。
- `extractAssistantText(stdout, stderr)` 再 `split` 全量 stdout，进一步放大内存与 CPU 风险。
- live progress 的 `lastTextPreview`、`finalAssistantOutput`、`lastMessageText` 在部分分支可能保存超大字符串，随后经 SSE `JSON.stringify` 发送，也可能造成服务端/浏览器压力。

stop 无效的关联假设：当 child 输出导致事件循环/内存压力，或 `child.kill()` 只杀直接进程且无强杀/进程组处理时，parent tool promise 不 resolve，`AgentSession.abort()` 等待 idle，从而主 session stop 看起来无效。

## 2. 最小可行修复：输出缓冲上限、流式处理、截断

### 核心原则

- 不再为 final extraction 保存完整 stdout/stderr。
- stdout 只做流式 JSONL 解析；最终文本优先取已解析的 `message_end` assistant content。
- 所有进入 transcript、progress details、tool result、UI raw debug 的字符串都必须有硬上限。

### 建议常量（首版硬编码）

- `MAX_STDOUT_BYTES = 16 * 1024 * 1024`
- `MAX_STDERR_BYTES = 1 * 1024 * 1024`
- `MAX_STDOUT_LINE_BYTES = 1 * 1024 * 1024`
- `MAX_FINAL_OUTPUT_BYTES = 256 * 1024`
- `MAX_LIVE_PREVIEW_BYTES = 4 * 1024`
- `MAX_LIVE_ITEMS = 12`
- `MAX_TRANSCRIPT_BYTES = 5 * 1024 * 1024`

### `runChildPi()` 调整

- 用 `StringDecoder` 处理 stdout chunk，避免 UTF-8 截断。
- 删除 `stdout: Buffer[]` / `stderr: Buffer[]` 和结束时的 `Buffer.concat()`。
- 新增 bounded accumulator：
  - 统计 total stdout/stderr bytes。
  - 保留小 tail 仅用于 fallback/debug。
  - 超限时记录 warning，并终止 child（建议 status=failed，reason=output_limit），或至少丢弃后续原始输出。
- `stdoutBuffer` 增加单行上限；超过上限时：记录 “stdout line truncated/exceeded” warning，清空/截断当前 line，并终止 child，防止没有换行的无限 JSON/日志拖垮进程。
- `finalAssistantOutput` 通过 `message_end` 流式更新，写入前截断到 `MAX_FINAL_OUTPUT_BYTES`。
- `lastTextPreview` 始终走 `truncateForLivePreview()`，不要保存原始大块。
- `lastMessageText` 不保存完整 assistant message；若需要计算 delta，只保存 bounded tail 或仅用 `outputChars` 计数。
- `extractAssistantText()` 改为只接受 bounded tail，或删除并改为：`finalAssistantOutput || boundedStdoutTail || boundedStderrTail || status fallback`。
- `progressSnapshot()` 返回的 `itemsPreview` 再做 live 级别截断，避免 12 * 16KiB 每 450ms 发送过大。

### transcript/API 调整

- `lib/ypi-studio-transcripts.ts` 已有单 item 16KiB 与 API 256KiB 限制，但 sidecar 文件总量仍可无限增长；新增 writer 总字节上限，超过后：
  - 写入一次 status warning（若空间允许）。
  - `ref.truncated = true`。
  - 后续 append 跳过或只更新 meta，不再无限写盘。
- `readYpiStudioSubagentTranscript()` 不建议 `full=1` 使用 `Infinity`；保留硬响应上限或提高到安全上限（例如 1-2MiB）。

## 3. stop/cancel 级联到 child process

### 新增 server runtime registry

新增 `lib/ypi-studio-subagent-runtime.ts`，避免 `rpc-manager.ts` 与 `ypi-studio-extension.ts` 循环依赖：

- `registerYpiStudioChildRun(handle)`
- `unregisterYpiStudioChildRun(runId)`
- `abortYpiStudioChildRunsForSession(parentSessionId, reason)`
- 可选：`abortYpiStudioChildRun(runId, reason)` / `listYpiStudioChildRuns()`

handle 字段：`runId`、`taskId`、`member`、`cwd`、`parentSessionId`、`pid`、`startedAt`、`abort(reason)`。

### 传入 parent session id

在 `ypi_studio_subagent.execute()` 从 `ctx.sessionManager.getSessionId()` 读取 parent session id，传给 `runChildPi()` meta。child spawn 成功后注册到 registry，finish/close 时 unregister。

### 进程组与强杀

- POSIX：`spawn(..., { detached: true, stdio: [...] })` 创建独立进程组；停止时先 `process.kill(-pid, "SIGTERM")`，grace 后 `process.kill(-pid, "SIGKILL")`。
- Windows：先 `child.kill()`，必要时 `taskkill /pid <pid> /T /F`。
- 不调用 `unref()`，避免进程生命周期失控。
- abort handler 应幂等；close、error、timeout、AbortSignal 可竞态到达。

### 接入主 session abort/destroy

- `lib/rpc-manager.ts`：`AgentSessionWrapper.send({type:"abort"})` 先调用 `abortYpiStudioChildRunsForSession(this.sessionId, "parent_abort")`，再执行 `inner.abort()`。
- `AgentSessionWrapper.destroy()` 同样级联 `abortYpiStudioChildRunsForSession(this.sessionId, "session_destroy")`。
- abort 等待建议加短超时保护：child kill 已发出后，若 `inner.abort()` 长时间不返回，route 返回 `{ aborted: true, timedOut: true }` 并记录 warning，避免 stop HTTP 请求挂死。
- `app/api/agent/[id]/route.ts`：当 command 是 abort 且没有 alive session 时，不应启动新 session；可尝试 registry abort 后直接返回 success/running=false。

## 4. 子代理卡死/无进展检测与 timeout 策略

定义 `lastActivityAt`：spawn、stdout chunk、parsed event、stderr chunk、tool update、message end 都算活动。

建议策略：

- `NO_FIRST_EVENT_WARN_MS = 60_000`：启动后 60s 没有任何 JSON event，发送 warning progress，但不立即杀。
- `CHILD_IDLE_TIMEOUT_MS = 10 * 60_000`：超过 10min 无 stdout/stderr/parsed event，终止 child，status=failed，warning=`idle_timeout`。
- `CHILD_MAX_RUNTIME_MS = 60 * 60_000`：总运行超过 60min，终止 child，status=failed，warning=`max_runtime`。
- `KILL_GRACE_MS = 2_000`，`KILL_HARD_GRACE_MS = 5_000`：TERM 后强杀；强杀仍无 close 时让 promise 以 cancelled/failed resolve，并保留 warning “process may still be alive”。

状态兼容：不新增 run status，避免 UI/API 破坏。timeout/output_limit 使用 `status="failed"` + `progress.warnings` / optional `progress.terminationReason` 表达；用户主动 stop 使用 `status="cancelled"`。

## 5. 终止后恢复建议

- `cancelled`：用户 stop，task workflow 状态保持不变；主 session 可重试同一 member/prompt，或继续当前阶段。
- `failed` + `idle_timeout/output_limit/max_runtime`：保留 transcript tail 与 warning；不要自动推进 workflow。主 session 应决定缩小 prompt、调整模型、重试，或把任务转为 `blocked`。
- `waiting_for_user`：维持现有设计，向父会话暴露子成员交互请求，不让父 session无限等待。
- 孤儿 running run（服务重启/崩溃）：UI 可显示 stale；后续可加 API 将 running run 标记 failed。MVP 中可通过主 session 重新派发子代理并让旧 run 留作历史。

推荐 UI 操作优先级：

1. MVP 文案提示：重试 / 从当前阶段继续 / 标记任务 blocked 或 cancelled。
2. 后续按钮：Retry（复用 member/prompt）、Mark failed（patch run）、Continue phase（插入 `/studio-continue`）。

## 6. 影响文件

- `lib/ypi-studio-extension.ts`：重构 `runChildPi()` 输出处理、timeout、kill、progress 截断、final output 提取。
- `lib/ypi-studio-subagent-runtime.ts`（新增）：全局 child run registry 与跨模块 abort。
- `lib/rpc-manager.ts`：abort/destroy 级联 child registry；可选 abort wait timeout。
- `app/api/agent/[id]/route.ts`：abort 不启动新 session；返回 abort 结果。
- `app/api/agent/[id]/events/route.ts`：可选增加 SSE encode 保护/过大事件降级，但核心依赖上游 YPI 输出有界。
- `lib/ypi-studio-transcripts.ts`：sidecar 总大小上限；`full=1` 仍保留硬响应上限。
- `lib/ypi-studio-types.ts`：如实现 `terminationReason` / truncation metadata，添加 optional 字段；不要改现有 status union。
- `lib/ypi-studio-tasks.ts`：如需要规范化新 optional 字段或 stale projection，更新 normalize/read 逻辑。
- `components/YpiStudioSubagentTranscript.tsx`：展示截断/timeout/cancelled 恢复提示。
- `components/YpiStudioSessionWidget.tsx`：展示 failed/cancelled/stale/warnings 的短状态。
- `docs/modules/library.md`、`docs/architecture/overview.md`：实现后更新 YPI Studio lifecycle/输出上限说明。

## 7. 风险与兼容性

- 过小输出上限可能截断有价值结果；用 warning 与 transcript tail 缓解，阈值可后续配置化。
- `detached: true`/进程组 kill 在不同平台行为不同；Windows 需 taskkill fallback。
- abort 超时提前返回可能让 UI 认为已停，但底层 agent 仍在收尾；需通过 run warning/后续 agent_end 同步。
- transcript 总量上限会减少长会话调试信息，但避免磁盘与 API 风险。
- 不新增 status 可保持兼容，但 timeout 原因只能通过 warnings/optional 字段表达。
