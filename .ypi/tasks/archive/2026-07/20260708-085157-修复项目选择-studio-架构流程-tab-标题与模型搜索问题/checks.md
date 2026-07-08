# checks

## 自动验证

- `npm run lint`
- `node_modules/.bin/tsc --noEmit`
- `npm run test:studio-dag`（覆盖 Studio approval gate 基线，确保新增门禁文案不破坏 DAG/审批逻辑）
- 如修改 Studio policy 相关类型或配置读取，再运行 `npm run test:studio-policy`。

## 手工验收

1. 项目下拉：
   - 用 “Choose project folder…” 选择新目录，确认项目被加入并选中。
   - 再次选择同一目录，确认当前项目不切换，并出现已存在提示。
   - 手动 “Add project path…” 对新目录/重复目录行为一致。
2. Studio 门禁：
   - `/studio-init` 或 Studio 面板初始化后，architect prompt/workflow detail 可看到 UI HTML prototype gate。
   - 新建 UI 改动任务，planning/awaiting_approval 要求 `ui.md`，且说明 HTML 原型和用户审批。
   - feature-dev/bugfix 任务若需求含 UI/交互关键词，架构师 prompt 明确必须指派 UI 设计员。
3. Tab 标题：
   - 打开已登记项目主空间，标题为 `项目名(主空间)` 或自定义空间名。
   - 打开 linked session，session cwd 与 registry path 表示略有差异时仍显示项目标题。
   - 无项目上下文时 fallback 为 cwd/branch 或 `yolk pi web`。
4. 模型搜索：
   - 在 ChatInput 模型下拉搜索 provider id。
   - 搜索 provider display name / 中文展示名，结果同样出现。
   - 在 Settings → Studio 模型策略字段重复上述搜索。

## 回归风险重点

- Project Registry pathKey 去重不能被绕开；只改变 duplicate 时 UI 是否切换。
- Studio 变更不应让 `awaiting_approval -> implementing` 的硬审批逻辑变弱。
- Title effect 不应与 Next metadata 反复抢写造成闪烁；保留/复用现有 MutationObserver 或 layout effect 保护。
- ModelSelect 的搜索增强不能改变选中 value 或 `onModelChange(provider, modelId)`。
