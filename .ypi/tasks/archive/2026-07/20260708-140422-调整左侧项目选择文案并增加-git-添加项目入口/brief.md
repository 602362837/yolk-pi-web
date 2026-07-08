# brief

## 任务

调整左侧项目选择下拉中的项目添加入口：

1. 将现有文件夹选择按钮文案从 `Choose project folder…` 改为 `Add project folder…`。
2. 在左侧项目选择中新增 Git 添加项目入口，文案固定为 `Add project from Git…`。
3. Git 表单直接提供两个输入：
   - `Local parent path`：本地父目录，支持手填和通过系统文件管理器选择目录；后端将在该父目录下执行 `git clone`。
   - `Remote repository`：远程 Git 仓库地址。
4. clone 完成后，将克隆得到的项目目录注册到项目列表，并选中后端返回的 main space。

## 已确认约束

- 项目下拉中的普通项目文件夹添加仍必须统一走 `/api/projects` 注册语义，并选中后端返回的 main space；不能只提示不切换。
- Git 父目录选择按钮只回填 `Local parent path`，不能把父目录注册为项目。
- 新增 Git 入口属于左侧页面交互变更，触发 UI prototype gate：实现前必须由 `ui-designer` 基于现有项目产出修订版 HTML 原型，并经用户审批。
- 旧版 HTML 原型只覆盖“本地基准路径”方案，已过期。
- 本阶段仅做规划，不改生产代码，不提交/推送。

## 初步范围

- 改动 `components/SessionSidebar.tsx` 的项目选择下拉 UI 与状态。
- 兼容扩展 `/api/projects/select-directory`，增加 `purpose: "git-parent"` 用于父目录选择器提示文案。
- 新增建议接口 `POST /api/projects/git-clone`，接收 `{ parentPath, remoteRepository }`，执行 clone、注册克隆后的项目并返回 main space 所属 project。
- 实现阶段更新 `docs/modules/frontend.md` 与 `docs/modules/api.md`。

## 范围外

- 分支/标签选择、浅克隆选项、目标目录自定义命名。
- clone 进度流、后台队列、取消正在执行的 clone。
- Git 凭据管理、SSH key 管理、私有仓库交互式认证。
- 对已有目标目录执行 pull、fetch、覆盖或复用。
- clone 后自动创建首个聊天会话。

## 待主会话/用户确认

1. Clone 提交按钮是否采用建议文案 `Clone and add`。
2. clone 目标目录名是否使用 Git 默认/远程 basename 推导，本轮不增加第三个输入。
3. clone 失败或注册失败后的半成品目录是否默认不自动删除；建议不自动删除非空目录，避免误删。
4. 是否批准新增同步 `POST /api/projects/git-clone` 接口作为 v1（无进度流/后台队列）。
