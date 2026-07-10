# implement（已根据用户反馈修正 P3）

## 执行顺序

**P1 → P2（可合并一个 PR）→ P3（UI 原型审批后，分两步灰度）。** P1/P2 均为前端逻辑，无 UI 布局门禁；P3 触发 UI 原型门禁，须等 [ui.md](ui.md) HTML 原型 + 用户审批后再启动。

## 需先阅读的文件

- `components/AppShell.tsx`：`handleCwdChange` / `handleSelectSession` / `handleNewSession` / `handleSessionForked` / `handleInitialRestoreDone` / `activeProjectContext` / `activeCwd` / `rightPanelMode` / `rightPanelOpen` / 右面板渲染（~L1408–L1470）/ `explorerRefreshKey`(L133) / `handleOpenFile` / `handleAtMention`
- `components/SessionSidebar.tsx`：`loadProjects` / `loadSessions`(~L465) / `onCwdChange` effect / `onProjectSpaceChange` effect / restore effect / auto-select effect / cwd-sync effect / FileExplorer 底部区块（~L2085–L2210）及其状态 `explorerOpen/explorerHeight/explorerKey/explorerRefreshDone/explorerResizing/explorerSectionRef/handleExplorerResizePointerDown`（~L360–L415, L605–L607）
- `components/FileExplorer.tsx`：Props（cwd/onOpenFile/refreshKey/onAtMention）与内部 `cwdChanged` 重载逻辑（L269–L287）——确认无需为 P3-4 加额外信号
- `hooks/useAgentSession.ts`：`newSessionProjectContext` 如何写 session header projectId/spaceId
- `lib/workspace-title.ts`：`projectContextMatchesBrowserTitle` / `sameWorkspacePathForTitle`（P1 复用思路，新增 `spaceContextMatchesSession`）
- `AGENTS.md`「Project Invariants」

## Implementation Plan（人类可读子任务表）

| phase | order | id | title | files | dependsOn | parallelizable | localReview |
| --- | --- | --- | --- | --- | --- | --- | --- |
| p1 | 1 | p1-reset-effect | AppShell 新增 `spaceContextMatchesSession` + `resetOnSpaceSwitch` + active-space 重置 effect | `components/AppShell.tsx`, `lib/workspace-title.ts` | — | false | true |
| p1 | 2 | p1-trim-cwdchange | 精简 `handleCwdChange`：只保留 activeCwd/fileTabs/rightPanel 同步；移除 session/URL/branch/system/git 重置 | `components/AppShell.tsx` | p1-reset-effect | false | true |
| p1 | 3 | p1-regress | 8 类切换路径 + URL 恢复 + 首屏 auto-select 人工回归 | — | p1-trim-cwdchange | true | true |
| p2 | 4 | p2-skeleton-race | `loadSessions` 加 `sessionsSwitching` + token 竞态保护；space 变化触发 skeleton | `components/SessionSidebar.tsx` | — | true | true |
| p2 | 5 | p2-skeleton-ui | 列表区 skeleton 占位 + pointerEvents none + 错误态/空态判断调整 | `components/SessionSidebar.tsx` | p2-skeleton-race | false | true |
| p3 | 6 | p3-move-state | 把 `explorerOpen/explorerHeight/explorerKey/explorerRefreshDone/explorerResizing/explorerSectionRef/handleExplorerResizePointerDown` 及 localStorage 读写从 SessionSidebar 迁到 AppShell（新 key `pi-web-preview-explorer-height/open`） | `components/AppShell.tsx`, `components/SessionSidebar.tsx` | UI 原型审批 | false | true |
| p3 | 7 | p3-render-in-panel | AppShell 右面板 `files` 模式顶部渲染可折叠 FileExplorer 区块；explorerCwd=`activeCwd ?? activeProjectContext?.cwd`；移除 sidebar 底部 FileExplorer 整段 | `components/AppShell.tsx`, `components/SessionSidebar.tsx` | p3-move-state | false | true |
| p3 | 8 | p3-cleanup-props | 移除 SessionSidebar 不再使用的 `explorerRefreshKey` prop（核验 `onOpenFile`/`onAtMention` 是否仍被 sidebar 引用，按需保留）；`rg` 全仓确认无残留透传 | `components/SessionSidebar.tsx`, `components/AppShell.tsx` | p3-render-in-panel | true | true |

## 各子任务改动点

### p1-reset-effect

1. `lib/workspace-title.ts` 新增并 export 纯函数 `spaceContextMatchesSession(context, session, newSessionCtx)`：projectId+spaceId 比对（不看 cwd 字符串）。session 有 projectId/spaceId 用 session；否则用 newSessionCtx；否则 false。复用 `projectContextMatchesBrowserTitle` 思路但只看 id。
2. `components/AppShell.tsx` 新增 `resetOnSpaceSwitch(context)` 见 design P1。
3. 新增 effect 依赖 `activeProjectContext`（见 design）。effect 内读 `selectedSession/newSessionProjectContext/initialSessionRestored/rightPanelMode` 取最新闭包；deps 只挂 `activeProjectContext`。

### p1-trim-cwdchange

- `handleCwdChange` 保留：`if(cwd!==activeCwd){setFileTabs([]);setActiveFileTabId(null);if(rightPanelMode==="files")setRightPanelOpen(false);} setActiveCwd(cwd);`
- 移除：session 清空、newSessionCwd 收敛、sessionKey++、branch/system/toppanel/git reset、`router.replace("/")`。
- 保留 `if(!cwd||suppressCwdBumpRef.current) return;`。
- 清理失效 deps（router 等若不再用）。

### p2-skeleton-race

1. 新增 `const [sessionsSwitching,setSessionsSwitching]=useState(false)`、`const loadSessionsTokenRef=useRef(0)`、`const prevSpaceKeyRef=useRef<string|null>(null)`。
2. `loadSessions` 开 token；`showLoading` 时清旧列表 + 清批量选择 + collapsed/archived；所有 setState 前 token 判；catch token 判后 setError；finally token 匹配后 setSessionsSwitching(false)；`findProjectSpace` 提前 return 分支 `setSessionsSwitching(false)`。
3. space 重载 effect：用 `prevSpaceKeyRef` 检测 `${projectId}/${spaceId}` 变化决定 showLoading。

### p2-skeleton-ui

- 列表容器：`error`（非 switching）→ `sessionsSwitching` skeleton → `loading`(首屏) → 空项目/空会话 → `sessionTree`。
- skeleton 4 行 `SkeletonRow`，`pointerEvents:none`、`aria-busy:"true"`；"No sessions" 判断追加 `&& !sessionsSwitching`。

### p3-move-state

1. 在 AppShell 引入状态：`explorerOpen`(useState true)、`explorerHeight`(useState `getInitialExplorerHeight()`，首值兼容读旧 `pi-web-sidebar-explorer-height`)、`explorerKey`(useState 0)、`explorerRefreshDone`(useState false)、`explorerResizing`(useState false)、`explorerSectionRef`、`explorerRefreshTimerRef`、`previewContentRef`（测预览内容区高度）。
2. localStorage 迁移：新 key `pi-web-preview-explorer-height`/`pi-web-preview-explorer-open`；`getInitialExplorerHeight()` 读旧 key 作首值并写入新 key（一次）。
3. `explorerRefreshKey` 现有 AppShell state（L133）已 bump 给 sidebar → 改为自己消费：`useEffect(()=>{setExplorerKey(k=>k+1);},[explorerRefreshKey]);`（与 sidebar L605 同效）。
4. `handleExplorerResizePointerDown` 重写：分隔条在 explorer 底部，`maxHeight=max(MIN_EXPLORER_HEIGHT, startHeight + previewContentHeight - MIN_PREVIEW_HEIGHT)`，MIN_PREVIEW_HEIGHT 给一个保底（如 120），用 `previewContentRef` 测量。
5. SessionSidebar 删除上述状态与 `handleExplorerResizePointerDown`、`sessionListRef` 中与 explorer 共享高度相关逻辑（sessionListRef 本身仍供 list 测量/滚动，保留）。

### p3-render-in-panel

1. AppShell 右面板 `rightPanelMode==="files"` 分支内，现有 TabBar 行**之上**插入新区块：

   ```tsx
   {rightPanelOpen && (() => {
     const explorerCwd = activeCwd ?? activeProjectContext?.cwd ?? null;
     if (!explorerCwd) return null;
     return (
       <div ref={explorerSectionRef} style={{ display:"flex", flexDirection:"column", flex: explorerOpen ? `0 1 ${explorerHeight ?? "40%"}px` : "0 0 auto", minHeight:0, overflow:"hidden", borderBottom:"1px solid var(--border)" }}>
         {/* 标题行：项目空间信息 + 刷新按钮 + 折叠/展开 */}
         {/* 展开时：<FileExplorer cwd={explorerCwd} onOpenFile={handleOpenFile} refreshKey={explorerKey} onAtMention={handleAtMention} /> */}
         {/* 底部分隔拖拽条（handleExplorerResizePointerDown） */}
       </div>
     );
   })()}
   ```

2. 标题行样式沿用 sidebar 原有「项目空间信息」行（折叠箭头 rotate、刷新按钮绿勾态），保持视觉一致。
3. 折叠态（`explorerOpen=false`）仅渲染标题行 + 展开按钮，FileExplorer 不挂载（与现状一致）。
4. SessionSidebar 删除底部 `{/* File Explorer section */}` 整段（L2085–L2210）及其外层门控；保留其上 session 列表区与 Trellis 提示。

### p3-cleanup-props

- `rg "explorerRefreshKey" components/` 确认除 AppShell 透传 sidebar 外无其它消费者；移除 SessionSidebar Props 中 `explorerRefreshKey` 与 AppShell 透传行（sidebar 不再渲染 explorer，该 prop 仅 sidebar 需要即可删）。
- `rg "onOpenFile\|onAtMention" components/SessionSidebar.tsx` 确认 sidebar 是否还有除 explorer 外的 `onOpenFile`/`onAtMention` 引用；若仅 explorer 用，则一并从 Props/透传移除；若 session 右键菜单等仍需，保留。
- 注意 `explorerRefreshKey` AppShell state 仍保留（自己消费）。

## 验证命令

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run dev   # 手工回归（见 checks.md）
```

> 不跑 `npm run build`（开发期禁用，见 AGENTS.md）。

## 检查门禁

- P1/P2：lint + tsc 通过 + 8 类切换路径 + URL 恢复 + skeleton/竞态手工验收全绿。
- P3：UI 原型 HTML 由 UI 设计员产出、用户在 ui.md 审批后再启动 p3-*；纳入 checks.md「P3 回归点」。

## Implementation Plan（机器可读）

```json ypi-implementation-plan
{
  "schemaVersion": 1,
  "taskId": "20260709-193808",
  "phases": [
    {
      "phase": "p1",
      "subtasks": [
        {
          "id": "p1-reset-effect",
          "title": "AppShell 新增 active-space 重置 effect 与 resetOnSpaceSwitch，复用 spaceContext 匹配",
          "phase": "p1",
          "order": 1,
          "dependsOn": [],
          "files": ["components/AppShell.tsx", "lib/workspace-title.ts"],
          "instructions": "新增 spaceContextMatchesSession 纯函数（projectId+spaceId 比对，不看 cwd 字符串）；新增 resetOnSpaceSwitch 写 selectedSession=null/newSessionCwd/newSessionProjectContext/sessionKey++/branchTree/branchActiveLeafId/systemPrompt/activeTopPanel/gitRefreshKey++/gitDirty/fileTabs/activeFileTabId/rightPanel(files)close/router.replace('/');新增依赖 activeProjectContext 的重置 effect，gate initialSessionRestored。",
          "acceptance": "activeProjectContext 变化且与新 session/newSessionProjectContext 不匹配时触发一次 reset；URL 恢复时不被清；首屏 auto-select 进入空会话态。",
          "validation": "tsc --noEmit; 人工回归 checks 切换路径矩阵 #1-#8",
          "risks": ["reset 误触发（restore/auto-select）"],
          "parallelizable": false,
          "localReview": true
        },
        {
          "id": "p1-trim-cwdchange",
          "title": "精简 handleCwdChange：只保留 activeCwd/fileTabs/rightPanel 同步",
          "phase": "p1",
          "order": 2,
          "dependsOn": ["p1-reset-effect"],
          "files": ["components/AppShell.tsx"],
          "instructions": "移除 handleCwdChange 内 setSelectedSession/!cwd setNewSessionCwd/sessionKey++/branch/system/toppanel/git reset/router.replace；保留 setActiveCwd 与 fileTabs/rightPanel(files) 同步与 suppressCwdBumpRef 守卫。",
          "acceptance": "切空间后 activeCwd 仍正确切换（供 explorer 复用）；不出现重复 sessionKey bump。",
          "validation": "tsc --noEmit; npm run lint; 人工回归点列表 session 不重置",
          "risks": ["漏清"],
          "parallelizable": false,
          "localReview": true
        },
        {
          "id": "p1-regress",
          "title": "8 类切换路径 + URL 恢复 + 首屏 auto-select 人工回归",
          "phase": "p1",
          "order": 3,
          "dependsOn": ["p1-trim-cwdchange"],
          "files": [],
          "instructions": "按 checks.md 切换路径回归矩阵逐项操作，记录 URL/selectedSession/聊天区/列表状态。",
          "acceptance": "矩阵 #1-#8 全绿。",
          "validation": "手工",
          "risks": [],
          "parallelizable": true,
          "localReview": true
        }
      ]
    },
    {
      "phase": "p2",
      "subtasks": [
        {
          "id": "p2-skeleton-race",
          "title": "loadSessions 加 sessionsSwitching + token 竞态保护；space 变化触发 skeleton",
          "phase": "p2",
          "order": 4,
          "dependsOn": [],
          "files": ["components/SessionSidebar.tsx"],
          "instructions": "加 sessionsSwitching state、loadSessionsTokenRef、prevSpaceKeyRef；loadSessions 开 token+showLoading 时清旧列表/批量选择/archived 展开态；所有 setState 前 token 判；catch token 判后 setError；finally token 匹配后 setSessionsSwitching(false)；提前 return 分支也置 false。space 重载 effect 用 prevSpaceKeyRef 决定 showLoading。",
          "acceptance": "快速连续切两空间慢响应不覆盖新列表；切换瞬间 skeleton；后台刷新不闪。",
          "validation": "tsc --noEmit; 构造慢响应/断网回归",
          "risks": ["token 提前 return 漏 setSessionsSwitching(false) 卡死"],
          "parallelizable": true,
          "localReview": true
        },
        {
          "id": "p2-skeleton-ui",
          "title": "列表区 skeleton 占位 + pointerEvents none + 错误态/空态判断",
          "phase": "p2",
          "order": 5,
          "dependsOn": ["p2-skeleton-race"],
          "files": ["components/SessionSidebar.tsx"],
          "instructions": "渲染优先级 error(非switching)→sessionsSwitching skeleton→loading→空→sessionTree；skeleton 4 行 pointerEvents:none aria-busy；No sessions 判断加 &&!sessionsSwitching。",
          "acceptance": "skeleton 期间列表无交互且不误显空态。",
          "validation": "手工",
          "risks": [],
          "parallelizable": false,
          "localReview": true
        }
      ]
    },
    {
      "phase": "p3",
      "subtasks": [
        {
          "id": "p3-move-state",
          "title": "explorer 状态从 SessionSidebar 迁到 AppShell（新 localStorage key）",
          "phase": "p3",
          "order": 6,
          "dependsOn": [],
          "files": ["components/AppShell.tsx", "components/SessionSidebar.tsx"],
          "instructions": "AppShell 引入 explorerOpen/explorerHeight/explorerKey/explorerRefreshDone/explorerResizing/explorerSectionRef/previewContentRef；localStorage 迁新 key pi-web-preview-explorer-height/open，首值兼容读旧 key；explorerRefreshKey effect 自己 bump explorerKey；重写 handleExplorerResizePointerDown 用 previewContentRef 测量 min/max；sidebar 删除上述状态与拖拽逻辑。",
          "acceptance": "状态读写迁移完成，sidebar 不再持有 explorer 状态；预览区折叠/拖拽可用。",
          "validation": "tsc --noEmit; npm run lint",
          "risks": ["高度拖拽 min/max 误算","localStorage 用户偏好丢失"],
          "parallelizable": false,
          "localReview": true
        },
        {
          "id": "p3-render-in-panel",
          "title": "右面板 files 模式顶部渲染可折叠 FileExplorer；移除 sidebar 底部 explorer 整段",
          "phase": "p3",
          "order": 7,
          "dependsOn": ["p3-move-state"],
          "files": ["components/AppShell.tsx", "components/SessionSidebar.tsx"],
          "instructions": "右面板 files 分支在 TabBar 行之上插入 explorerCwd 守卫的「项目空间信息」可折叠区块（标题行+刷新+折叠/展开+FileExplorer+底部拖拽条）；explorerCwd=activeCwd??activeProjectContext?.cwd；折叠态不挂载 FileExplorer；sidebar 删除底部 File Explorer section 整段与外层门控。",
          "acceptance": "sidebar 仅剩顶部选择空间区+session 列表+Trellis 提示；预览区顶部可折叠文件浏览器；切换空间后重载。",
          "validation": "手工 P3-1..P3-5",
          "risks": ["门控与 reset 叠加（reset 关右面板后重开重载）"],
          "parallelizable": false,
          "localReview": true
        },
        {
          "id": "p3-cleanup-props",
          "title": "移除 SessionSidebar 冗余 explorer prop，rg 全仓确认无残留",
          "phase": "p3",
          "order": 8,
          "dependsOn": ["p3-render-in-panel"],
          "files": ["components/SessionSidebar.tsx", "components/AppShell.tsx"],
          "instructions": "rg explorerRefreshKey 确认仅 AppShell→sidebar 透传后移除该 Props+透传；rg onOpenFile/onAtMention 在 sidebar 内引用情况，仅 explorer 用则一并移除 Props+透传，否则保留。",
          "acceptance": "tsc/lint 通过；无 dead prop 透传。",
          "validation": "rg + tsc --noEmit + npm run lint",
          "risks": ["误删仍被引用 prop"],
          "parallelizable": true,
          "localReview": true
        }
      ]
    }
  ]
}
```