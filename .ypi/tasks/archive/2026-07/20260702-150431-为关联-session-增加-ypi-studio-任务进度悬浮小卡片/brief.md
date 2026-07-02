# brief

## 目标与背景

在与 YPI Studio 任务关联的 pi session 页面中展示一个会话级悬浮小卡片，让用户不用打开右侧“工作室”面板也能直观看到当前工作室任务的流程步骤、进度、负责人，以及 `ypi_studio_subagent` 成员执行情况。视觉方向需要体现“瀑布流 / 流动线条”的工作流推进感。

已检查的现有模式：

- `components/TrellisSessionWidget.tsx`：会话关联任务悬浮组件，支持拖拽、持久位置、移动端底部详情、点击打开右侧 Trellis 面板。
- `components/SessionChangesFloatingPanel.tsx`：会话级悬浮面板，放在 `ChatWindow` 内，轮询 session sidecar，运行中高频刷新。
- `components/YpiStudioPanel.tsx`：右侧工作室面板，已有成员/流程/任务 tab，可展示任务摘要、状态、进度、缺失产物、归档入口。
- `lib/ypi-studio-tasks.ts` / `lib/ypi-studio-extension.ts`：任务持久化在 `.ypi/tasks/<task-id>/task.json`；上下文绑定写入 `contextIds` 与 `.ypi/.runtime/sessions/<context-id>.json`；`ypi_studio_subagent` 运行会写入 `subagents` 与 `.ypi/.runtime/studio-subagents/` transcript sidecar。
- `lib/trellis-session-link.ts` + `app/api/sessions/[id]/trellis-task/route.ts`：已有“由 session 高置信解析关联任务”的服务端模式，可复用为 Studio resolver。

## 范围内

1. 为当前 session 解析关联 YPI Studio task，并只在高置信匹配时展示悬浮卡片。
2. 悬浮卡片展示：任务标题、工作流、当前状态/进度、流程步骤、缺失产物、当前负责人。
3. 突出展示 `ypi_studio_subagent` 成员执行：成员、状态、开始/结束时间、模型/thinking、摘要/最近 transcript preview。
4. 运行中可刷新：父 session SSE 中的 live tool progress 优先；落盘任务/sidecar 作为轮询兜底。
5. 点击悬浮卡片可打开右侧 Studio 面板并聚焦关联任务。
6. 视觉采用半透明浮层、流动连接线、瀑布式成员运行列表；尊重现有主题变量和移动端模式。

## 范围外

- 不修改 YPI Studio workflow 状态机语义。
- 不通过 Git 状态推导任务进展。
- 不把低置信的“当前项目只有一个任务”作为 session 关联依据。
- 不在悬浮卡片中展示完整 artifacts 文档正文；完整内容仍通过 Studio 面板/文件查看器打开。
- 不在本任务中实现代码；本文件为 intake 与技术方案初稿。

## 需求与验收标准

| 需求 | 验收标准 |
| --- | --- |
| 会话关联展示 | 选择一个已绑定 YPI Studio task 的 session 后，聊天区域显示 Studio 悬浮卡片；无高置信关联时不显示。 |
| 高置信解析 | 能通过 exact session context pointer、task.contextIds、或当前 session transcript 中的 Studio tool result 解析到任务；冲突时不展示并返回 `ambiguous`。 |
| 流程进度 | 卡片展示 workflow state 步骤、当前状态、百分比、owner、required artifact 完成/缺失。 |
| 成员执行 | 卡片突出 `ypi_studio_subagent` runs：running/succeeded/failed/cancelled、member、model/thinking、summary/last preview；running run 有流动/脉冲提示。 |
| 运行刷新 | 创建/切换/结束 Studio task 或 subagent run 后，卡片在 SSE agent_end 或短轮询内更新；运行中不需要手动刷新页面。 |
| 交互 | 桌面端可拖动并持久位置；点击打开 Studio drawer 并聚焦任务；移动端使用紧凑 pill + bottom sheet。 |
| 兼容 | 不破坏 `TrellisSessionWidget`、`SessionChangesFloatingPanel`、`YpiStudioPanel` 的现有行为。 |

## 数据关联方案：由 session id 高置信解析 Studio task

建议新增 `lib/ypi-studio-session-link.ts`，形态对齐 `lib/trellis-session-link.ts`，由服务端 route 调用，UI 不直接扫描 JSONL 或 `.ypi` 文件。

### 输入

- `cwd`：从 session JSONL header 读取并经过 allowed roots 校验，不信任客户端传入 cwd。
- `sessionId`：当前 pi session id。
- `sessionFilePath`：`resolveSessionPath(sessionId)` 得到的 JSONL 文件路径。
- `entries` / 当前 leaf context messages：用于解析当前会话分支内的 Studio tool evidence。

### Exact context keys

复用 `lib/ypi-studio-extension.ts` 的 key 规则：

- `pi_${sanitize(sessionId)}`
- `pi_transcript_${sha256(sessionFilePath).slice(0, 24)}`

只把这两个 exact key 视为高置信 session 绑定。不要把 `pi_process_*` 作为 session 关联依据：它可出现在当前实现的 fallback context 中，但不能由 session id 稳定反推，容易误配。

### Evidence 来源与优先级

1. **runtime pointer（最高）**  
   读取 `.ypi/.runtime/sessions/<exact-key>.json` 中的 `currentTask`，或导出 `getYpiStudioTaskIdForContext(cwd, contextId)` 供 resolver 使用。两个 exact key 若指向不同任务，返回 `ambiguous`。

2. **task.contextIds exact match（最高）**  
   通过 `listYpiStudioTasks(cwd, { scope: "all" })` 扫描 summary 中的 `contextIds`，匹配 exact keys。仅 exact key 命中有效；`pi_process_*` 命中无效。多任务冲突返回 `ambiguous`。

3. **session transcript Studio tool evidence（高）**  
   解析当前 session context 中：
   - `ypi_studio_task` tool result 的 `details.task.id/key/cwd`。
   - `ypi_studio_subagent` tool result 的 `details.task.id/key` 或 `details.run.taskId`。
   - `ypi_studio_subagent` tool call input 中显式 `taskId`。
   - 标准文本兜底：`Created YPI Studio task <id>`、`Transitioned YPI Studio task <id>`、`Archived YPI Studio task <id>`。

   Transcript evidence 需要与实际 `.ypi/tasks` 中可读取任务交叉验证；标准文本只作为最后兜底。若一个 session 中存在多个 Studio task，推荐选择当前分支内最新的明确 Studio tool result；若只有低质量文本且多任务冲突，则返回 `ambiguous`。

### 输出

新增类型建议：

```ts
export type YpiStudioSessionTaskLinkSource = "session-runtime" | "task-context" | "session-transcript";

export type YpiStudioSessionTaskLinkResult =
  | { task: YpiStudioTaskWidgetProjection; source: YpiStudioSessionTaskLinkSource; confidence: "high" }
  | { task: null; reason: "no-workspace" | "no-evidence" | "task-not-found" | "ambiguous" };
```

`YpiStudioTaskWidgetProjection` 应为轻量投影，不返回 `documents` 全文：

- task summary 字段：`key/id/title/workflowId/workflowName/status/progress/currentMember/updatedAt/archived`。
- `steps`: workflow states 按 progress 排序，含 `id/label/owner/progress/requiresSubagent/status(done|active|pending)`。
- `subagents`: 最近 N 条 run，含 `id/member/status/startedAt/finishedAt/summary/model/thinking/modelSource/thinkingSource/transcriptMeta/lastItemsPreview`。
- `events`: 最近 N 条 task event，可选。

## API 方案

### 新增 route

`GET /api/sessions/[id]/studio-task`

职责：

1. `resolveSessionPath(id)`；不存在返回 404。
2. `SessionManager.open(filePath)` 读取 header/entries/leaf。
3. 用 header.cwd 做 allowed roots 校验。
4. 调用 `resolveYpiStudioTaskForSession({ cwd, sessionId: id, sessionFilePath: filePath, entries/context })`。
5. 命中后读取 task detail，并裁剪为 widget projection；不要返回 artifacts documents 正文。
6. 对 running subagent 可读取 transcript sidecar 的 meta/最后若干 items，避免只看到 `Child Pi process starting.`。

刷新策略：

- 初次选择 session 时请求一次。
- 任务存在时每 10s 轻量轮询；`agentRunning` 或最近有 running subagent 时降至 2-3s。
- `agent_end` 后立即刷新。
- 无 task 但 agentRunning 时短轮询，便于同一 turn 内创建 task 后显示卡片。

### 可复用/需调整的现有 API

- `app/api/studio/tasks/[taskKey]/` 已能读任务详情，但需要已知 taskKey，不负责 session 关联。
- `app/api/studio/tasks/[taskKey]/subagents/[runId]/transcript/` 可继续作为展开完整 transcript 的 API；widget projection 只需要最后几条 preview。
- `YpiStudioPanel` 建议增加可选 props：`focusedTaskKey?: string`、`initialTab?: "tasks"`、`initialScope?: YpiStudioTaskScope`，用于点击悬浮卡片后打开并高亮任务。

## UI / 组件方案

### 集成位置

推荐在 `AppShell` 层管理关联任务状态，原因与 Trellis widget 一致：

- 点击卡片需要打开右侧 Studio drawer。
- 需要知道 `rightPanelOpen/rightPanelMode`，在 Studio drawer 已打开并聚焦同任务时可隐藏/降噪。
- 可与 `TrellisSessionWidget` 采用一致的浮层策略。

建议新增：

- `components/YpiStudioSessionWidget.tsx`
- `lib/ypi-studio-session-link.ts`
- `app/api/sessions/[id]/studio-task/route.ts`
- `lib/ypi-studio-types.ts` 中补充 widget/link wire types。

`ChatWindow` 中已有 `toolProgressById`，若要把 `ypi_studio_subagent` live progress 合并进卡片，有两种方案：

1. **推荐**：给 `ChatWindow` 增加轻量 callback `onToolProgressChange` 或 `onStudioProgressChange`，只上抛 `ypi_studio_subagent` / `ypi_studio_task` 相关 progress 给 `AppShell`；widget 用 API projection + live progress overlay 合并展示。
2. **备选**：把 widget 放进 `ChatWindow`，并通过 prop `onOpenStudioTask(taskKey)` 通知 `AppShell` 打开 Studio drawer。实现少一些跨层状态，但 session-link 逻辑会分散到 ChatWindow，和 Trellis 模式不一致。

### 卡片视觉

桌面端：

- 默认右上或右侧中上，避免与 `SessionChangesFloatingPanel` 默认右下冲突；位置可拖拽并用 `localStorage` 保存，如 `pi-web:ypi-studio-session-widget-position`。
- 半透明背景 + blur，使用 `--bg-panel`、`--border`、`--accent`。
- 顶部：`工 Studio · <workflowName> · <percent>%`，状态 badge，标题单行省略。
- 中部：workflow steps 竖向/斜向“流水线”：done/active/pending 节点 + 连接线；active 节点连接线用 moving gradient。
- 底部：`ypi_studio_subagent` 瀑布区：最近 3-5 个成员 run 以交错小卡/流式列表展示，running 卡片脉冲，failed 红色，succeeded 绿色。

移动端：

- 默认 compact pill：`工 Studio 35% · architect running`。
- 点击打开 bottom sheet 展示完整步骤和成员 run，提供“详情”按钮打开 Studio drawer。

动效与无障碍：

- 使用 CSS/SVG 实现 flow lines；无需引入动画库。
- 支持 `prefers-reduced-motion: reduce` 时关闭流动动画，只保留静态高亮。
- `role="button"`、Enter/Space 激活，拖拽阈值同 Trellis widget。

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| `pi_process_*` fallback context 无法从 session id 稳定解析 | 不作为关联依据；依靠 transcript tool evidence 兜底。必要时后续增强 extension，优先写入 `pi_<sessionId>`/`pi_transcript_<hash>`。 |
| 同一 session 中多个 Studio task | exact runtime pointer 优先；transcript 取当前分支内最新明确 tool result；冲突返回 `ambiguous` 不展示。 |
| running subagent 的 `task.json` 只在开始/结束更新，preview 可能滞后 | Widget API 读取 transcript sidecar meta/末尾 items；当前 session live SSE progress 作为前端 overlay。 |
| 卡片与 Trellis/Changes 浮层冲突 | 默认位置错开；各自可拖动；当 Studio drawer 已聚焦同 task 时隐藏或折叠 Studio card。 |
| API 返回文档过大 | 新建轻量 widget projection，禁止返回 `documents` 正文；transcript preview 限条数/字节。 |
| Archived task 聚焦 | projection 保留 `archived/archiveMonth`；打开 Studio panel 时切到 archived/all scope。需产品确认是否在 archived session 中显示。 |
| 动效影响性能/可读性 | 限制在小范围 CSS gradient；尊重 reduced motion；不在每个 transcript item 上做复杂动画。 |

## 需主会话确认的问题

1. 已归档 session 或已归档 Studio task 是否仍显示悬浮卡片？建议：归档 session 默认不显示；活跃 session 关联 archived task 时显示只读 100% 卡片。
2. 点击卡片的目标行为：只打开 Studio Tasks tab 并高亮任务，还是同时打开 `task.json` 文件？建议默认打开 Studio Tasks tab，高亮任务，保留“打开 task.json”按钮。
3. 当 exact context 缺失、但 session transcript 明确创建/操作过 task 时，是否接受作为高置信？建议接受 Studio tool result/details；纯自然语言文本只作低优先兜底。
4. 是否需要在卡片中显示完整 transcript 展开？建议 MVP 只显示最近 preview，完整 transcript 继续在消息里的 `YpiStudioSubagentTranscript` 展开区查看。

## 建议实现顺序

1. 新增 `YpiStudioSessionTaskLinkResult` / widget projection types。
2. 实现 `lib/ypi-studio-session-link.ts`，覆盖 exact context、runtime pointer、transcript evidence、冲突处理。
3. 新增 `GET /api/sessions/[id]/studio-task`，返回轻量 projection。
4. 扩展 `YpiStudioPanel` 支持 `focusedTaskKey` / task scope focus。
5. 在 `AppShell` 中加载 Studio session task，处理刷新、打开 Studio drawer、与右侧 panel 状态联动。
6. 新增 `YpiStudioSessionWidget`，复用 Trellis/Changes 的拖拽、移动端、localStorage 模式，加入 flow/waterfall 视觉。
7. 可选：上抛 `ypi_studio_subagent` live `toolProgressById`，合并到 widget 当前 running member。

## 验证建议

自动验证：

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

手工验收：

1. 新建 Studio task 的 session：卡片出现，展示 intake/planning 等步骤和缺失产物。
2. 执行 `ypi_studio_subagent(member=architect)`：卡片显示 architect running，并随 transcript/live progress 更新；完成后变 succeeded。
3. 同一 session 进入 implementing/checking：步骤进度、owner、required artifacts 更新正确。
4. 无 Studio task session：卡片不显示。
5. 冲突/ambiguous fixture：API 返回 `task:null, reason:"ambiguous"`，UI 不展示错误弹层。
6. 打开 Studio drawer 聚焦同 task：卡片隐藏或降噪；关闭后恢复。
7. 移动窄屏、拖拽、刷新页面后位置持久；reduced motion 下无流动动画。
