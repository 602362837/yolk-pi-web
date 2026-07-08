# Checks：验证方案

## 需求覆盖检查

| 需求 | 检查点 | 方式 |
| --- | --- | --- |
| R1 文案改为 Add project folder… | `Choose project folder…` 不再作为用户可见文案出现；busy 态仍合理。 | `rg "Choose project folder"` + 浏览器检查。 |
| R2 固定 Git 入口文案 | 项目下拉中出现 `Add project from Git…`，位置靠近添加类操作。 | 浏览器检查。 |
| R3 Local parent path | 点击 Git 入口后可输入/编辑 `Local parent path`；目录按钮选择后回填；语义是 clone 父目录。 | 浏览器检查 + Network 检查。 |
| R4 Remote repository | 表单包含 `Remote repository` 输入；为空时不能提交或显示明确错误。 | 浏览器检查。 |
| R5 clone 后注册并选中 | 提交后在父目录下执行 `git clone`；成功后注册克隆出的项目并选中返回 main space。 | 浏览器检查 + Network 检查 + 文件系统检查。 |
| R6 错误态 | 父目录无效、远程为空、目标目录已存在、clone 失败、注册失败均显示错误；失败不切换项目。 | 手工/API 验证。 |
| R7 普通项目注册语义不变 | `Add project folder…` 和 `Add project path…` 都通过 `/api/projects` 注册并选中返回 main space。 | Network 检查 + 手工添加已存在/新项目路径。 |

## 自动验证

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

实现后重点代码审查：

- `POST /api/projects/select-directory` 无 body 旧调用仍默认 `purpose = "project"`。
- `select-directory` 只接受 `"project" | "git-parent"` enum，不拼接任意客户端 prompt。
- `POST /api/projects/git-clone` 使用 `execFile` 参数数组执行 Git，不使用 shell 字符串拼接。
- clone 成功后注册的是 targetPath，不是 `Local parent path`。
- clone/register 失败不会改变当前 selected project/space/cwd。

## 人工验收步骤

1. 启动开发服务：`npm run dev`。
2. 打开 `http://localhost:30141`。
3. 打开左侧项目选择下拉。
4. 确认文件夹添加入口显示 `Add project folder…`，旧文案不出现。
5. 点击 `Add project folder…`，选择一个目录：
   - Network 中应出现 `/api/projects/select-directory` 和 `/api/projects`。
   - UI 应选中后端返回的项目 main space。
6. 再次打开下拉，点击 `Add project path…`，输入已存在项目路径：
   - `/api/projects` 返回 `created=false` 时也应选中该项目 main space。
7. 点击 `Add project from Git…`：
   - 下拉内展开 Git 表单。
   - 展示 `Local parent path`、目录按钮、`Remote repository`。
   - 当前项目不改变。
8. 点击 `Local parent path` 后的目录按钮：
   - 选择目录后输入框回填。
   - Network 中不应出现 `/api/projects`。
   - 当前项目/空间/cwd 不改变。
9. 填写一个可访问远程仓库地址，点击 `Clone and add`：
   - Network 中应出现 `/api/projects/git-clone`。
   - 父目录下出现克隆出的仓库目录。
   - 后端响应包含 `project` 与 `clone.targetPath`。
   - UI 选中返回 `project.spaces.main`，cwd 等于克隆出的项目路径。
10. 验证错误态：
    - 空 `Local parent path` 或空 `Remote repository` 不能提交或显示错误。
    - 不存在/不可写父目录显示错误。
    - 使用会推导到已存在目标目录的 remote 时拒绝覆盖。
    - 使用不可访问 remote 时显示 clone 失败，当前项目不变。
11. 测试取消、Escape、点击外部关闭下拉：
    - Git 表单临时路径、远程地址和错误被清理。
12. 如 clone 成功但注册失败（可通过临时模拟/代码审查验证）：
    - 错误包含 cloned path；UI 不切换项目；用户可用 `Add project path…` 手动注册该目录。

## 回归风险

- Git 父目录被误注册为项目，污染 Project Registry。
- `customPathOpen` 和 `gitAddOpen` 同时为 true，造成两个表单重叠。
- Git 目录选择 busy 状态复用普通 `directoryPickerBusy`，导致状态串扰。
- 扩展 `select-directory` 时破坏无 body POST 调用。
- clone 使用 shell 拼接路径/remote，产生命令注入风险。
- 私有仓库凭据交互导致请求长时间挂起。
- 目标目录已存在时错误地覆盖或 pull。
- clone 成功但注册失败时没有给出可恢复路径。

## 质量检查

- 代码遵循 `docs/standards/code-style.md`，使用严格 TypeScript 类型，避免 `any`。
- 新增 handler 命名清晰，普通项目目录选择、Git 父目录选择、Git clone submit 三者分离。
- UI 文案准确表达 `Local parent path` 是父目录，remote 是仓库地址。
- 后端错误码稳定且可由前端映射用户友好提示。
- 文档与最终实现一致，不承诺分支选择、凭据管理、进度流或后台任务。

## 审批门禁

- `ui-designer` 已产出修订版 HTML 原型并链接在 `ui.md` / `plan-review.md`。
- 用户已批准修订原型、两输入布局与 `Clone and add` 按钮文案。
- `plan-review.md` 已更新审批状态后，方可开始实现。
