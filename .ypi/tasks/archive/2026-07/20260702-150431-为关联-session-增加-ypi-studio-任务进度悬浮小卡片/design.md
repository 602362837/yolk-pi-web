# design

## 方案摘要

为关联 YPI Studio task 的 pi session 增加一个只读、轻量、会话级浮层。整体采用“服务端高置信 session→task resolver + 轻量 widget projection + AppShell 统一浮层/右栏联动”的方案：

- 服务端新增 `GET /api/sessions/[id]/studio-task`，只接收 session id（可选当前 leaf id），从 session JSONL header 读取 `cwd` 并做 allowed roots 校验；浏览器不直接扫描 `.ypi/` 或 JSONL。
- 新增 `lib/ypi-studio-session-link.ts`，对齐 `lib/trellis-session-link.ts` 的高置信原则：只使用 deterministic exact context pointer、`task.contextIds` exact match、当前 session transcript 中明确的 Studio tool evidence；拒绝 `pi_process_*`、“当前 workspace 只有一个任务”等低置信猜测。
- API 返回 `YpiStudioTaskWidgetProjection`，只包含任务摘要、流程步骤、artifact 完成/缺失摘要、最近 subagent run 和 transcript preview；不返回 `documents` 正文。
- `AppShell` 负责请求、轮询、处理点击打开 Studio drawer、和右侧 panel focus 状态联动；`ChatWindow` 只把 Studio tool live progress 上抛给 AppShell。
- 新增 `YpiStudioSessionWidget` 展示瀑布式成员 run 与 flow-line workflow steps，复用 Trellis/Changes widget 的拖拽、localStorage 和移动端 bottom sheet 模式。

已参考材料：`brief.md`、`ui.md`、`docs/architecture/overview.md`、`docs/modules/api.md`、`docs/modules/frontend.md`、`docs/modules/library.md`、`.trellis/spec/frontend/quality-guidelines.md` 的 “Session-scoped Trellis task widgets” 高置信关联 contract，以及现有 `TrellisSessionWidget` / `SessionChangesFloatingPanel` / `YpiStudioPanel` / `ypi-studio-*` 实现。

## 新增 / 修改文件清单（实现计划）

| 文件 | 类型 | 目的 |
| --- | --- | --- |
| `lib/ypi-studio-session-link.ts` | 新增 | Studio session link resolver、exact context key 生成、transcript evidence 提取、冲突处理、widget projection builder。 |
| `lib/ypi-studio-types.ts` | 修改 | 增加 `YpiStudioSessionTaskLinkResult`、`YpiStudioTaskWidgetProjection`、widget step/subagent/event/live overlay 类型。 |
| `lib/ypi-studio-tasks.ts` | 小改 | 导出只读 helper `getYpiStudioTaskIdForContext(cwd, contextId)` 或等价安全 runtime pointer 读取函数，避免 resolver 复制私有 runtime pointer 逻辑。不得改变任务状态机语义。 |
| `lib/ypi-studio-transcripts.ts` | 小改 | 增加 tail preview helper（例如 `readYpiStudioSubagentTranscriptPreview`），供 widget projection 读取最后 N 条 transcript item，保持字节/条数上限。 |
| `app/api/sessions/[id]/studio-task/route.ts` | 新增 | Session-scoped Studio task association API。 |
| `components/YpiStudioSessionWidget.tsx` | 新增 | 桌面浮层、移动端 pill/bottom sheet、workflow flow lines、subagent waterfall、拖拽持久化。 |
| `components/AppShell.tsx` | 修改 | 管理 Studio session task state、轮询刷新、live progress overlay、右侧 Studio drawer focus、浮层可见性。 |
| `components/ChatWindow.tsx` | 修改 | 新增轻量 callback，上抛 `ypi_studio_task` / `ypi_studio_subagent` live tool progress 与 `agentRunning` 状态。 |
| `components/YpiStudioPanel.tsx` | 修改 | 增加 `focusedTaskKey` / `initialTab` / `initialScope` / `refreshKey` 类 props；Tasks tab 可切 scope、高亮并滚动到 task。 |
| `app/globals.css` | 小改 | 增加 widget flow-line / pulse / reduced-motion CSS。若全部用 inline style + existing globals 可不改。 |
| `docs/modules/api.md` | 修改 | 记录 `sessions/[id]/studio-task/` route。 |
| `docs/modules/frontend.md` | 修改 | 记录 `YpiStudioSessionWidget`、AppShell/ChatWindow/YpiStudioPanel 集成。 |
| `docs/modules/library.md` | 修改 | 记录 `lib/ypi-studio-session-link.ts` 与 transcript preview helper。 |

> 本设计任务不修改生产代码；上表是后续 implementer 的改动清单。

## 数据契约

### Link result

```ts
export type YpiStudioSessionTaskLinkSource =
  | "session-runtime"
  | "task-context"
  | "session-transcript";

export type YpiStudioSessionTaskLinkReason =
  | "no-workspace"
  | "no-evidence"
  | "task-not-found"
  | "ambiguous";

export type YpiStudioSessionTaskLinkResult =
  | {
      task: YpiStudioTaskWidgetProjection;
      source: YpiStudioSessionTaskLinkSource;
      confidence: "high";
      warnings?: string[];
    }
  | {
      task: null;
      reason: YpiStudioSessionTaskLinkReason;
      warnings?: string[];
    };
```

### Widget projection

```ts
export interface YpiStudioTaskWidgetProjection {
  key: string;
  id: string;
  title: string;
  workflowId: string;
  workflowName?: string;
  status: string;
  statusLabel: string;
  progress: number;
  currentMember?: string;
  updatedAt: string;
  archived?: boolean;
  archiveMonth?: string;
  archivedAt?: string;
  pathLabel: string;
  artifacts: {
    required: string[];
    optional: string[];
    completed: string[];
    missing: string[];
  };
  steps: YpiStudioTaskWidgetStep[];
  subagents: YpiStudioTaskWidgetSubagentRun[];
  events?: YpiStudioTaskWidgetEvent[];
}

export interface YpiStudioTaskWidgetStep {
  id: string;
  label: string;
  owner: string;
  progress: number;
  requiresSubagent?: boolean;
  requiresUserApproval?: boolean;
  requiredArtifacts: string[];
  optionalArtifacts: string[];
  status: "done" | "active" | "pending";
}

export interface YpiStudioTaskWidgetSubagentRun {
  id: string;
  member: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  startedAt: string;
  finishedAt?: string;
  summary?: string;
  error?: string;
  model?: string;
  thinking?: string;
  modelSource?: string;
  thinkingSource?: string;
  transcriptMeta?: YpiStudioSubagentTranscriptRef;
  lastItemsPreview: YpiStudioSubagentTranscriptItem[];
  warnings?: string[];
}

export interface YpiStudioTaskWidgetEvent {
  type: YpiStudioTaskEventType;
  at: string;
  message?: string;
  from?: string;
  to?: string;
  member?: string;
  artifact?: string;
}
```

### Live overlay projection

`ChatWindow` should not send all tool progress to AppShell forever. It should map current Studio tool progress to a compact client-side projection:

```ts
export interface YpiStudioLiveRunOverlay {
  toolCallId: string;
  toolName: "ypi_studio_task" | "ypi_studio_subagent";
  taskId?: string;
  taskKey?: string;
  member?: string;
  status?: "running" | "succeeded" | "failed" | "cancelled";
  model?: string;
  thinking?: string;
  lastTextPreview?: string;
  itemsPreview?: YpiStudioSubagentTranscriptItem[];
  updatedAt: number;
  running: boolean;
}
```

The widget merges this overlay only when `taskId` / `taskKey` matches the projected task. If no task identity is present, ignore the overlay rather than guessing.

## YPI Studio session link resolver

### Inputs

`resolveYpiStudioTaskForSession(options)` should receive:

```ts
interface ResolveYpiStudioTaskForSessionOptions {
  cwd: string;                 // from session JSONL header, already allowed-root validated by route
  sessionId: string;
  sessionFilePath: string;     // resolveSessionPath(id)
  entries: SessionEntry[];
  leafId?: string | null;      // optional current branch leaf from query/AppShell
}
```

Resolver may call `buildSessionContext(entries, leafId)` or an internal branch-path helper so transcript evidence is collected from the current branch context, not sibling branches. If `leafId` is omitted, use `SessionManager.getLeafId()` / latest leaf. If a provided leaf id is not in the file, the route should reject with 400 rather than silently falling back.

### Exact context keys

Generate only these deterministic keys:

```ts
const exactKeys = [
  `pi_${sanitize(sessionId)}`,
  `pi_transcript_${sha256(sessionFilePath).slice(0, 24)}`,
];
```

Rules:

- `sanitize` must match `ypi-studio-extension.ts` / `ypi-studio-tasks.ts` effective behavior: replace non `[A-Za-z0-9._-]` with `_`; if empty, use hash fallback.
- Never treat `pi_process_*` as a valid session association key.
- Do not expose runtime pointer file contents to the browser.

### Task index preparation

1. Call `listYpiStudioTasks(cwd, { scope: "all" })` once.
2. Build maps:
   - `byKey`: `active:<id>` / `archived:<YYYY-MM>:<id>`.
   - `byId`: task id to task summaries; if both active and archived share id, prefer active only for plain id candidates, otherwise mark ambiguous.
   - `byPathLabel`: normalized `.ypi/tasks/<id>` and `.ypi/tasks/archive/<month>/<id>` labels.
3. If `.ypi/tasks` and archive do not exist or task list is empty, resolver still returns `no-evidence` unless there is explicit evidence to a missing task, then `task-not-found`.

### Evidence sources and priority

#### 1. Runtime pointer evidence (`session-runtime`)

For each exact key:

- Read `.ypi/.runtime/sessions/<exact-key>.json` through an exported safe helper such as `getYpiStudioTaskIdForContext(cwd, exactKey)`.
- Accept only `currentTask` string values.
- Normalize candidate as task key or id and verify it exists in task index.
- If both exact keys resolve to different tasks, return `{ task: null, reason: "ambiguous" }`.
- If exact pointer exists but task is missing, keep `task-not-found` as a possible final reason.

#### 2. `task.contextIds` evidence (`task-context`)

Scan all task summaries from `listYpiStudioTasks(..., { scope: "all" })`:

- A task matches only if `task.contextIds` contains one of the exact keys.
- Ignore `contextIds` beginning with `pi_process_`.
- If multiple tasks match exact keys and keys point to different task keys, return `ambiguous`.
- If this source resolves to the same task as runtime pointer, keep a single high-confidence result.

#### 3. Current-session transcript evidence (`session-transcript`)

Extract evidence from the current branch messages in order. Evidence entries should keep `{ candidate, quality, order, sourceTool?, cwd? }`.

Structured tool-result evidence (highest transcript quality):

- `toolResult.toolName === "ypi_studio_task"`
  - `details.task.key`
  - `details.task.id`
  - `details.task.cwd` must be absent or match canonical session cwd.
- `toolResult.toolName === "ypi_studio_subagent"`
  - `details.task.key`
  - `details.task.id`
  - `details.run.taskId`
  - `details.run.taskKey` if future versions add it.
- `toolResult.details` may be the full archive result (`{ task, knowledge, warnings }`); use `details.task`.

Explicit tool-call input evidence:

- Assistant `toolCall` block for `ypi_studio_subagent` with `input.taskId`.
- Assistant `toolCall` block for `ypi_studio_task` with explicit `input.taskId` for `get` / `transition` / `update_artifact` / `archive` actions.
- Do not use `ypi_studio_task(action=create)` input as an id source because the id is generated after execution; rely on its tool result.

Text fallback evidence (last resort only):

- `Created YPI Studio task <id>`
- `Transitioned YPI Studio task <id>`
- `Archived YPI Studio task <id>`
- Optional path forms: `.ypi/tasks/<id>` and `.ypi/tasks/archive/<YYYY-MM>/<id>` when present in tool result text.

Transcript resolution rules:

1. Validate every candidate against the actual task index; natural language alone is not enough.
2. Prefer latest structured tool-result/call evidence in the current branch.
3. If the latest structured candidate resolves, return it unless it conflicts with exact runtime/context evidence.
4. If structured evidence exists but the latest candidate points to a missing task, return `task-not-found` rather than falling back to an older task.
5. If only text fallback evidence exists, all resolved text candidates must point to a single task; otherwise return `ambiguous`.
6. Do not use assistant prose such as “current project has one Studio task” as evidence.

### Cross-source conflict handling

To preserve the Trellis high-confidence session-widget principle:

- Runtime pointer and task-context exact matches are authoritative only if they agree with each other.
- Transcript is used when no exact evidence exists, or as a sanity check when the latest structured transcript evidence identifies a different task.
- If exact evidence resolves to task A and the latest structured transcript evidence resolves to task B, return `ambiguous` unless the product later decides exact pointer should override transcript.
- Older transcript mentions do not conflict if the latest structured transcript evidence matches the exact task.
- Any `ambiguous` result must hide the widget without an error toast.

### Return construction

On a resolved summary, call `getYpiStudioTaskDetail(cwd, task.key)` and build a widget projection. If the summary existed but detail cannot be read, return `task-not-found` or `warnings` with no widget depending on failure:

- security/path errors: let the route convert to 400.
- missing file/read error: `{ task: null, reason: "task-not-found" }`.
- non-fatal transcript preview read error: include run with empty `lastItemsPreview` and `warnings`.

## API route design

### Route

`GET /api/sessions/[id]/studio-task?leafId=<optional-entry-id>`

`dynamic = "force-dynamic"`.

### Request handling flow

1. `const { id } = await params`.
2. `const filePath = await resolveSessionPath(id)`; if null, return 404.
3. `const session = SessionManager.open(filePath)`.
4. `const header = session.getHeader()`; if no `header.cwd`, return 200 `{ task: null, reason: "no-workspace" }`.
5. Validate `header.cwd` against `getAllowedRoots()` and `isPathAllowed()`.
6. Read `entries = session.getEntries() as SessionEntry[]`.
7. If `leafId` is present, verify an entry with that id exists; if not, return 400 `{ error: "Invalid leafId" }`.
8. Call `resolveYpiStudioTaskForSession({ cwd, sessionId: id, sessionFilePath: filePath, entries, leafId })`.
9. Return the link result JSON.

### Response and status matrix

| Condition | HTTP | Body |
| --- | --- | --- |
| Session not found | 404 | `{ "error": "Session not found" }` |
| Invalid `leafId` | 400 | `{ "error": "Invalid leafId" }` |
| Session has no cwd | 200 | `{ "task": null, "reason": "no-workspace" }` |
| Cwd outside allowed roots | 403 | `{ "error": "Access denied" }` |
| No high-confidence evidence | 200 | `{ "task": null, "reason": "no-evidence" }` |
| Evidence conflicts | 200 | `{ "task": null, "reason": "ambiguous" }` |
| Evidence points to missing task | 200 | `{ "task": null, "reason": "task-not-found" }` |
| Resolved | 200 | `{ "task": <projection>, "source": "...", "confidence": "high" }` |
| YPI task security error | 400 | `{ "error": "..." }` |
| Unexpected error | 500 | `{ "error": "..." }` |

There is no Studio feature gate today; unlike Trellis, Studio is a built-in extension/panel. If a future setting gate is added, both drawer and association route must respect it consistently.

## Widget projection 裁剪规则

Projection builder should be server-side and browser-safe.

### Included task fields

- `key`, `id`, `title`, `workflowId`, `workflowName`, `status`, `progress.percent`, `progress.label`, `currentMember`, `updatedAt`.
- `archived`, `archiveMonth`, `archivedAt`, `pathLabel`, `knowledgePath` only if needed for drawer focus/read-only label.
- Artifact summary names from `progress.requiredArtifacts`, `optionalArtifacts`, `completedArtifacts`, `missingArtifacts`.

### Excluded fields

- `documents` and full markdown artifact content.
- Full `meta` object unless a future UI explicitly needs a safe field.
- Full transcript JSONL.
- Full `prompt` text for subagent run; at most `promptPreview` if product asks later.

### Workflow steps

Read `readYpiStudioWorkflow(cwd, task.workflowId)`; if missing, fall back to states derivable from `task.progress` only.

- Sort states by `progress`, then `id` for stable rendering.
- Mark `active` when `state.id === task.status`.
- Mark `done` when `state.progress < task.progress.percent`.
- Mark `pending` when `state.progress > task.progress.percent`.
- For terminal `completed` / `archived`, the current terminal state remains `active` unless UI decides to show all 100% as done; prior states are `done`.
- Include `owner`, `requiresSubagent`, `requiresUserApproval`, required/optional artifact names.

### Subagent runs

- Always include all currently `running` runs for the task, then most recent completed/failed/cancelled runs, capped to 5 total by default.
- Sort primarily by status priority (`running` first), then `startedAt` descending.
- Include `id`, `member`, `status`, timestamps, `summary` clipped to ~500 chars, `error` clipped to ~500 chars, model/thinking/source fields, transcript meta.
- For each run with `transcript`, read last 3-5 transcript items through a bounded tail helper:
  - Max items per run: 5.
  - Max text per item: ~300 chars for widget projection.
  - Max total transcript preview bytes across projection: ~20 KB.
- If transcript read fails, keep the run and attach `warnings`, do not fail the whole API unless the failure indicates path escape/security violation.

### Events

Optional for MVP. If included:

- Last 5 events by `at` descending.
- Include only type/time/message/from/to/member/artifact.
- Do not include arbitrary `event.data` by default because it may contain nested transcript refs or future large payloads.

### Payload budget

Target response size should stay under ~60 KB for normal tasks. If projection warnings indicate truncation, UI can show a subtle “preview truncated” tooltip but should not open an error toast.

## Frontend integration

### AppShell ownership

Add state near current Trellis session-task state:

```ts
const [studioSessionTask, setStudioSessionTask] = useState<YpiStudioSessionTaskLinkResult | null>(null);
const [studioSessionTaskRefreshKey, setStudioSessionTaskRefreshKey] = useState(0);
const [focusedStudioTaskKey, setFocusedStudioTaskKey] = useState<string | null>(null);
const [studioLiveOverlays, setStudioLiveOverlays] = useState<YpiStudioLiveRunOverlay[]>([]);
const [chatAgentRunning, setChatAgentRunning] = useState(false);
```

Loading behavior:

- Do not request for `newSessionCwd` before a real session id exists.
- Do not request for `selectedSession.archived` in MVP unless main session decides archived sessions should show the widget.
- Include `leafId` from `branchActiveLeafId` when present.
- Use `AbortController` in effects and reset state on session id changes.
- `handleAgentEnd` increments `studioSessionTaskRefreshKey` in addition to existing refresh keys.

Open behavior:

```ts
function handleOpenStudioSessionTask() {
  if (!studioSessionTask?.task) return;
  setFocusedStudioTaskKey(studioSessionTask.task.key);
  setRightPanelMode("studio");
  setRightPanelOpen(true);
}
```

Visibility interlock:

- Show widget only when `showChat && studioSessionTask?.task`.
- Hide or collapse when `rightPanelOpen && rightPanelMode === "studio" && focusedStudioTaskKey === studioSessionTask.task.key`.
- Keep Trellis widget logic independent; default positions avoid overlap.

### ChatWindow live progress callback

Add props:

```ts
onStudioToolProgressChange?: (snapshot: {
  agentRunning: boolean;
  overlays: YpiStudioLiveRunOverlay[];
}) => void;
```

Implementation notes:

- Use `useEffect` keyed by `agentRunning` and a stable JSON signature of filtered `toolProgressById`.
- Filter to `toolName === "ypi_studio_task" || toolName === "ypi_studio_subagent"`.
- For subagent progress, read `partialResult.details.run` or `result.details.run`.
- Cleanup on unmount/session change by sending `{ agentRunning: false, overlays: [] }`.
- Do not move resolver/file scanning into `ChatWindow`.

### YpiStudioPanel focus props

Extend props:

```ts
interface Props {
  cwd: string | null;
  onOpenFile?: (filePath: string, fileName: string) => void;
  focusedTaskKey?: string | null;
  initialTab?: "members" | "workflows" | "tasks";
  initialScope?: YpiStudioTaskScope;
  refreshKey?: number;
}
```

Behavior:

- When `focusedTaskKey` changes:
  - set `activeTab` to `"tasks"`.
  - set `taskScope` to `"archived"` if key starts `archived:`, otherwise `"active"`.
  - after `tasksData` loads, highlight matching `TaskCard` and scroll it into view.
- `refreshKey` should trigger `loadTasks()` without reinitializing members/workflows unnecessarily.
- If focused task is not in current scope (e.g. archived task and active scope), switch scope before rendering empty state.
- Existing members/workflows behavior must remain unchanged.

### YpiStudioSessionWidget component

Props:

```ts
interface YpiStudioSessionWidgetProps {
  task: YpiStudioTaskWidgetProjection;
  liveOverlays?: YpiStudioLiveRunOverlay[];
  onClick: () => void;
}
```

Behavior:

- Desktop:
  - Absolute-positioned inside the chat content wrapper.
  - Default top-right (`top/right: 18px`), width `min(340px, calc(100% - 36px))`.
  - Draggable with 4px threshold and persisted `localStorage` key `pi-web:ypi-studio-session-widget-position`.
  - Dismiss button hides for current `task.key` / session mount only; switching session/task resets.
- Mobile (`max-width: 640px`):
  - Compact pill with key `pi-web:ypi-studio-session-widget-mobile-position` if draggable mobile is retained.
  - Tap opens bottom sheet with full steps and runs; “详情” opens Studio drawer.
- Rendering:
  - Header: `工 Studio · workflowName · progress%`, status badge, title.
  - Steps: flow-line pipeline with done/active/pending nodes.
  - Artifacts: `completed/required` and missing names clipped.
  - Runs: waterfall list, running overlay wins over persisted summary when matching `taskId`.
- Accessibility:
  - Use `<button>` for pill and dismiss; desktop container can use `role="button"` with Enter/Space activation if not a button.
  - Pointer drag must not swallow keyboard activation.
  - `prefers-reduced-motion: reduce` disables pulse/flow animations.

## 刷新策略

| Trigger | Behavior |
| --- | --- |
| Session selected / restored | Fetch once after `selectedSession.id` and branch leaf are known. |
| Branch leaf changes | Refetch with `?leafId=<branchActiveLeafId>` to keep transcript evidence branch-scoped. |
| New session gets real id | Fetch/poll once `onSessionCreated` sets `selectedSession`. |
| `agentRunning` true and no task yet | Poll every 2.5-3s so a same-turn `ypi_studio_task(action=create)` can make the card appear. |
| Task resolved and no running runs | Poll every 10s for low-cost task/progress updates. |
| Task resolved and any persisted/live subagent is running | Poll every 2.5-3s for sidecar/task.json updates. |
| SSE `agent_end` | Immediate refresh via `handleAgentEnd`; also refresh Studio panel tasks if open. |
| Right Studio panel focused same task | Hide/collapse widget; keep background polling active if task/run is running, otherwise keep normal 10s. |
| Page/tab hidden | Optional optimization: keep no-task/running poll at 10s or pause non-running polls; not required for MVP. |

Use `AbortController` per request; ignore AbortError. UI should not toast association route `no-evidence` / `ambiguous`; log debug warnings only if needed.

## 安全、兼容与性能

- Browser never sends `cwd` for the association route; server trusts only session header cwd after allowed-root validation.
- Browser never reads `.ypi/.runtime/sessions` or transcript files directly.
- Stable task keys, not raw paths, are used when opening Studio panel details.
- Resolver never writes task/session metadata and never mutates runtime pointers.
- Archived task support is read-only. If UI displays archived task, card should show archived/completed tone and open Studio panel with archived scope.
- Old tasks without `subagents.transcript` still render summary/model/thinking if present; preview list is empty.
- Missing workflow file degrades to a one-step projection from `task.progress`.
- Projection limits prevent large artifact/transcript payloads from blocking chat rendering.

## 验收 / 验证计划

### 自动验证

After implementation:

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

Recommended focused checks if adding unit-style tests or fixtures:

- Resolver exact key tests:
  - `pi_<sessionId>` runtime pointer resolves.
  - `pi_transcript_<hash(sessionFilePath)>` runtime pointer resolves.
  - `pi_process_*` pointer/context id is ignored.
  - conflicting exact keys return `ambiguous`.
- Transcript evidence tests:
  - latest structured `ypi_studio_task` result resolves.
  - `ypi_studio_subagent` result `details.run.taskId` resolves.
  - multiple text-only task ids return `ambiguous`.
  - evidence to missing task returns `task-not-found`.
- Projection tests:
  - `documents` is not present in API JSON.
  - subagent transcript preview is capped.
  - archived task key/scope is preserved.

### 手工验收

1. Create or select a session with exact Studio task context; widget appears and shows title/workflow/status/progress/owner/artifacts.
2. Select a session with no Studio evidence; widget does not render and no toast appears.
3. Run `ypi_studio_subagent(member=architect)`; widget shows architect running with model/thinking and live preview, then succeeded/failed/cancelled after completion.
4. Transition Studio task through planning/implementing/checking; step pipeline and missing artifacts update after SSE `agent_end` or polling.
5. Create conflicting evidence fixture; `/api/sessions/[id]/studio-task` returns `{ task: null, reason: "ambiguous" }` and UI hides widget.
6. Click widget; right panel opens in Studio Tasks tab, correct scope, focused/highlighted task; widget hides/collapses while focused.
7. Drag widget, refresh page, position persists; Trellis and Changes panels remain usable.
8. Mobile width: pill appears, bottom sheet opens, “详情” opens Studio drawer.
9. Enable reduced motion in OS/browser; flow/pulse animation stops but active state remains visible.
10. Confirm API response does not include artifact document content or full transcript JSONL.

## 回滚方案

- Remove `YpiStudioSessionWidget` mount and Studio session-task state from `AppShell`.
- Remove `ChatWindow` Studio progress callback; existing message/tool rendering remains unaffected.
- Leave `GET /api/sessions/[id]/studio-task` unused or revert route and `lib/ypi-studio-session-link.ts` together.
- `YpiStudioPanel` focus props can remain backward-compatible if optional; otherwise revert prop additions.
- No `.ypi/tasks` migration is introduced, so rollback does not require data changes.

## 需主会话确认的问题

1. Archived behavior: MVP建议 `selectedSession.archived` 不显示浮层；active session 关联 archived task 时显示只读卡片并打开 archived scope。是否确认？
2. Exact vs transcript conflict: 设计按安全优先返回 `ambiguous`。是否需要改成 exact runtime pointer 覆盖旧 transcript？
3. 点击卡片目标：默认打开 Studio Tasks tab 并高亮任务，不打开 `task.json` 文件。是否确认保留“打开 task.json”只在 Studio panel 内？
4. Widget 是否需要关闭按钮？`ui.md` 提到本 session 内 dismiss；如果担心误隐藏，可先不做关闭按钮或只做折叠。
