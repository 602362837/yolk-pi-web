# plan review：调整左侧项目选择文案并增加 Git 添加项目入口

## 审批状态

- 当前建议状态：**等待修订版 UI 原型审批**。
- 原因：已由 `ui-designer` 成功交付修订版 HTML 原型（v2，覆盖 Local parent path + Remote repository 双输入框与 clone/register 流程）；等待主会话与用户正式确认。
- 需主会话动作：审阅修订版原型并取得用户批准，批准后即可进入实现阶段。

## 相关产物

- [brief.md](brief.md)
- [prd.md](prd.md)
- [ui.md](ui.md)
- [design.md](design.md)
- [implement.md](implement.md)
- [checks.md](checks.md)
- 旧原型（已过期）：[ui-prototype.html](ui-prototype.html)

## PRD 摘要

已确认需求：

1. 将左侧项目选择中的 `Choose project folder…` 改为 `Add project folder…`。
2. Git 入口文案固定为 `Add project from Git…`。
3. Git 表单直接提供两个输入：
   - `Local parent path`：本地父目录，支持手填和文件管理器选择。
   - `Remote repository`：远程 Git 仓库地址。
4. 点击提交后，后端应在 `Local parent path` 下执行 `git clone`。
5. clone 完成后，应将克隆得到的项目目录注册到 Project Registry，并选中后端返回的 main space。
6. 普通项目文件夹/路径添加仍必须统一走 `/api/projects` 注册语义，并选中后端返回的 main space。

范围外：分支/标签选择、目标目录自定义命名、clone 进度流、后台队列、凭据管理、自动创建聊天会话、对已有目录执行 pull/覆盖。

## UI 摘要

- 修订版 HTML 原型需覆盖：普通项目下拉、无项目空态、`Add project folder…`、固定 `Add project from Git…`、`Local parent path`、父目录选择按钮、`Remote repository`、`Clone and add`、busy/error/cancel/success 状态。
- 审批需确认：提交按钮是否采用建议文案 `Clone and add`，以及窄侧栏中两输入布局和错误文本是否可接受。
- 原型目前建议状态：已完成并提交修订版 HTML 原型（v2），等待用户/主会话最终审批。

## Design 摘要

- `components/SessionSidebar.tsx` 增加 Git 表单局部状态和三个独立 handler：父目录选择、clone submit、状态清理。
- 普通 `Add project folder…` 继续：`/api/projects/select-directory` -> `/api/projects` -> 选中返回 main space。
- Git 父目录选择只：`/api/projects/select-directory { purpose: "git-parent" }` -> 回填 `Local parent path`；不调用 `/api/projects`，不切换当前项目。
- 新增后端接口建议：`POST /api/projects/git-clone { parentPath, remoteRepository }`。
- 后端使用 `execFile` 参数数组执行 Git，禁止 shell 拼接；clone 成功后注册 targetPath 并返回 `{ project, created, worktrees, clone }`。
- 错误码建议覆盖：`invalid_parent_path`、`invalid_remote_repository`、`git_not_available`、`target_exists`、`clone_failed`、`clone_timeout`、`register_failed`。

## Implement 摘要

建议按以下顺序执行：

1. `UI-001`：修订并审批左侧项目下拉 HTML 原型。
2. `FE-001`：修改文件夹添加文案。
3. `FE-002`：新增 Git 入口与两输入展开态状态。
4. `API-001`：扩展目录选择 purpose 为 `project | git-parent`。
5. `API-002`：新增 Git clone 并注册项目接口。
6. `FE-003`：接入 Git 父目录选择与 clone 提交，成功后选中 main space。
7. `DOC-001`：更新模块文档。
8. `CHECK-001`：lint、type-check、手工验证。

详见 [implement.md](implement.md) 的 `json ypi-implementation-plan`。

## Checks 摘要

自动验证：

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

手工验证重点：

- 不再出现 `Choose project folder…`。
- 普通文件夹/手动路径添加仍走 `/api/projects` 并选中 main space。
- Git 父目录选择只回填 `Local parent path`，不注册项目、不切换 cwd。
- `Clone and add` 成功后，父目录下出现克隆仓库，Project Registry 中出现克隆项目，UI 选中返回 main space。
- 父目录无效、远程为空、目标目录已存在、clone 失败、注册失败均显示错误，且失败不切换当前项目。

## 主要风险

- clone 请求耗时较长或因私有仓库凭据交互卡住。
- 误把 `Local parent path` 注册为项目，而不是注册 clone 生成的 targetPath。
- 使用 shell 拼接 remote/path 引入命令注入。
- 目标目录已存在时误覆盖用户文件。
- clone 成功但注册失败，需给出 cloned path 作为恢复入口。
- 旧 UI 原型未修订即进入实现，导致与用户新需求不一致。

## 需要主会话/用户决策

1. 是否批准新增 `POST /api/projects/git-clone` 同步 clone 接口（v1 无进度流/后台队列）。
2. Clone 提交按钮是否采用建议文案 `Clone and add`。
3. clone 目标目录名是否使用 Git 默认/远程 basename 推导，不在本轮提供第三个输入框。
4. clone 失败或注册失败后的半成品目录是否默认不自动删除（建议不自动删除非空目录，避免误删）。
5. 修订版 UI 原型审批通过后，是否进入实现阶段。
