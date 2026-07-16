# REV-01 独立评审

## Verdict

**PASS（可进入 review）**。

上轮 High finding（375px / 640px 下侧栏遮挡 `Subagents` trigger）已在真实应用复验通过。审批门禁、数据契约、旧链路清理、只读导航和本轮自动验证均通过，未发现 blocker/high finding。

## Findings Fixed

- **High — 窄屏顶栏不可达：** `≤640px` 下 `.sidebar-container` 和 backdrop 现在从 `top: 36px` 开始，`.app-top-bar` 为 `z-index: 250`；`AppShell` backdrop 内联位置同步保留顶栏。
  - 真实浏览器（worktree dev `http://127.0.0.1:30153`，dark + reduced-motion）复验：
    - **375×812：** trigger 中心命中 `Studio child sessions`，点击后 `aria-expanded=true`，面板可见（`x=0,y=36,w=375,bottom=812`），无横向溢出；Sidebar 可关闭并重新打开。
    - **640×900：** trigger 中心命中 `Studio child sessions`，点击后 `aria-expanded=true`，面板可见（`x=0,y=36,w=640,h=175`），无横向溢出；Sidebar 可关闭并重新打开。
- **中屏/桌面抽查：** 1440×900 下 sidebar 保持桌面 `position: relative` / `top: 0`，Subagents trigger 和面板正常打开，页面无横向溢出。

## Verified Requirements

- 当前工作区三点和项目选择按钮右键共用 `CurrentWorkspaceMenuContent`；WorkTree 专属归档/删除动作仍复用既有确认流程。
- child inventory 仅接受 `studioChild.kind === "ypi-studio-child-session"` 与精确 `parentSessionId`；task run 优先，header fallback 明示 `statusMayBeStale`。
- terminal limit 为 20、defensive active cap 为 200；wire projection 不暴露 `path`、`cwd`、`sessionFile`、`contextId` 或 child 内容体。
- hook 保留 AbortController、generation guard 及 active + visible 5 秒 polling cleanup；刷新失败也按 parent identity 防止旧状态写入新 session。
- child 行导航复用当前工作台只读 audit Chat，不向父 Chat 注入 child transcript/usage。
- 旧 `SubagentRun` / `onSubagentChange` / `extractSubagentRuns` / `parseSubagentChildren` / `/api/agent/subagent-children` 已从生产路径清除。
- `prefers-reduced-motion` 下本次窄屏复验无动画可达性回归。

## Verification

- `git diff --check` — pass
- `npm run lint` — pass（0 errors；6 个既有、与本任务无关 warnings）
- `node_modules/.bin/tsc --noEmit` — pass
- `npm run test:studio-child-sessions` — pass（14 assertions）
- Real browser, `http://127.0.0.1:30153` — 375×812、640×900（dark + reduced-motion）及 1440×900 复验通过；Subagents 可点击/打开、Sidebar toggle 可用、无横向溢出。

## Remaining Risks

- 本轮聚焦复验上轮窄屏 blocker；此前记录的非阻塞 live-fixture 缺口（waiting/stale/error、20+ terminal、危险写操作）仍依赖已有 unit/static 覆盖，未在本轮重新制造。
- `package.json` / lockfile 的范围外依赖更新仍应由主会话在后续提交前确认是否有意包含。
