# UI：原型门禁

## 结论

**触发 UI 原型硬门禁。**

原因：`components/GithubAutomationConfig.tsx` 的信息架构、运行模式、readiness、Jobs 状态和用户可见安全说明都会改变；这不是纯后端删除。按照 Studio 规则，进入实现前必须由 **UI 设计员** 基于现有项目产出 HTML 原型，并由主会话 / 用户审批。

任务目录现已包含独立 HTML 原型：[github-issue-analysis-settings-prototype.html](./github-issue-analysis-settings-prototype.html)。

## UI 设计员任务说明

请指派 `ui-designer`，先阅读：

- `components/GithubAutomationConfig.tsx`
- `components/SettingsConfig.tsx`
- `components/SettingsTreeNavigation.tsx`
- `app/globals.css` 中 `.github-automation-*`
- `docs/modules/frontend.md`
- [PRD](./prd.md)
- [Design](./design.md)

已交付任务目录内独立 `.html` 原型：[github-issue-analysis-settings-prototype.html](./github-issue-analysis-settings-prototype.html)。`ui.md` 仅说明和链接，不以 Markdown 替代原型。

## 原型必须覆盖

### 页面信息架构

1. **本机 GitHub App 凭据**：沿用现有安全交互；
2. **Setup checklist**：删除 Assignee、P1 Contents/PR 权限，新增“分析模型可用”“本地项目可读”；
3. **允许仓库**：保留 owner/repo、repository id、installation id、Project Registry 项目；移除 base ref、owner actor ids 等闭环专属字段（若后端确认不再需要）；
4. **运行控制**：只保留启用/关闭与全局暂停，不再提供 triage/unattended segmented control；
5. **分析边界**：明确“只读仓库证据；不会改代码/提 PR；高置信证伪才关闭”；
6. **最近分析**：简化为 Issue、分类、真实性、评论状态、关闭状态、失败原因和 retry；不显示 Session/Agent/WorkTree/PR；
7. **高级 env 覆盖**：继续折叠展示 env 名，不显示值。

### 状态

- 首次加载 / 骨架；
- App 凭据未配置；
- allowlist 为空；
- 本地项目未绑定/路径缺失；
- 分析模型不可用；
- enabled / paused；
- queued / analyzing / commenting / closing / completed-open / completed-closed；
- inconclusive；
- retry_due / blocked；
- stale snapshot（禁用 mutation）；
- revision conflict；
- 窄屏 ≤640px 与 ≤390px。

### 关键交互

- 保存/移除本机凭据沿用不回显规则；
- 关联仓库需解释“本地项目仅供只读证据分析”；
- 首次开启前显示自动关闭条件摘要；
- 全局暂停不改 enabled；
- retry 只重试未确认阶段，不重复评论/关闭；
- 最近分析行可展开安全摘要，但不显示 Issue body、prompt、原始模型输出或绝对路径。

## 待审批项

HTML 原型完成后，主会话必须请求用户确认：

- 是否接受单一启用开关；
- 是否保留最近分析列表和 retry；
- 自动关闭警示文案和 `inconclusive` 呈现；
- 仓库关联表单是否删除 base ref / owner actor ids；
- 窄屏布局。

HTML 原型已完成；用户已批准单一启用开关、最近分析/retry、自动关闭警示、仓库字段收敛、inconclusive 呈现和窄屏布局。
