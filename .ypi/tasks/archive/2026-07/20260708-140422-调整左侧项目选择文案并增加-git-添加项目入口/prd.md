# PRD：调整左侧项目选择文案并增加 Git 添加项目入口

## 目标与背景

左侧项目选择下拉目前包含本地项目文件夹/路径添加入口。用户确认本需求应一次性形成可执行的 Git 添加项目闭环：

- 将文件夹选择入口文案从 `Choose project folder…` 固定改为 `Add project folder…`。
- 新增 Git 添加入口，文案固定为 `Add project from Git…`。
- Git 表单直接包含两个输入：`Local parent path` 与 `Remote repository`。
- 在 `Local parent path` 指定的父目录下执行 `git clone`，clone 成功后把克隆得到的项目注册进 Project Registry，并选中后端返回的 main space。

## 范围内

1. 左侧项目选择下拉的可见文案调整。
2. 新增 `Add project from Git…` 菜单项及展开态表单。
3. Git 表单包含：
   - `Local parent path`：本地父目录，支持手填。
   - `Local parent path` 后的目录选择按钮：打开系统文件管理器选择父目录并回填。
   - `Remote repository`：远程 Git 仓库地址，支持 HTTPS/SSH/本地 Git URL 等 `git clone` 可接受格式。
   - `Clone` / `Add` 提交按钮、取消按钮、忙碌态、错误态。
4. 后端新增 Git clone 能力：在父目录下 clone 远程仓库，成功后调用现有 `/api/projects` 注册语义或等价共享函数注册克隆后的项目，并返回注册项目与 main space 信息。
5. 普通 `Add project folder…` / `Add project path…` 仍必须通过 `/api/projects` 注册并选中返回 main space。
6. 更新规划、设计、实现、检查文档；实现阶段同步更新模块文档。

## 范围外

- 分支/标签选择、浅克隆选项、目标目录自定义命名。
- clone 进度流式展示、后台任务队列、取消正在执行的 clone。
- Git 凭据管理、SSH key 管理、私有仓库交互式认证。
- clone 后自动创建首个聊天会话。
- 对已有非空目标目录执行 pull、fetch、覆盖或复用。

## 用户故事与需求

| ID | 需求 | 验收标准 |
| --- | --- | --- |
| R1 | 作为用户，我能看到更准确的文件夹添加文案。 | 原 `Choose project folder…` 在用户可见位置改为 `Add project folder…`；busy 状态仍显示 `Waiting for folder selection…`。 |
| R2 | 作为用户，我能从项目下拉找到 Git 添加入口。 | 下拉中新增独立菜单项，文案固定为 `Add project from Git…`，位置靠近其他添加入口；点击只展开 Git 表单，不立即切换当前项目。 |
| R3 | 作为用户，我能填写 Git clone 所需本地父目录。 | 表单展示 `Local parent path` 输入；可手填；目录按钮选择成功后回填；该路径语义明确为 clone 的父目录。 |
| R4 | 作为用户，我能填写远程仓库地址。 | 表单展示 `Remote repository` 输入；为空时不能提交；错误态清晰提示。 |
| R5 | 作为用户，我能执行 clone 并自动注册项目。 | 提交后后端在 `Local parent path` 下执行 `git clone <remote>`；成功后注册克隆出的项目，并选中返回项目的 main space。 |
| R6 | 作为用户，我能理解和处理失败。 | 父目录无效、git 不可用、远程地址无效、目标目录已存在、clone 失败、注册失败均有明确错误文本；失败时不切换当前项目。 |
| R7 | 作为维护者，我能确认普通项目添加语义不变。 | `Add project folder…` 和 `Add project path…` 仍调用 `/api/projects`，并选中返回项目 main space，包括 `created=false` 的已存在项目。 |

## UI 原型门禁

本需求改变左侧可见交互，并且用户已更新 Git 表单目标，必须重新进入 UI prototype gate：

- 指派成员：`ui-designer`。
- 交付：基于现有左侧项目下拉产出修订版 HTML 原型，建议继续使用 `ui-prototype.html` 或新增 `ui-prototype-v2.html`。
- 原型至少覆盖：普通项目列表、无项目空态、`Add project folder…`、`Add project from Git…`、两输入 Git 表单、目录选择按钮、Clone 忙碌态、clone/register 错误态、取消/关闭状态、成功后选中 main space 的结果说明。
- 旧原型只覆盖本地基准路径，已不满足当前需求；修订版原型经用户批准前不得进入实现。

## 未决问题

1. Clone 提交按钮最终文案建议为 `Clone and add`，需由修订版 UI 原型确认。
2. clone 目标目录名是否完全采用 Git 默认推导（从远程 basename 去 `.git`），还是后续增加自定义目标目录输入。本轮建议不增加第三输入。
3. clone 失败后是否自动清理后端创建的空/半成品目录。本轮建议默认不自动删除非空目录，只在错误中提示 partial path，避免误删用户文件。
