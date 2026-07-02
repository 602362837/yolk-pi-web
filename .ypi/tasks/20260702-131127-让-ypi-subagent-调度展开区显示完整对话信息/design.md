# Design

## 方案摘要

采用“YPI Studio 自管 transcript sidecar + 工具展开区专用渲染”的方案：

- 保留 child Pi 当前 `pi --mode json -p --no-session` 运行模式，避免污染全局 Pi sessions，也不依赖 child session file 发现。
- `runChildPi()` 在 stdout JSON lines 到达时实时解析事件，生成 sanitized transcript item，写入 `.ypi/.runtime/studio-subagents/<taskId>/<runId>.jsonl`，并通过 Pi tool `onUpdate` 发送 accumulated/bounded progress。
- `ypi_studio_subagent` tool result details 与 YPI task subagent run 增加 transcript 引用和统计；完整 transcript 不进入 `task.json`。
- 新增 transcript 读取 API，前端在 `MessageView` 的 `ypi_studio_subagent` 工具块中显示运行中 progress 和完成后 timeline。

该方案满足“像主 chat 一样可读回放”，同时默认不暴露 system/developer 隐藏提示。

## 影响模块和边界

### 后端 / library

- `lib/ypi-studio-extension.ts`
  - 将 `_onUpdate?: unknown` 明确为可调用 `onUpdate` callback 类型。
  - `runChildPi()` 从“缓存 stdout/stderr，结束后解析最终文本”改为“按行解析 JSON event + 写 transcript + 节流 onUpdate”。
  - `ypi_studio_subagent.execute()` 在 run start/finish 记录状态和 transcript ref。

- 新增 `lib/ypi-studio-transcripts.ts`
  - 负责 transcript sidecar 的安全路径、写入、读取、projection、截断策略。
  - 不依赖 React；供 extension 和 API route 共用。

- `lib/ypi-studio-types.ts`
  - 扩展 `YpiStudioTaskSubagentRun`：可选 `transcript?: YpiStudioSubagentTranscriptRef`。
  - 新增 transcript ref/item/projection wire types。

- `lib/ypi-studio-tasks.ts`
  - `normalizeTaskRecord()` 兼容读取旧 run；新 run 保留 `transcript` 可选字段。
  - `recordYpiStudioSubagentRun()` 支持 running -> succeeded/failed/cancelled 覆盖同 runId。
  - event data 记录 `{ runId, status, transcript }` 的轻量引用。

### API

- 新增 route：`app/api/studio/tasks/[taskKey]/subagents/[runId]/transcript/route.ts`
  - `GET ?cwd=<workspace>&limit=<n>&cursor=<optional>&full=<0|1>`。
  - 校验 cwd 在 allowed roots 内，taskKey/runId 合法，run 属于 task，transcript path 位于 workspace `.ypi/.runtime/studio-subagents/` 下。
  - 返回 `YpiStudioSubagentTranscriptResponse`：`{ transcript, items, nextCursor?, warnings? }`。

- 更新 `docs/modules/api.md` 增加上述 route。

### 前端

- `hooks/useAgentSession.ts`
  - 增加 active tool progress state，例如 `toolProgressById: Record<string, ToolExecutionProgress>`。
  - 在 `tool_execution_update` 时按 `toolCallId` 替换保存 latest `partialResult`（Pi docs 指明 partialResult 是累计值，不应无限追加）。
  - 在 `tool_execution_end` 时保留 final progress 或清理 active flag，供本轮工具块完成渲染。
  - 暴露给 `ChatWindow`，再传给 `MessageView`。

- `components/ChatWindow.tsx`
  - 构建 `toolResultsMap` 之外，传入 `toolProgressById`。

- `components/MessageView.tsx`
  - `ToolCallBlock` 接收 `progress?: ToolExecutionProgress`。
  - `block.toolName === "ypi_studio_subagent"` 时渲染 `YpiStudioSubagentToolBlock`。
  - 通用工具渲染保持不变。

- 新增可选组件：`components/YpiStudioSubagentTranscript.tsx`
  - 负责 status strip、input 折叠、transcript timeline、final output、加载 API、降级提示。

- `lib/types.ts`
  - `ToolResultMessage` 增加 `details?: unknown`，让 session-loaded tool results 可类型安全读取 transcript ref。

- 更新 `docs/modules/frontend.md`、`docs/modules/library.md`。

## 数据契约

### Transcript sidecar 路径

```text
.ypi/.runtime/studio-subagents/<safeTaskId>/<runId>.jsonl
.ypi/.runtime/studio-subagents/<safeTaskId>/<runId>.meta.json
```

`task.json` 只保存相对 `pathLabel`，不保存绝对路径给浏览器直接访问。

### Transcript ref

```ts
interface YpiStudioSubagentTranscriptRef {
  schemaVersion: 1;
  format: "ypi-studio-subagent-transcript";
  runId: string;
  taskId: string;
  member: string;
  pathLabel: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  startedAt: string;
  finishedAt?: string;
  updatedAt: string;
  itemCount: number;
  messageCount: number;
  toolCallCount: number;
  stderrBytes: number;
  bytes: number;
  truncated: boolean;
}
```

### Transcript item

```ts
type YpiStudioSubagentTranscriptItem =
  | { kind: "status"; at: string; text: string }
  | { kind: "prompt"; at: string; text: string; truncated?: boolean }
  | { kind: "assistant"; at: string; text: string; model?: string; truncated?: boolean }
  | { kind: "tool_call"; at: string; toolCallId: string; toolName: string; inputPreview: string; truncated?: boolean }
  | { kind: "tool_result"; at: string; toolCallId: string; toolName?: string; text: string; isError?: boolean; truncated?: boolean }
  | { kind: "stderr"; at: string; text: string; truncated?: boolean }
  | { kind: "error"; at: string; text: string };
```

### Tool partialResult details

During running, `onUpdate` sends a bounded accumulated status:

```ts
{
  content: [{ type: "text", text: "architect running · 3 messages · 1 tool · last: ..." }],
  details: {
    run: {
      id,
      member,
      status: "running",
      taskId,
      transcript: ref,
      progress: {
        startedAt,
        updatedAt,
        eventCount,
        lastTextPreview,
        itemsPreview: YpiStudioSubagentTranscriptItem[]
      }
    }
  }
}
```

Final result details reuse the same shape with `status: succeeded|failed|cancelled` and final transcript ref.

## 子进程事件处理

`runChildPi()` should parse these JSON stdout events:

- `agent_start` / `agent_end` -> status items and counters.
- `message_start` / `message_update` -> optional last status; do not persist every token delta by default to avoid bloat.
- `message_end` with assistant message -> assistant item; update final assistant output.
- `tool_execution_start` -> tool_call item with bounded input preview.
- `tool_execution_update` -> update latest status/progress preview; persist only if useful and bounded, not every token.
- `tool_execution_end` -> tool_result item.
- Legacy `tool_result_end` if observed -> tool_result item.
- non-JSON stdout line -> `status` or `error` item marked non-json.
- stderr chunks -> bounded `stderr` items and stderr byte count.

`onUpdate` should be throttled (for example 250-500ms) and send accumulated preview, because Pi RPC docs state `partialResult` is accumulated output so clients can replace display.

## 安全与隐私

- 不 persist system/developer hidden prompt。
- Prompt item records the delegated member prompt/input that user can already see or that Studio task context intentionally provides; full generated system prompt is not included.
- API validates allowed root, safe task id/run id, and real path within `.ypi/.runtime/studio-subagents`.
- Transcript projection bounds per item and total response size; raw file can be opened only through existing authorized file APIs if workspace path is allowed.

## 兼容性

- Old `task.json` runs lacking `transcript` normalize normally.
- Old chat tool results lacking details render with current generic `PairedResult` plus a Studio-specific message: transcript was not captured.
- Missing/corrupt transcript ref returns API warning and UI fallback.
- Existing `subagent`/`trellis_subagent` logic remains unchanged except the new generic `toolProgressById` state; avoid changing `SubagentPanel` behavior in this task.

## 风险与缓解

- **Pi JSON event variants differ by version**：handle both documented `tool_execution_*` and observed `tool_result_end`; ignore unknown events safely.
- **High-frequency output causes UI churn**：throttle `onUpdate`; frontend replaces progress instead of appending.
- **Large transcript files**：bounded previews, meta counters, API pagination/cursor, no full transcript in task.json.
- **Transcript write failure**：tool continues; details include warning; UI falls back to final output.
- **Privacy leakage**：do not store hidden prompts; keep tool input/result previews bounded and collapsible.
- **State mismatch between live SSE and reloaded session**：final tool result details and task run transcript ref are persisted, so reload can fetch transcript via API.

## Rollback

The implementation can be rolled back by:

1. Reverting MessageView/ChatWindow/useAgentSession specialized rendering and progress props.
2. Keeping old `ypi_studio_subagent` final result behavior.
3. Leaving orphan `.ypi/.runtime/studio-subagents` files harmless; they are not read without transcript refs.
