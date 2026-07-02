# Implement

## 需先阅读的文件

- `AGENTS.md`
- `docs/modules/frontend.md`
- `docs/modules/api.md`
- `docs/modules/library.md`
- `docs/integrations/README.md`
- `lib/ypi-studio-extension.ts`
- `lib/ypi-studio-tasks.ts`
- `lib/ypi-studio-types.ts`
- `hooks/useAgentSession.ts`
- `components/ChatWindow.tsx`
- `components/MessageView.tsx`
- `lib/types.ts`
- Pi docs for custom tool progress:
  - `node_modules/@earendil-works/pi-coding-agent/docs/extensions.md` (`pi.registerTool`, `onUpdate`)
  - `node_modules/@earendil-works/pi-coding-agent/docs/rpc.md` (`tool_execution_update` accumulated partialResult)

## 执行步骤

### 1. 定义 transcript 类型与 helper

1. 在 `lib/ypi-studio-types.ts` 新增：
   - `YpiStudioSubagentTranscriptRef`
   - `YpiStudioSubagentTranscriptItem`
   - `YpiStudioSubagentTranscriptResponse`
   - `YpiStudioTaskSubagentRun.transcript?: YpiStudioSubagentTranscriptRef`
2. 新增 `lib/ypi-studio-transcripts.ts`：
   - safe task/run id normalization。
   - `createYpiStudioSubagentTranscript(root, taskId, runMeta)`。
   - `appendYpiStudioSubagentTranscriptItem(writer, item)`。
   - `finalizeYpiStudioSubagentTranscript(writer, status)`。
   - `readYpiStudioSubagentTranscript(root, taskId, run, options)`。
   - per-item preview/truncation helpers。
3. 设计默认限制：
   - single item preview 8-16KB。
   - partial update preview 16-32KB。
   - API default response 128-256KB 或 200 items。

### 2. 扩展 task run 持久化

1. 在 `lib/ypi-studio-tasks.ts` 的 `normalizeTaskRecord()` 保留旧 run，并读取可选 `transcript`。
2. `recordYpiStudioSubagentRun()` 允许同 runId 多次覆盖：start 写 running，finish 写 succeeded/failed/cancelled。
3. subagent event data 增加轻量 transcript ref：`data: { runId, status, transcript }`。
4. 确保 `task.json` 不写 full transcript/items。

### 3. 改造 `ypi_studio_subagent` 执行

1. 在 `lib/ypi-studio-extension.ts` 定义本地 `ToolUpdateCallback` 类型，而不是 `_onUpdate?: unknown`。
2. `execute()`：
   - 生成 `runId` 后立即创建 transcript writer。
   - 记录 prompt item（delegated prompt，非隐藏 system/developer）。
   - 调用 `recordYpiStudioSubagentRun(... status: "running" ...)`。
   - 先 `onUpdate` 一次：child process starting。
3. `runChildPi()`：
   - stdout 按行 buffer；每行 JSON parse。
   - 识别 `message_end`、`tool_execution_start/update/end`、`agent_start/end`、legacy `tool_result_end`。
   - 写入 transcript item，更新 counters、lastTextPreview、final assistant output。
   - stderr chunk 写 bounded stderr item。
   - 节流调用 `onUpdate({ content, details: { run: { ..., transcript, progress } } })`。
   - abort 时标记 cancelled；close code non-zero 标记 failed。
4. finish：
   - finalize transcript ref。
   - `summary` 继续使用 final assistant output 的 one-line 版本。
   - `details: { task, run }` 中包含 run.transcript。
   - `content` 仍返回 final output，保证主 agent 行为兼容。
5. transcript 写入异常：
   - 捕获并记录 warning；不要让工具因无法写 sidecar 而完全失败，除非 child 本身失败。

### 4. 新增 transcript API

1. 新建 `app/api/studio/tasks/[taskKey]/subagents/[runId]/transcript/route.ts`。
2. GET 流程：
   - 读取 `cwd`，用 `getAllowedRoots` / `canonicalizeCwd` / `isPathAllowed` 授权。
   - 校验 `taskKey`、`runId`。
   - `getYpiStudioTaskDetail()` 找 task 和 run。
   - run 无 transcript -> 404 或 `{ warnings:[...] }`；建议 404 + readable error。
   - 调 `readYpiStudioSubagentTranscript()` 返回 bounded projection。
3. 更新 `docs/modules/api.md`。

### 5. 前端 live progress plumbing

1. 在 `hooks/useAgentSession.ts` 增加类型：
   - `ToolExecutionProgress { toolCallId, toolName, args?, partialResult?, updatedAt, running }`。
2. `tool_execution_start`：初始化 progress entry。
3. `tool_execution_update`：按 `toolCallId` 替换 entry.partialResult；不要对 YPI transcript 文本无限追加。
4. `tool_execution_end`：保存 final result/updatedAt/running=false，或至少保留到 agent_end 后当前消息渲染完成。
5. 将 `toolProgressById` 从 hook return 给 `ChatWindow`。
6. `ChatWindow` 传给 `MessageView`，`MessageView` 传给 `ToolCallBlock`。

### 6. 工具展开区专用组件

1. 在 `components/MessageView.tsx` 或新文件 `components/YpiStudioSubagentTranscript.tsx` 实现：
   - 从 `block.input` 解析 member/prompt/taskId/model/thinking。
   - 从 `progress.partialResult.details.run` 读取 running transcript preview。
   - 从 `result.details.run.transcript` 或 `result.content` 读取完成态信息。
   - 通过 transcript API 拉取 full/bounded projection。
2. 渲染：status strip、input collapsed、transcript timeline、final output、fallback warning。
3. 历史无 details：显示 generic result，并说明未捕获 transcript。
4. 加载失败：显示 API error + fallback summary。

### 7. 文档更新

- `docs/modules/frontend.md`：记录 `MessageView` 对 `ypi_studio_subagent` 的专用 transcript 渲染和 `useAgentSession` 的 tool progress state。
- `docs/modules/api.md`：记录 transcript route。
- `docs/modules/library.md`：记录 `lib/ypi-studio-transcripts.ts` 和 task run transcript ref。

## 验证命令

最低验证：

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

建议手工验证：

1. 启动 dev server：`npm run dev`。
2. 在一个 YPI Studio task 中触发 `ypi_studio_subagent(member=architect)`。
3. 运行中展开工具块，确认显示 running/progress，而不是只有输入 JSON。
4. 完成后刷新页面，重新展开，确认可从 API 回放 transcript。
5. 模拟失败/取消：中止 child run 或使用无效 member/model，确认 UI 显示 failed/cancelled 与 stderr/error。
6. 删除 transcript sidecar 后刷新，确认旧 run/缺失文件有明确降级。

## 检查门禁

- 不修改工作流状态机和成员定义。
- 不把 full transcript 写进 `task.json` 或普通 session metadata。
- 不默认暴露 system/developer hidden prompt。
- 不破坏普通 `subagent` / `trellis_subagent` 的运行列表和结果显示。
- TypeScript 类型覆盖 `details` 读取，不使用大量 `any` 绕过。

## 回滚点

- 完成第 1-3 步后，可仅保留后端 transcript capture；前端仍旧显示 result。
- 完成第 5-6 步后如 UI 风险较高，可撤回专用组件，保留 API 和 details 引用。
- 若 `onUpdate` 兼容性异常，降级为只在 start 发状态、finish 显示 transcript；仍满足完成后可回放。
