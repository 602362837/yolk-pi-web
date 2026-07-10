# design（已根据用户反馈修正 P3）

本设计基于对 `components/SessionSidebar.tsx`、`components/AppShell.tsx`、`components/FileExplorer.tsx`、`hooks/useAgentSession.ts` 的实地阅读，只动前端，不碰 Project Registry / JSONL / 后端 API / WorkTree 语义。

> ⚠️ P3 在本轮被**重新设计**。上一轮把「项目空间信息条（项目名/副标题/WT badge/Workspace 菜单）」当成要从 sidebar 移走的内容，是错误理解。正确理解见 prd.md P3：移走的是 **sidebar 底部的 FileExplorer 文件浏览器**，sidebar 顶部的「选择空间区域**保持不动**。

## 方案摘要

三个问题集中在「切换链路的状态驱动来源」和「FileExplorer 的宿主位置」：

- **P1**：AppShell 的 session 重置依赖 `handleCwdChange`，sidebar 的 cwd 通知 effect 用 `cwdForApp = selectedCwdProp ?? selectedCwd`，切换瞬间 `selectedCwdProp`（旧 session 的 cwd）遮蔽 sidebar 自己的 `selectedCwd`，导致 `onCwdChange` 不触发，重置链断裂。修正：把重置从「cwd 字符串变化」提升为「active space 变化」，由 `activeProjectContext` 驱动。
- **P2**：`loadSessions` 默认 `showLoading=false`，fetch resolve 前 `allSessions` 仍是旧空间数据，且无竞态保护。修正：引入 `sessionsSwitching` + token 竞态保护，space 变化才 skeleton。
- **P3（修正后）**：FileExplorer 当前在 `SessionSidebar` 底部的「项目空间信息」折叠区（约 L2085–L2210），用 `selectedCwdProp ?? selectedCwd` 作 cwd、`explorerKey` 作 refreshKey、`onOpenFile`、`onAtMention` 作回调，并自带 `explorerOpen` 折叠态与 `explorerHeight` 可拖拽高度。修正：把这段整体迁出 sidebar，作为**预览区（右面板 `right-panel-container`）内部顶部**一个可折叠的「文件浏览器」区块；sidebar 仅保留顶部选择空间区域 + session 列表 + Trellis 提示。FileExplorer 内部已按 `cwd` 变化自动 reset 展开/重载，故「切换空间重载」由 cwd 变化天然满足。

## 影响模块和边界

| 模块 | 改动 | 边界 |
| --- | --- | --- |
| `components/AppShell.tsx` | 新增 active-space 切换重置 effect（P1）；精简 `handleCwdChange`（P1）；在右面板 `files` 模式顶部插入可折叠 FileExplorer 区块（P3）；接管 `explorerOpen/explorerHeight/explorerKey` 等状态，复用 `activeCwd` 作 explorer cwd | 不改 `useAgentSession` hook、不改 ChatWindow props、不改 `rightPanelMode==="studio"/"trellis"` 两支渲染 |
| `components/SessionSidebar.tsx` | P1：不动顶部「选择空间区域」（切换按钮 / 项目名副标题 / WT badge / Workspace 菜单 / WorkTree 右键）；P2：`loadSessions` 加 skeleton 竞态；P3：**移除**底部「项目空间信息」整段 FileExplorer 渲染及其 `explorerOpen/explorerHeight/explorerKey/explorerResizing/explorerSectionRef/handleExplorerResizePointerDown` 等状态/逻辑 | 保留 session 列表 / 顶部选择空间区域 / 批量归档 / Trellis 提示 |
| `components/FileExplorer.tsx` | 不改组件本体 | 内部已按 `cwd` 变化 reset 展开/重载，天然满足 P3-4 |
| `lib/workspace-title.ts` | P1 纯新增 `spaceContextMatchesSession` | 不改现有函数签名 |
| `lib/*`、`app/api/**` | 不改 | 不碰 Registry / JSONL / API |

## 数据流与契约

### FileExplorer 现状（证据）

- 宿主：`SessionSidebar` 底部「项目空间信息」折叠区（~L2085），整段由 `{(selectedCwdProp || selectedCwd) && (...)}` 门控。
- cwd 来源：`cwd={selectedCwdProp ?? selectedCwd!}`。其中 `selectedCwdProp` 是 AppShell 透传的 `selectedSession?.cwd ?? newSessionCwd ?? null`；`selectedCwd` 是 sidebar 内部选空间后的 `space.path`。
- refreshKey：sidebar 内部 `explorerKey`（初始 0，受 `explorerRefreshKey`(AppShell `explorerRefreshKey` state) prop 触发 bump）。
- 回调：`onOpenFile`（AppShell `handleOpenFile`）、`onAtMention`（AppShell `handleAtMention`）。
- 折叠/高度：`explorerOpen`(默认 true)、`explorerHeight`(localStorage 持久 `pi-web-sidebar-explorer-height`，MIN 120)、`explorerResizing`、拖拽分隔条 `handleExplorerResizePointerDown` 复用 `sessionListRef` 与 session 列表共享高度。
- `FileExplorer` 组件内部：`useEffect([cwd, refreshKey])` 中 `cwdChanged = prevCwdRef.current !== cwd`，变化时 `setExpandedPaths(new Set())`、`setLoading(true)`、`setRootMeta(null)`、重新 `fetchEntries`。**故「切换空间重载」由 cwd 变化天然满足，无需额外信号。**

### P1·Session 重置：由 active-space 变化驱动（不变）

同上一轮已审阅方案，要点：

- 新增 `resetOnSpaceSwitch(context)`：`setSelectedSession(null); setNewSessionCwd(context.cwd); setNewSessionProjectContext({projectId,spaceId}); setSessionKey(k+1); setBranchTree([]); setBranchActiveLeafId(null); setSystemPrompt(null); setActiveTopPanel(null); setGitRefreshKey(k+1); setGitDirty(false); setFileTabs([]); setActiveFileTabId(null); rightPanelMode==="files" 时 setRightPanelOpen(false); router.replace("/",{scroll:false});`
- effect 依赖 `activeProjectContext`：`if(!activeProjectContext||!initialSessionRestored) return; if(spaceContextMatchesSession(activeProjectContext, selectedSession, newSessionProjectContext)) return; resetOnSpaceSwitch(...);`
- `spaceContextMatchesSession(context, session, newSessionCtx)` 比对 `projectId+spaceId`（不看 cwd 字符串，避免 pathKey/symlink 歧义）：session 有 id 用 session；否则用 newSessionCtx；否则 false。
- 精简 `handleCwdChange` 只保留 `setActiveCwd` + fileTabs/rightPanel 同步，移除 session/URL/branch/system/git 重置（职责上移到 `resetOnSpaceSwitch`）。
- 八类切换路径与 URL 恢复/首屏 auto-select 的覆盖论证不变（见 checks.md 回归矩阵）。

**P1 与 P3 的叠加点**：`resetOnSpaceSwitch` 里 `rightPanelMode==="files" 时 setRightPanelOpen(false)` 仍保留。P3 把 FileExplorer 放进右面板内顶部，切换重置时右面板会收起；文件浏览器折叠态 `explorerOpen` 不受 reset 影响（保持用户上次折叠偏好），但 explorer 的 cwd 跟随 `activeCwd` 变化，复用时自动重载。该交互需在 UI 原型中确认：切换后右面板关闭、再次打开预览面板时文件浏览器反映新空间。

### P2·列表加载态：skeleton + 竞态保护（不变）

- 状态：`sessionsSwitching: boolean`（与既有 `loading` 解耦）、`loadSessionsTokenRef = useRef(0)`、`prevSpaceKeyRef`。
- `loadSessions`：开 token；`showLoading` 时 `setSessionsSwitching(true); setAllSessions([]); setSelectedForArchive(new Set()); setArchivedExpanded(false); setArchivedSessions([])`；所有 setState 前 token 判；catch 保留错误态；finally（token 匹配）`setSessionsSwitching(false)`；`findProjectSpace` 提前 return 处也 `setSessionsSwitching(false)`。
- space 重载 effect：用 `prevSpaceKeyRef` 检测 space 变化决定 `showLoading`。
- UI：`sessionsSwitching` 渲染 4 行 skeleton + `pointerEvents:none`，"No sessions" 判断追加 `&& !sessionsSwitching`。

### P3·FileExplorer 上移到预览区（修正后，本轮核心）

> ⚠️ 触发 UI 原型门禁。本轮为架构师产出**目标架构与非门禁相关行为**；HTML 原型须由 UI 设计员基于本设计产出并通过用户审批后才能进入 p3 渲染层实现（见 ui.md）。P1/P2 可先行实现。

**目标布局（右面板 `right-panel-mode==="files"` 内）**：

```
right-panel-container
 ├─ 文件浏览器区块（可折叠）  ← P3 新位置
 │   ├─ 标题行：「项目空间信息」+ 刷新按钮 + 折叠/展开按钮
 │   └─ 展开时：<FileExplorer cwd={activeCwd ?? workspaceCwd} .../>
 ├─ 现有 TabBar 行（fileTabs）
 └─ 现有 FileViewer 区
```

**状态归属（迁到 AppShell）**：

| 状态/资源 | 现位置(sidebar) | 迁后(AppShell) | 说明 |
| --- | --- | --- | --- |
| `explorerOpen` | sidebar | AppShell | 折叠态，默认 true；持久化建议迁用新 key `pi-web-preview-explorer-open`（或复用旧 explorer 折叠含义；UI 原型确认） |
| `explorerHeight` | sidebar + localStorage `pi-web-sidebar-explorer-height` | AppShell + 新 key `pi-web-preview-explorer-height` | 预览区高度语义变了，存新 key；旧 sidebar 高度控制删除 |
| `explorerKey` | sidebar | AppShell | explorerRefreshKey 触发 bump |
| `explorerRefreshDone` | sidebar | AppShell | 刷新完成 2s 绿勾反馈 |
| `explorerResizing` | sidebar | AppShell | 垂直分隔条拖拽；max/min 与下方 TabBar/FileViewer 共享高度 |
| `explorerSectionRef` | sidebar | AppShell | 同步改 ref 绑到新区块 |
| `handleExplorerResizePointerDown` | sidebar（复用 sessionListRef） | AppShell（改为与下方 FileViewer/TabBar 区共享高度） | 拖拽语义从「与 session 列表争高度」改为「与预览内容争高度」 |

**cwd 来源（关键变化）**：

- sidebar 内 `selectedCwdProp ?? selectedCwd` 在 AppShell 视角即 `activeCwd`（`activeCwd` 本就来自 `selectedSession?.cwd ?? newSessionCwd`，与 `selectedCwdProp` 同源）。AppShell 可直接用 `activeCwd` 作 explorer cwd；若 `activeCwd` 为空但已有 `activeProjectContext`（新空间首条 prompt 前的空状态），fallback 用 `activeProjectContext.cwd`。

  ```
  const explorerCwd = activeCwd ?? activeProjectContext?.cwd ?? null;
  ```

  与 P1 重置叠加：`resetOnSpaceSwitch` 已 `setNewSessionCwd(context.cwd)`，但 `activeCwd` 由 `handleCwdChange(context.cwd)` 同步（精简后仍 `setActiveCwd`）。需确保 sidebar 切空间后 `onCwdChange` 仍把新 space cwd 传上来；P1 精简只移除「重置职责」，保留「activeCwd 同步」，故 explorerCwd 会自然切换并触发 FileExplorer 重载。✅ P3-4 达成。

- AppShell 已有 `explorerRefreshKey` state（L133）和 `onOpenFile=handleOpenFile`、`onAtMention=handleAtMention`，直接复用喂给 FileExplorer。

**渲染门控**：

- 仅 `rightPanelMode === "files"` 且 `rightPanelOpen` 时渲染文件浏览器区块（studio/trellis 模式不显示文件浏览器）。
- `explorerCwd` 为空时不渲染区块（无空间）。
- 折叠态（`explorerOpen=false`）只显示标题行 + 展开按钮，FileExplorer 不挂载（与现状 `explorerOpen && (...)` 一致，节省渲染）。

**交互行为（待 UI 原型定稿，但保底）**：

- 折叠/展开：标题行按钮 `setExplorerOpen(v=>!v)`，展开/收起过渡动画（高度 transition）。
- 刷新：`setExplorerKey(k+1)` + `setExplorerRefreshDone(true)` + 2s 定时清。
- 高度拖拽：分隔条在文件浏览器底部，向下拖增大 explorer / 缩小预览内容，受 MIN_EXPLORER_HEIGHT 与预览区可用高度约束。
- 窄窗口：预览区本身在窄窗口可能被收起（用户切走 rightPanelOpen），不在编辑器顶栏挤占。

**与 P1/P2 不冲突论证**：

- P1 reset 关闭右面板（`setRightPanelOpen(false)`）→ FileExplorer 区块随之卸载（门控 `rightPanelOpen`）；下次打开预览面板，explorerCwd 已是新空间，FileExplorer 重载。无状态耦合到切换重置链。
- P2 只动 session 列表渲染与 `loadSessions`，与 FileExplorer 无共享状态。
- sidebar 移除底部 FileExplorer 后，`explorerRefreshKey`/`onOpenFile`/`onAtMention` 这些 props 可从 `SessionSidebar` Props 中**保留透传**（保持组件契约稳定，sidebar 不再用但 AppShell 仍可传；或移除并由 AppShell 直接消费）。推荐：从 SessionSidebar Props 中**移除** `explorerRefreshKey`，sidebar 不再渲染 explorer；`onOpenFile` 若 sidebar 仅作 explorer 回调则也可移除，但右键菜单「在新文件打开」等若仍需保留则审阅后决定。**本设计默认移除 `explorerRefreshKey`，`onOpenFile`/`onAtMention` 保留以备 sidebar 其它用途**（实现时核对实际调用点，避免删除仍被引用的 prop）。

## 兼容性、风险与回滚

- **R1·重置误触发**：restore/auto-select/点列表 session。缓解：`initialSessionRestored` gate + `spaceContextMatchesSession` 双门；P1 实现后逐一回归 8 类路径。
- **R2·精简 `handleCwdChange` 漏清**：所有切换都改 `selectedProjectId/SpaceId`，无「只改 cwd」路径；`activeCwd` 同步保留 → explorer cwd 正确切换。
- **R3·P3 门控与 reset 叠加**：reset 关右面板 → explorer 卸载 → 重开时按新 cwd 重载；需验收 reset 后 `rightPanelOpen=false` 与 `explorerOpen` 用户偏好不丢。
- **R4·高度拖拽语义变更**：从「与 session 列表争高度」改为「与预览内容争高度」，min/max 计算改用预览区容器高度而非 sessionListRef；实现需用新 ref 测量预览内容区高度。
- **R5·localStorage key 迁移**：旧 `pi-web-sidebar-explorer-height` 废弃，新 `pi-web-preview-explorer-height`；迁移时若想沿用用户上次高度可直接读旧 key 作首值，避免回归用户偏好丢失。建议：首值 `getInitialExplorerHeight()` 若旧 key 存在则读旧值并写入新 key。
- **R6·prop 契约破窗**：移除 SessionSidebar 的 `explorerRefreshKey`/可能 `onOpenFile` 前，`rg` 确认无其它组件透传该 prop。
- **回滚**：三块独立。P1 回滚：恢复 `handleCwdChange` 重置块 + 删 effect；P2 回滚：恢复 `loadSessions` 与渲染；P3 回滚：把 explorer 状态与渲染还原回 sidebar 底部（AppShell 顶部 explorer 渲染删掉，恢复 SessionSidebar 的 explorer Props）。

## 不变量遵守

- Project Registry 仍是项目列表唯一来源；不扫会话合成项目。
- pathKey 去重：新比较一律用 projectId+spaceId。
- `lib/normalize.ts`、SSE/JSONL、WorkTree 语义不动。
- 切换重置 `selectedSession` 为 `null`（空状态），首条 prompt 落盘由 `useAgentSession` 以 `newSessionProjectContext` 写 projectId/spaceId（既有能力，不动）。
- 不动侧边栏宽度；不动侧边栏顶部的选择空间区域。