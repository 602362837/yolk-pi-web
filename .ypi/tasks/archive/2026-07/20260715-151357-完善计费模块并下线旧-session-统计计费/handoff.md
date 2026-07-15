# Handoff

## 已完成

- 核验任务状态：`intake`，owner/currentMember 为 `architect`，无已保存 implementationPlan。
- 调研 ledger、legacy Session aggregate、session rollup、配置、token formatter、shared dropdown 和 Usage icon。
- 产出：`brief.md`、`prd.md`、`ui.md`、`design.md`、`implement.md`、`checks.md`、`plan-review.md`。
- `implement.md` 含 schemaVersion 2 的 `json ypi-implementation-plan`，共 5 个子任务。

## 关键结论

- 日期 bug 根因：本地日期边界与 UTC partition 混用，候选读取后缺少 `occurredAt` 精确过滤，range/byDay 又返回 UTC 口径。
- 旧模块下线应仅删除全局 Session 统计；`/api/usage?sessionId=`、`getUsageStatsForSessionRollup()`、`SessionStatsChips` 和 Studio child rollup 必须保留。
- `workspaceFilter` 当前有 cwd 即默认 `cwd`；应改为始终 `all`。
- 新账本未全面使用 `lib/token-format.ts`，两个筛选仍是原生 `<select>`。
- coverage banner、损坏文件数和 legacy footer 均是可删除 UI 噪音；API diagnostics 可保留。
- Usage sidebar/header 当前为纯美元符号；推荐换为统一折线统计语义图标。

## 验证

- implementation plan JSON 解析通过：schemaVersion 2，5 个子任务，依赖 id 与必填扩展字段完整。
- task-local Markdown 相对链接检查通过：8 个链接无断链。
- `npm run test:llm-usage-store`：未运行到测试，当前 worktree 缺少 `@earendil-works/pi-coding-agent` 依赖，Node 报 `ERR_MODULE_NOT_FOUND`。
- `npm run test:usage-rollup`：同因未运行到测试。
- 未运行 lint/tsc：本次仅新增任务规划工件，且当前依赖安装不完整。

## 阻塞

UI prototype gate 已触发。当前 delegated child 没有 Studio 派发工具，且 child guard 禁止递归 Studio 编排，无法合法启动 `ui-designer` 或修改 `task.json` 状态。因此：

- HTML 原型尚未产生；
- 用户审批尚未记录；
- implementationPlan 尚未保存进 task metadata；
- 任务必须保持 intake/planning，不能进入 `awaiting_approval` 或实现。

## 主会话下一步

1. 按 `ui.md` 派发 UI 设计员，交付 `usage-ledger-refinement-prototype.html`。
2. 请用户确认“折线图”是 icon（推荐）还是新增 line chart。
3. 确认无 sessionId `/api/usage` 返回 400，以及 `statsSource` 兼容退役策略。
4. 将 HTML 与审批记录补入 `ui.md` / `plan-review.md`。
5. 保存 `implement.md` 的 implementationPlan，再推进到 `awaiting_approval`；不得直接实现。
