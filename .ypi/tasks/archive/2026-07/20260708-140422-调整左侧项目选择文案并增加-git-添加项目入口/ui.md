# UI：左侧项目选择添加入口调整

## UI prototype gate

- 结论：修订版原型已产出并更新。
- 原因：用户已确认 Git 入口要直接提供 `Local parent path` + `Remote repository` 并执行 clone/register/select 闭环；现有 [ui-prototype.html](ui-prototype.html) 已升级为 v2，完美覆盖该流交互。
- 当前状态：等待主会话/用户审阅修订后的 HTML 原型 (v2) 并做出正式审批确认。

## 修订版 HTML 原型设计

我们已对 `.ypi/tasks/20260708-140422-调整左侧项目选择文案并增加-git-添加项目入口/ui-prototype.html` 进行了全新重写 (v2)。原型设计直接对应真实 `SessionSidebar` 结构与样式，并提供丰富的交互模拟。

### 原型覆盖状态

1. **普通项目下拉**
   - 展示项目与空间列表结构。
   - 文件夹添加菜单项文案更新为：`Add project folder…`。
   - Git 添加菜单项文案更新为：`Add project from Git…`。

2. **无项目空态**
   - 模拟没有已注册项目时下拉框中各添加项目的快捷指引。

3. **Git 入口展开态 (v2)**
   - 带有 `Local parent path` 标签的文本输入框，以及右侧回填父目录的文件夹图标按钮。
   - 带有 `Remote repository` 标签的远程 Git 仓库地址输入框。
   - 提交按钮文案固定为 `Clone and add`。
   - 提供 `Cancel` 按钮，取消时清理全部输入状态。

4. **目录选择 Busy 态**
   - 模拟在拉起系统管理器选择父目录时的局部忙碌态（图标变成等待，文件夹快捷键按钮置为 Waiting 态），保持表单处于可交互状态。

5. **目录选择 Error 态**
   - 模拟父目录权限不足或不可写时的独立文本错误展示，仅局限在父目录输入框正下方，不阻塞表单其他交互。

6. **Clone 执行 Busy 态**
   - 模拟点击 `Clone and add` 后，整个表单全部禁用（包括输入框、选择按钮、提交/取消按钮），提交按钮文字显示 `⏳ Cloning…`，防止重复提交。

7. **Clone 失败 Error 态**
   - 模拟网络异常/鉴权失败的整体错误，整体错误提示条展示在动作按钮之上，错误时不关闭表单，方便用户修正。

8. **模拟 clone 成功交互**
   - 在展开态点击 `Clone and add` 后，原型支持模拟网络耗时，并在成功后弹窗确认切换到克隆项目的主空间 `yolk-pi-web`。

## 交互推荐与约束

- 两个表单展开保持互斥：点击 `Add project from Git…` 会自动收起手动路径表单，反之亦然。
- `Local parent path` 是 Git 的父路径（将在其下 clone 仓库），它不应该调用后端普通注册接口，仅调用只回填路径的选择接口。
- 点击取消、外部点击或按下 Escape 时，应当清理 Git 相关的临时输入文本及错误。
- 失败时决不能切换当前项目。


## 推荐交互

- 点击 `Add project from Git…` 后不关闭下拉，而是在下拉内展开 Git 表单。
- 展开 Git 表单时关闭普通手动路径表单；打开 `Add project path…` 时关闭 Git 表单。
- `Local parent path` 目录按钮只回填父目录，不注册项目、不切换当前项目。
- 点击 `Clone and add` 才调用后端 Git clone 接口；成功后注册并选中返回 main space。
- 点击取消、外部关闭下拉、Escape 时清理 Git 表单临时状态和错误。
- 普通 `Add project folder…` 仍沿用现有行为：打开目录选择器，选择成功后调用 `/api/projects` 注册并选中 main space。

## HTML 原型审批要求

用户审批时请确认：

- Git 入口文案固定展示为 `Add project from Git…`。
- 两个输入标签是否固定为 `Local parent path` 与 `Remote repository`。
- 提交按钮文案是否采用 `Clone and add`。
- 窄侧栏中输入框、目录按钮和错误文本是否可读且不溢出。

## 阻塞说明

修订版 HTML 原型已成功产出并更新。当前方案无明显阻塞，等待主会话/用户正式确认本审批书即可开展下一步实现。
