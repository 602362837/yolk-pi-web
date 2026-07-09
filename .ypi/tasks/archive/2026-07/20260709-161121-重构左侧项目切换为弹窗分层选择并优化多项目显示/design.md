# design

## 方案摘要

将 `SessionSidebar` 中的 CWD picker dropdown 替换为 viewport 级 `ProjectSpaceSwitchDialog`。侧边栏顶部只保留一个紧凑的“当前项目空间”按钮作为入口；真正的项目/空间浏览、搜索和添加项目能力移动到弹窗中。弹窗使用两层信息架构：左侧项目列表负责选择 pending project，右侧空间列表负责选择具体 project space 并提交切换。

## 影响模块和边界

### 前端

- `components/SessionSidebar.tsx`
  - 删除/替换旧 `dropdownOpen` CWD picker 渲染。
  - 保留并复用现有项目/空间排序、display helper、注册项目、Git clone、目录选择、WorkTree context menu、selection side effects。
  - 新增弹窗 open state，例如 `projectSwitchOpen`、`dialogProjectId`、`projectSearch`。
- 建议新增 `components/ProjectSpaceSwitchDialog.tsx`
  - 负责展示 modal、项目列表、空间列表、空状态、添加项目表单。
  - 接收纯数据和 callback，避免直接读写全局状态。
  - 可复用 `PiWebProjectRecord` / `PiWebProjectSpaceRecord` 类型。
- `docs/modules/frontend.md`
  - 实现完成后更新 `SessionSidebar` 描述，说明项目切换已从 dropdown 改为分层弹窗。

### 后端/API

- 默认不需要新增 API。
- 继续使用：
  - `GET /api/projects?sync=missing`
  - `POST /api/projects`
  - `POST /api/projects/select-directory`
  - `POST /api/projects/git-clone`
  - `GET /api/projects/[projectId]/spaces/[spaceId]/sessions`
- 不修改 Project Registry schema。

## 数据流 / 状态流

```text
Sidebar top switch button
  └─ open ProjectSpaceSwitchDialog
       ├─ projects from SessionSidebar state (/api/projects?sync=missing)
       ├─ pendingProjectId local to dialog
       ├─ project/space search local to dialog
       ├─ add project actions reuse existing callbacks
       └─ click active non-missing space
            ├─ setSelectedProjectId(project.id)
            ├─ setSelectedSpaceId(space.id)
            ├─ setSelectedCwd(space.path)
            ├─ clear WorkTree/custom/Git transient errors as needed
            └─ close dialog

selectedProjectId/selectedSpaceId change
  └─ existing useEffect/loadSessions loads /spaces/[spaceId]/sessions
selectedCwd change
  ├─ existing Git info effect updates branch/worktree display
  ├─ existing AppShell receives onProjectSpaceChange
  └─ file explorer/session creation continues to use selectedCwd
```

## 组件契约建议

```ts
interface ProjectSpaceSwitchDialogProps {
  open: boolean;
  projects: PiWebProjectRecord[];
  selectedProjectId: string | null;
  selectedSpaceId: string | null;
  homeDir?: string;
  currentGit?: GitInfo;
  busy?: {
    directoryPicker?: boolean;
    customPath?: boolean;
    gitParentPicker?: boolean;
    gitClone?: boolean;
  };
  errors?: {
    customPath?: string | null;
    gitAdd?: string | null;
  };
  customPathValue: string;
  gitParentPathValue: string;
  gitRemoteRepositoryValue: string;
  onCustomPathValueChange(value: string): void;
  onGitParentPathValueChange(value: string): void;
  onGitRemoteRepositoryValueChange(value: string): void;
  onSelectSpace(project: PiWebProjectRecord, space: PiWebProjectSpaceRecord): void;
  onUseDefaultDirectory(): void;
  onPickProjectFolder(): void;
  onSubmitCustomPath(): void;
  onPickGitParent(): void;
  onSubmitGitClone(): void;
  onResetAddForms(): void;
  onWorktreeContextMenu?(event: React.MouseEvent, space: PiWebProjectSpaceRecord): void;
  onClose(): void;
}
```

实现员可根据实际复杂度选择先内联到 `SessionSidebar.tsx`，但建议抽组件降低主文件体积。

## 交互细节

- 打开弹窗：
  - 若当前有 selectedProjectId，pending project 默认当前项目。
  - 若无当前项目但有 activeProjects，默认第一个排序项目。
  - 若无 activeProjects，显示空状态，不自动选择。
- 项目搜索：
  - 过滤字段：display project name、rootPath、project tags、space names、space paths。
  - 若搜索命中某项目的空间，也保留该项目；右侧只显示 pending project 的匹配/全部空间。
- 空间选择：
  - `space.missing` 禁用，展示“路径缺失”。
  - 非 missing 空间点击立即切换并关闭。
  - WorkTree 行保留 `WT` badge、branch/base tooltip，右键打开现有 context menu。
- 添加项目：
  - 空状态和普通状态都显示添加入口。
  - 手动 path 与 Git clone form 互斥。
  - 成功注册/clone 后沿用 `upsertProjectAndSelectMainSpace()`，关闭弹窗并重置临时状态。
- 关闭：
  - backdrop、Esc、关闭按钮触发 `onClose`，同时清理 `customPathOpen`、`customPathValue`、`customPathError`、Git form state。

## 兼容性

- 老 session 未写 projectId/spaceId 的 legacy unassigned 行为不变；本改动只影响顶层项目/空间选择入口。
- 新环境无项目时，仍不扫描 sessions 合成项目；空状态明确解释这一点。
- `main` space 的显示仍通过 `displaySpaceName()` 返回“主空间”。
- WorkTree archive/delete 后的 fallback selection 逻辑保持在现有 `confirmWorktreeAction()`，弹窗只消费最新 `projects` state。

## 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 迁移 dropdown 时遗漏添加项目/Git clone 表单状态 | 添加项目回归 | 先抽 callback/props，再替换 UI；使用手工验收覆盖四种添加路径 |
| 选择空间后不触发现有 session reload | 用户看到旧会话 | 保持 setSelectedProjectId/setSelectedSpaceId/setSelectedCwd 三件套；不绕过现有 effects |
| 弹窗内搜索破坏“先项目后空间”层级 | 用户路径混乱 | 搜索只过滤/高亮，不把空间提升成顶层独立结果 |
| 空状态无法添加项目 | 新用户阻塞 | 空状态主按钮直接复用目录选择和手动/Git forms |
| 长文本仍挤压按钮 | 显示错乱未解决 | 对项目名、路径、空间名设置 min-width:0 + ellipsis；列表容器独立滚动 |
| Esc/外部点击清理时误取消 clone | 状态不一致 | clone busy 时禁用关闭或关闭只隐藏不取消；建议首版 clone busy 禁用关闭按钮并提示 |

## 回滚方案

- 若弹窗实现出现阻塞，可保留新 trigger 但暂时恢复旧 dropdown 渲染作为受控 fallback。
- 所有后端 API 和数据结构未改，回滚前端代码不会造成数据迁移或 registry 兼容问题。
