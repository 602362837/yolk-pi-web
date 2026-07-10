# handoff

## 已完成

已完成 bugfix 规划与根因定位，未修改生产代码：

- [`brief.md`](brief.md)：根因、目标、推荐决策。
- [`prd.md`](prd.md)：范围、验收标准、未决产品选择。
- [`design.md`](design.md)：storageId/真实 ChatGPT id 分层、旧文件兼容、数据流与风险。
- [`ui.md`](ui.md)：UI 设计员派发说明、原型要求与审批门禁。
- [`implement.md`](implement.md)：阅读顺序、DAG 实施计划、验证与回滚。
- [`checks.md`](checks.md)：自动/人工/兼容性检查。
- [`plan-review.md`](plan-review.md)：用户审批入口。

## 关键结论

当前覆盖根因是同一 `accountId` 被同时当作真实 ChatGPT id 和存储主键/文件名使用。修复应使用独立 opaque storage id 进行保存与 API 操作，保留 credential 的真实 `accountId` 给 Pi/OpenAI 请求及显式 quota/reset header。

CPA 无 `refresh_token` 应转为 `refresh: ""` + 非阻断风险，而非转换失败；仍要求 `access` 与有效 `expires`。

## 验证

仅进行静态源码/依赖链审查和规划 artifact JSON 格式检查；未运行 lint/typecheck（无生产代码改动）。

## 阻塞与主会话动作

1. 必须实际派发 `ui-designer`，在任务目录生成 `cpa-refresh-token-risk-prototype.html`，并更新 `ui.md`/`plan-review.md` 链接。
2. 必须由用户审批 HTML 原型、双标识设计及重复 credential 导入策略。
3. 之后主会话保存 `implement.md` 中的 implementation plan，并把任务转为 `awaiting_approval`；本子会话无 Studio 生命周期/派发工具，未擅自修改 `task.json`。

在这些动作完成前不可进入实现。
