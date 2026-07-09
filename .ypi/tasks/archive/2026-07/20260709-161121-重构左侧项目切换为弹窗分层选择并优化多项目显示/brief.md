# brief

## 任务目标

重构左侧侧边栏的项目/空间切换交互：解决项目很多时当前下拉列表溢出、显示错乱和信息层级不清的问题；取消下拉式项目选择；将左侧顶部改为打开弹窗的切换按钮；弹窗内按“先项目、再项目空间”的分层路径选择目标工作区；覆盖新环境无项目注册的空状态。

## 已读材料与证据

- `AGENTS.md`：Project Registry 是项目列表来源；UI 改动需读前端/架构文档；代码变更最小验证为 lint + tsc。
- `docs/architecture/overview.md`：Project Registry 顶层项目列表不能从 sessions 扫描；`main` 空间显示可为“主空间”；UI 原型门禁要求 HTML 原型与用户审批。
- `docs/modules/frontend.md`：`components/SessionSidebar.tsx` 是项目/空间树、项目注册、WorkTree、会话列表和文件浏览入口；样式变量来自 `app/globals.css`。
- `docs/modules/api.md`：现有 `/api/projects`、`/api/projects/select-directory`、`/api/projects/git-clone`、`/api/projects/[id]/spaces/[spaceId]/sessions` 已覆盖列表、注册、目录选择、Git clone、空间会话加载。
- `lib/project-registry-types.ts`：项目/空间字段、`main`/`worktree` 类型、`pinned`/`archived`/`missing` 状态。
- `components/SessionSidebar.tsx`：当前 CWD picker 是 sidebar 内绝对定位 dropdown，项目多时无弹窗空间和明确滚动边界；新增/注册项目表单也嵌在该 dropdown 中。

## 现状问题

1. 当前选择器宽度受左侧 sidebar 限制，项目/空间多时只能在窄列表中堆叠，长路径与 WorkTree badge 易挤压。
2. Dropdown 绝对定位在 sidebar header 下方，项目很多时缺少明确的 viewport 级滚动容器，易溢出、被侧边栏/窗口裁切或视觉错位。
3. 项目与空间在一个纵向列表中混排，用户需要在大量项目标题和空间行中寻找目标，层级焦点不清。
4. 新环境没有注册项目时，空提示埋在 dropdown 内；左侧顶部仍缺少清晰的“添加第一个项目”主路径。

## 约束

- 不能扫描 sessions 合成顶层项目；仍以 `/api/projects?sync=missing` 为项目列表来源。
- 不新增后端能力为首选；复用现有 Project Registry API。
- 不改变 session JSONL、project registry 数据结构和 WorkTree archive/delete 语义。
- 这是用户可见交互改动，必须通过 UI prototype gate：HTML 原型需进入审批材料，用户确认前不得实现。
- 当前阶段不修改生产代码、不提交、不推送。

## 建议下一步

1. 主会话将本任务切到 `planning`，并把 `plan-review.md` 作为审批入口展示给用户。
2. UI 设计员需审阅/确认 `ui.md` 与 `project-switch-modal-prototype.html`，必要时调整原型。
3. 用户确认原型和计划后，再派实现员按 `implement.md` 的 implementation plan 执行。
