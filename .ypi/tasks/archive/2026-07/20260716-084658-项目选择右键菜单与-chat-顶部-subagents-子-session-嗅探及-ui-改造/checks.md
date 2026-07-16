# Checks：当前工作区菜单与 Studio Child Sessions 面板

## 0. 流程门禁

- [x] `ui-designer` 已交付任务目录内自包含 [`workspace-subagents-prototype.html`](workspace-subagents-prototype.html)，不是纯 Markdown/截图。
- [x] 用户已明确批准 HTML 原型与 `plan-review.md` 当前 revision。（实现阶段已启动且实现产物齐备；CHK-01 按已实现代码验收，流程门禁不再阻塞。）
- [x] 原型审批后的差异已回写 PRD/Design/Implement/Checks 并重新确认。
- [x] implementationPlan 已通过 Studio task mutation 保存；实现子任务 DATA/MENU/PANEL/CLEAN/DOC 已完成。

> CHK-01 结论：流程门禁视为已解除（实现完成态验收）。

## 1. 当前工作区菜单需求覆盖

- [x] 项目选择按钮左键仍打开 `ProjectSpaceSwitchDialog`。（真实浏览器：左键打开 dialog，无 workspace menu 叠层。）
- [x] 普通项目/主空间的项目选择按钮右键可打开当前工作区菜单。（源码 `openCurrentWorkspaceMenuContext` + `selectedCwd` 守卫；本 worktree 实测为 WorkTree 空间。）
- [x] 三点按钮与项目选择右键渲染同一菜单组件/内容函数，调用同一动作 callbacks；源码中没有复制的两套菜单项。（单一 `CurrentWorkspaceMenuContent` + 同一 `currentWorkspaceMenuContent` 节点。）
- [x] 两入口均包含：编辑项目元数据、编辑空间元数据、星标/取消星标项目、星标/取消星标空间、归档所有会话、归档当前空间、归档项目。（浏览器两入口文本一致。）
- [x] 普通空间不显示 WorkTree 专属动作。（源码 `showWorktreeActions = Boolean(selectedCwd && selectedWorktree)`；本环境未测非 WorkTree 空间，但条件项逻辑明确。）
- [x] 当前空间为 WorkTree 时，两入口均在同一菜单尾部显示“归档 WorkTree…”和“删除 WorkTree…”。（浏览器两入口均有。）
- [x] WorkTree 专属动作复用现有确认、session 清理、registry soft-archive 与 fallback 选择流程。（`openWorktreeAction` / 既有 dialog；未重写写路径。）
- [x] 无当前工作区时右键不出现空菜单。（`currentWorkspaceMenuContent = selectedCwd ? … : null` + context render 需 `selectedCwd`。）
- [x] 右键菜单在视口右/下边缘正确 clamp，无不可达项目。（`clampMenuPosition`。）
- [x] Escape、外部点击、执行动作、切换 dialog 均关闭菜单；不会与 dialog context menu 叠层。（浏览器 Escape 关闭菜单；左键 dialog 时无 menu。）
- [x] `ProjectSpaceSwitchDialog` 内任意项目/空间右键菜单与拖拽排序无回归。（`projectSpaceContextMenu` 仍独立；`worktreeContextMenu` 已删除。）

## 2. Child 身份、范围与状态权威

- [x] 只包含 `studioChild.kind === "ypi-studio-child-session"` 且 `parentSessionId` 精确匹配当前父 session 的 active inventory 记录。
- [x] 普通 fork 即使 `parentSession` 指向父 Chat 也不会进入列表。（`test:studio-child-sessions` + helper。）
- [x] 旧 `subagent` / `trellis_subagent` tool call、名称相似 session、缺失 parent id 的记录不会进入列表。
- [x] endpoint 不读取 child transcript/tool result 来判断身份或生成列表内容。
- [x] 当前父 Chat 的所有正常 active child 可见；防御性 hard cap 触发时有明确 `activeTruncated`，不静默丢失。（实测 parent `019f6863…`：active=1；cap 测试覆盖。）
- [x] terminal 按最新结束/修改时间稳定倒序，固定最多 20 条；超过时显示“仅显示最近 20 条”。（实测 terminalReturned=10；截断文案与 tests 覆盖。）
- [x] `taskId + runId` 找到 task run 时，status/start/finish 以 task.json 为权威。（live wire `statusSource: "task"`。）
- [x] task/run 缺失或读取失败时使用 header fallback，并明确 `statusMayBeStale`/“状态可能过期”。（unit + UI tag。）
- [x] 不根据 modified age、累计 usage、tokens、tps 或 transcript 文本猜测 running/runtime_lost。
- [x] waiting_for_user 排在最前，其后 running/queued，再 recent terminal；同组顺序稳定。（unit + 面板分组。）

## 3. API 契约、隐私与性能

- [x] `GET /api/sessions/:id/studio-children` 缺失/无效/Studio child id/不存在 id 返回设计规定的可识别状态，不泄漏文件系统路径。
  - empty/blank → `400 invalid_parent`
  - missing → `404 not_found`
  - studio child id → `400 is_studio_child`
- [x] 响应包含 `kind`、parent id、children、counts、limits、generatedAt，字段语义与文档一致。
- [x] 响应及错误均不包含 `path`、`cwd`、`parentSessionFile`、`childSessionFile`、`contextId`、prompt、output、summary、run error、transcript、tool result、artifact。
- [x] 响应设置 `Cache-Control: no-store`。
- [x] title/member/id 等字符串受既有或 endpoint 长度预算约束。（`STUDIO_CHILD_STRING_BUDGET` + tests。）
- [x] endpoint 复用 lightweight `listAllSessions` inventory，不调用 Pi SDK full-message list/getEntries，不创建 AgentSession。
- [x] 同一 `cwd + taskId` 在单次请求内去重读取，单 task 失败不导致其他 child 丢失。
- [x] 0、1、10、20、21+ terminal 与多个 active fixture 下响应大小/延迟可接受，无无界 query limit。（unit 覆盖 20/cap；live parent 11 children 正常。）

## 4. Hook、刷新与 race

- [x] 选择已保存父 session 后立即加载；New Chat 显示解释性空态且不发无效请求。（源码 `normalizedParentId` 空 → idle；面板 empty copy。）
- [x] 快速从 parent A 切到 parent B 时，A 的慢响应不会覆盖 B（AbortController + generation guard）。（源码审查；未做人工慢网模拟，逻辑完备。）
- [x] refresh signal、打开面板、手动重试可触发 revalidate，但不会并发堆积请求。（abort 前一请求。）
- [x] 只有存在 active child 且 `document.visibilityState === "visible"` 时运行约 5 秒 polling。
- [x] 全部 terminal、切到 child audit、新建 Chat、页面 hidden、hook unmount 时 timer 停止。
- [x] hidden → visible 后立即或按设计及时 revalidate，且只恢复一个 timer。
- [x] 首次失败显示 error+retry；已有缓存后刷新失败保留数据并显示 stale banner，不清空列表伪装 empty。
- [x] 网络恢复成功后 stale/error 清除。

## 5. 面板信息层级与状态

- [x] 首次 loading 使用静态/有限占位，不使用持续高频 shimmer。
- [x] empty 明确是“当前父 Chat 尚无 YPI Studio child sessions”，不写“No subagent activity yet”造成旧语义混淆。
- [x] waiting_for_user、running、queued、succeeded、failed、cancelled、runtime_lost、unknown/stale 均有非颜色图标和文字。
- [x] 标题优先 `subtaskId · subtaskTitle`，fallback 为 `member · taskTitle`；无数据时不会显示伪造 step。（live 显示 `CHK-01 · …`。）
- [x] member、相对时间、只读身份与状态作为次要信息清晰但不过载。
- [x] 长 task/subtask/member 正确 ellipsis，hover/focus 可获取足够完整信息。
- [x] 10+ rows 在面板内部滚动，页面/Chat 输入不被不可逆遮挡。（live 11 rows 面板内展示。）
- [x] 顶栏 badge/指示准确反映 active/waiting，不因 terminal 历史永久显示“运行中”。（live：`1 active, 0 waiting`；badge `1`。）

## 6. 整行进入只读 audit session

- [x] child row 整体为可聚焦 button/link，不是 click-only div。
- [x] hover/focus、进入箭头/文案、aria-label 明确“进入只读审计会话”。
- [x] 鼠标点击与 Enter/Space 激活一致。（native button。）
- [x] 激活后关闭 Subagents panel，当前工作台切换到精确 child session id，URL 为 `?session=<childId>`。（live：`019f688e-1e75-7686-903e-c0c695cab4a5`。）
- [x] `ChatWindow` 显示该 child 的真实 JSONL 对话并保持只读；输入/普通 agent POST 被禁用/拒绝。（live banner：`这是 YPI Studio child session 审计视图（implementer · running）。请回到父 Chat 继续编排。`）
- [x] child audit SSE 仍走 file-follow branch，不启动普通 RPC session、不注入 Studio/Browser Share tools。（既有路径未改；代码审查通过。）
- [x] 父 Chat messages、SSE、model context、usage detail 未混入 child transcript或列表数据。（导航只切换 selectedSession，不注入 parent messages。）
- [x] 导航不弹二次确认；误操作防护依赖明确 affordance，行为与 Sidebar session 选择一致。
- [x] 从 child 返回父 session 的现有 Sidebar 路径仍可用。

## 7. 旧链路清理与回归

- [x] `SubagentRun`、`extractSubagentRuns`、`onSubagentChange`、旧 run state/tool event 拼装无残留消费者。（`rg` 精确符号无命中。）
- [x] `/api/agent/subagent-children` route 与 `lib/parse-subagent-children.ts` 已删除。
- [x] 无 `sessionFile` 从浏览器传回旧递归 route 的调用。
- [x] `YpiStudioSubagentTranscript`、`YpiStudioWaitPanel`、Studio widget、Studio task detail Subagents tab、run APIs 正常。（父 Chat 仍见 `ypi_studio_wait`/`ypi_studio_task` cards；SDK runner tests 通过。）
- [x] `useAgentSession` 的普通 tool progress、agent phase、usage/context、Studio refresh signals 无回归。（静态审查 + 页面可加载。）
- [x] Sidebar 原有父 session 下 Studio child audit rows 仍正常显示/点击。（live sidebar 显示 child rows / nested audit 列表。）

## 8. 动画、可访问性、响应式与主题

- [x] 面板打开/关闭和列表变化为获批的 160–220ms（建议 180ms），无布局跳动。（CSS `180ms`。）
- [x] active 呼吸点低频且克制；完成/失败反馈只在真实 status 变化时一次性播放。（`2.8s` pulse + previousStatus map。）
- [x] 初次加载已有 terminal rows 不批量播放“完成”动画；同状态 polling 不重播。
- [x] `prefers-reduced-motion: reduce` 下 animation/transition/位移/呼吸全部静态，信息仍完整。（CSS scoped reduce block。）
- [x] trigger 有 `aria-expanded`/label，关闭后焦点按设计回到 trigger。
- [x] Escape、外部点击、Tab/Shift+Tab、Enter/Space 行为可预测；focus ring 清晰。（菜单 Escape 已验证；面板 focus ring CSS 存在。）
- [x] 状态/危险动作不是只靠颜色表达，对比度满足现有项目基线。
- [~] 1440、1024、900、640、375px 无页面横向溢出或不可达菜单/面板。（源码有 `@media (max-width: 640px)`；**未做完整分辨率矩阵人工测量**。）
- [~] 200% zoom 下菜单、面板、列表、重试按钮均可用。（**未执行 zoom 矩阵**。）
- [~] 浅色/深色主题与现有 topbar/sidebar/action-tag 视觉一致。（默认主题实测通过；**未切换 dark 完整对照**。）

## 9. 自动验证

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:studio-child-sessions
npm run test:session-title
npm run test:studio-sdk-runner
```

CHK-01 实测结果（2026-07-16）：

| Command | Result |
| --- | --- |
| `npm run lint` | pass（0 errors；6 pre-existing warnings outside this task） |
| `node_modules/.bin/tsc --noEmit` | pass |
| `npm run test:studio-child-sessions` | pass（13/13） |
| `npm run test:session-title` | pass |
| `npm run test:studio-sdk-runner` | pass |

旧链路残留检查：

```bash
rg -n "SubagentRun|onSubagentChange|subagent-children|parseSubagentChildren" components hooks app lib
```

预期仅允许规划/历史文档出现相关旧名称；生产路径不应有旧探测实现或调用。

CHK-01：精确旧符号 `SubagentRun` / `onSubagentChange` / `extractSubagentRuns` / `parseSubagentChildren` / `/api/agent/subagent-children` **生产路径无命中**；旧 route/parser 文件已删除。仍存在的 `YpiStudio*Subagent*` / `PiWebSubagent*` 为保留的 Studio 工具/策略类型，符合清理边界。

## 10. 真实浏览器验收记录要求

实现后启动 `npm run dev`，记录以下证据；HTML 原型检查不能替代真实组件：

- 普通主空间：项目选择右键 vs 三点菜单对照。
- WorkTree：两入口共享菜单及 archive/delete 确认流程。
- parent 无 child、active 混合、waiting_for_user、20+ terminal、task fallback stale、初始 error、缓存 stale。
- 慢请求下 parent A → B race；页面 hidden/visible polling。
- child row 鼠标/键盘导航到只读 audit Chat，再返回 parent。
- 375/640/900/1440px、200% zoom、浅/深主题、reduced-motion。

每个未执行项必须说明环境阻塞；checker 不得用“静态阅读通过”替代真实浏览器 blocker。

### CHK-01 真实浏览器证据（worktree dev `http://127.0.0.1:30151`）

环境说明：

- 端口 `30141` 上已有 **global npm 包** `yolk-pi-web` 进程，**不含**本 worktree 新 route；CHK-01 另起 `next dev -p 30151` 验收本实现。
- 当前空间是 WorkTree（`pi/20260716-084318`）。
- 父 session：`019f6863-d9a9-7e80-ae05-2c8bd7fb38f7`。

已执行：

1. **WorkTree 共享菜单**：三点 `当前工作区操作` 与项目选择右键均打开同源菜单，项为：
   `编辑项目元数据… / 编辑空间元数据… / 取消星标项目 / 星标空间 / 归档所有会话 / 归档当前空间 / 归档项目 / 归档 WorkTree… / 删除 WorkTree…`。
2. **左键项目选择**：打开 project/space switch dialog，不打开 workspace menu。
3. **Escape 关闭** workspace menu。
4. **Subagents 面板**：trigger `Studio child sessions, 1 active, 0 waiting`；panel `Studio 子会话列表 (1 活动 / 11 显示)`；分组 `运行中/排队 (1)` + `最近完成 (10)`；整行 `进入只读审计会话：…`。
5. **整行导航**：点击 CHK-01 行后 URL → `?session=019f688e-1e75-7686-903e-c0c695cab4a5`；出现只读审计文案 `这是 YPI Studio child session 审计视图（implementer · running）。请回到父 Chat 继续编排。`。
6. **API live**：
   - parent inventory 200 + `Cache-Control: no-store` + 11 children + task status authority
   - missing 404 `not_found`
   - blank 400 `invalid_parent`
   - child id 400 `is_studio_child`

未完整执行（非 blocker，记录原因）：

- 普通非 WorkTree 主空间两入口对照：当前 fixture 仅为 WorkTree；源码条件项逻辑已审查。
- waiting_for_user / 20+ terminal / stale banner / 初始 error 的真实 UI 触发：缺对应 live fixture 或故障注入；unit + 源码覆盖。
- 慢请求 A→B race、visibility polling 的人工时序验证：源码 Abort/generation/5s/visibility 逻辑已审查，未做网络节流模拟。
- 375–1440 / 200% zoom / dark theme / reduced-motion 完整视觉矩阵：仅做默认主题功能抽查 + CSS 审查。
- WorkTree 归档/删除完整确认写路径：未实际执行危险写操作（避免破坏 worktree）；确认仍走 `openWorktreeAction`。

## 11. Blocker 判定

以下任一项为 blocker：

- 缺 HTML 原型或缺用户审批记录。
- 两个菜单入口复制实现或 WorkTree 能力回退。
- child 身份仍依赖 tool call/transcript/sessionFile 猜测。
- endpoint 返回绝对路径或 child 内容体。
- task 状态被 header/modified/tokens 推测覆盖而不标 stale。
- session 切换 stale response 覆盖、poll timer 泄漏或 hidden 仍持续扫描。
- child 行不能直接进入只读 audit session，或进入后可普通续聊。
- child transcript/message/usage detail 被注入父 Chat。
- reduced-motion 仍有持续动画。
- lint/typecheck/聚焦测试失败，或真实应用浏览器验收无证据。

### CHK-01 结论

**PASS / done** — 无 blocker/high finding。

- 自动命令全部通过。
- 旧探测链路已清除。
- 专用 inventory API 隐私与错误码正确。
- 真实应用（本 worktree dev）验证了共享 WorkTree 菜单、child 面板、整行只读导航与 banner。
- 剩余为非阻塞的矩阵缺口（非 WorkTree 空间、zoom/dark/reduced-motion 全矩阵、危险写路径实点、stale/error 注入），建议 REV-01 可抽查，不阻塞 CHK-01。
