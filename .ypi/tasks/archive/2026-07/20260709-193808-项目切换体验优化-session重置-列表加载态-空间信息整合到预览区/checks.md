# checks（已根据用户反馈修正 P3）

## 需求覆盖检查

| 需求 ID | 覆盖点 | 检查方式 |
| --- | --- | --- |
| P1-1 切换清 session + URL `?session=` | `resetOnSpaceSwitch` 设 selectedSession=null + router.replace("/") | 人工：8 类切换后 URL `/`、聊天区空状态 |
| P1-2 空状态落新空间 projectId/spaceId | reset 写 newSessionCwd/newSessionProjectContext；首条 prompt 落盘由 useAgentSession 写 | 人工：新空间发首条消息后查 header projectId/spaceId |
| P1-3 所有显式切换路径统一重置 | 唯一汇聚点 `activeProjectContext` 变化 effect | 人工：切换路径回归矩阵 |
| P1-4 URL 恢复不算切换 | `initialSessionRestored` gate + `spaceContextMatchesSession` | 人工：直接打开 `?session=xxx` 恢复后不被清 |
| P1-5 branch/system/git/panels 复位 | reset 清 branchTree/systemPrompt/activeTopPanel/git | 人工：切换后顶部面板反映新空间 |
| P2-1 切换瞬间 skeleton | `sessionsSwitching` + 即时清空 allSessions | 人工：切换无旧项目残影 + 骨架占位 |
| P2-2 加载中禁止点击 | skeleton 容器 pointerEvents none | 人工：skeleton 期间点击列表项无响应 |
| P2-3 后台刷新不闪 skeleton | 后台调用 `loadSessions(false)` | 人工：agent 结束/归档刷新平滑 |
| P2-4 竞态保护 | `loadSessionsTokenRef` 丢弃旧响应 | 构造：快速连续切两空间慢响应不覆盖新列表 |
| P2-5 失败保留错误态 | catch 分支 setError（受 token 保护） | 人工：断网/500 显示错误而非旧列表 |
| P3-1 sidebar 底部 FileExplorer 移到预览区顶部 | AppShell 右面板 files 模式顶部渲染；sidebar 不再渲染 | 人工：sidebar 底部无「项目空间信息」；预览区顶部有文件浏览器 |
| P3-2 sidebar 顶部选择空间区域保持不动 | 不动切换按钮/项目名副标题/WT badge/Workspace 菜单 | 人工：sidebar 顶部与改造前一致 |
| P3-3 预览区文件浏览器可折叠收回 | `explorerOpen` 折叠态预览内容占满 | 人工：点折叠收起，预览内容区高度撑满 |
| P3-4 切换空间文件浏览器重新加载 | explorerCwd=activeCwd??activeProjectContext?.cwd 变化触发 FileExplorer 内部 reset | 人工：切换空间后面包屑/文件树反映新 cwd；reset 关右面板后重开 explorer 反映新空间 |
| P3-5 保留文件浏览器全部能力 | 刷新按钮/文件树展开折叠/点击打开文件不变 | 人工：刷新绿勾、展开折叠、点击文件在预览面板打开 |

## 切换路径回归矩阵（P1-3 必须全绿）

| # | 路径 | 触发 | 期望 |
| --- | --- | --- | --- |
| 1 | 弹窗选择空间 | sidebar 顶部切换按钮→ProjectSpaceSwitchDialog→选空间 | 重置、URL `/`、列表 skeleton |
| 2 | 右键菜单切换（空间/主空间） | dialog 内右键→切换到此空间/主空间 | 重置、URL `/` |
| 3 | WorkTree 新建选中 | sidebar WorkTree 按钮 | 重置（new session 落新 cwd）、URL `/` |
| 4a | 注册-add path | dialog Add project path→输入 | 重置、URL `/`、列表 skeleton |
| 4b | 目录选择 | dialog 目录选择器 | 同上 |
| 4c | default-cwd | dialog 使用默认目录 | 同上 |
| 5 | Git clone | dialog git clone 提交 | 重置、URL `/` |
| 6 | WorkTree 归档·删除 fallback | WorkTree 菜单→归档/删除当前 WT | fallback 空间被选中、重置、URL `/` |
| 7 | URL 恢复（不重置） | 直接打开放回 `?session=xxx` | 正确恢复 session 与对应空间，**不**被清 |
| 8 | 首屏 auto-select 无 URL | 首次打开无 `?session=` | 空会话态（与现有一致，不闪 placeholder） |

## P3 专项回归点（UI 原型审批后）

| 点 | 期望 |
| --- | --- |
| 折叠/展开 | 标题行点折叠收起文件浏览器，预览内容撑满；再点展开恢复 |
| 高度拖拽 | 底部分隔条上下拖动调整 explorer 与预览内容高度，不溢出预览容器 |
| 刷新按钮 | 点刷新 FileExplorer 重新加载当前 cwd，2s 绿勾反馈 |
| 文件树 | 展开/折叠/点击打开文件（在预览面板 FileViewer 打开，fileTabs 增） |
| 切换空间重载 P3-4 | 切空间→reset 关右面板→重开预览面板，文件浏览器反映新空间 cwd（展开态被重置为根） |
| 无 cwd | 尚无任何空间选中时预览区顶部不渲染 explorer 区块 |
| studio/trellis 模式 | 右面板切到 Studio/Trellis 时不显示文件浏览器区块 |
| 明/暗主题 | 标题行与分隔条样式与 theme 变量一致 |
| 窄窗口 | 预览区收起时无 explorer 残影；不与顶栏其它控件冲突（P3 不动顶栏） |
| 用户偏好持久化 | explorer 高度/折叠态经新 localStorage key 跨刷新保留（旧 key 值迁移一次） |

## 质量检查

- `npm run lint` 通过。
- `node_modules/.bin/tsc --noEmit` 通过。
- `rg` 确认 P1/P2 改动仅限 `components/AppShell.tsx`、`components/SessionSidebar.tsx`、`lib/workspace-title.ts`(纯新增)。
- `rg` 确认 P3 改动仅限 `components/AppShell.tsx`、`components/SessionSidebar.tsx`。
- 不改 `app/api/**`、`lib/project-registry*`、`lib/session-*`、`lib/normalize.ts`、`components/FileExplorer.tsx`。
- P3 渲染层改动经 UI 原型审批后再合并。

## 回归风险

- **重置误触发**：restore 时序、auto-select、点列表 session。重点回归 #1/4/7/8 与「点列表 session 不重置」。
- **竞态假象**：`loadSessionsTokenRef` 必须在 `findProjectSpace` 提前 return 分支也 `setSessionsSwitching(false)`，否则卡在 switching。
- **P3 门控与 reset 叠加**：reset `setRightPanelOpen(false)` 卸载 explorer，需验收重开时 explorer cwd 已是新空间且折叠偏好 `explorerOpen` 未丢。
- **高度拖拽语义变更**：从「与 session 列表争高度」改为「与预览内容争高度」，min/max 用 `previewContentRef` 测量，勿再用 sessionListRef。
- **localStorage 迁移**：旧 `pi-web-sidebar-explorer-height` 值应被读一次写入新 key，避免用户偏好丢失。
- **prop 契约**：移除 `explorerRefreshKey`（及可能 `onOpenFile`/`onAtMention`）前 `rg` 全仓确认无残留透传/引用。
- **Trellis 提示**：sidebar 底部 explorer 段移除后，Trellis 未初始化提示渲染不受影响（仍在 session 列表区下方）。
- **切 Studio/Trellis 模式**：P3 explorer 只在 `files` 模式渲染，验收切到 studio/trellis 时不报错、无残影。

## 手工验收

1. 准备至少 2 个注册项目（含 1 个多空间 + 1 个 WorkTree）。
2. 按「切换路径回归矩阵」逐项操作，记录 URL、selectedSession、聊天区状态、列表 skeleton、侧边栏顶部信息（应未变）。
3. 竞态：在两空间间快速连续切换 5 次，确认列表最终对齐最后一次选择。
4. P3（原型审批后）：明/暗主题、预览区折叠/展开、高度拖拽、刷新、打开文件、切空间后重开预览、切 Studio/Trellis 模式、无空间空态、窄窗口。
5. 失败态：断网切换，确认列表错误提示而非旧列表。