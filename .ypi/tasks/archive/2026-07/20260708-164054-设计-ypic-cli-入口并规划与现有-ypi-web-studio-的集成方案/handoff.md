# handoff

## 本轮产物

已完成规划，未进入实现，未修改生产代码。

更新的任务 artifacts：

- `brief.md`
- `prd.md`
- `ui.md`
- `design.md`
- `implement.md`（含 fenced `json ypi-implementation-plan`）
- `checks.md`
- `plan-review.md`
- `handoff.md`

## 核心建议

- 新增 `ypic`，保持 `ypi` Web 入口不变。
- `ypic` 不直接复制 Pi SDK runtime，而是复用/拉起现有 ypi Web server，通过 `/api/agent/*` 和 SSE 驱动 chat。
- 增加 `GET /api/cli/health` 用于识别可复用 server。
- Studio 在 CLI 中只做轻入口：slash command 透传、紧凑状态、plan-review 路径/Web URL；完整任务详情与配置仍在 Web。
- MVP 不自动注册 Project Registry，避免污染项目列表。

## 验证

未运行 lint/tsc；本轮只写规划文档。

## 剩余风险

- `bin/pi-web.js` 提取公共 runner 时可能影响 `ypi` 兼容性，需要优先 smoke。
- `bin/ypic.js` 必须是发布包可直接执行的 JS，不能 import 未编译 TS。
- 首条消息建议 draft -> SSE connect -> prompt，避免早期事件丢失。
- Studio 后台 run 存在时，CLI 退出不能误杀自己拉起的 server。

## 需要主会话决定

1. 审批 [plan-review.md](plan-review.md) 中的四项决策。
2. 如批准，主会话保存 implementationPlan 并切到 awaiting_approval/等待用户确认后再进入实现。
3. 是否需要在实现前补充 UI 设计员 HTML 原型：当前建议不需要，除非产品决定新增 Web deep link 或富 TUI。 
