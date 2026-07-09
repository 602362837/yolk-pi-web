# handoff

## 已产出 / 已更新

- `brief.md`：补充用户确认的 `account_unusable` 自动切换、账号禁用/启用、UI 纳入范围。
- `prd.md`：新增 disabled 账号语义、Invalid/Missing API key 自动禁用、UI 需求与验收标准。
- `ui.md`：更新说明，详细描述了交互式 HTML 原型提供的自动禁用、并发防级联与无候选 Key 等模拟行为，并保持与项目现有风格一致。
- `opencode-go-failover-ui.html`：产出并优化了交互式 HTML 原型，支持通过状态模拟中心演示各种异常边界条件，包含额度不足自愈、账号损坏自动持久禁用、并发防级联切换及无候选 key 保护逻辑。
- `design.md`：补充 managed account disabled metadata/helper/API、`account_unusable` 持久禁用、候选跳过与并发锁流程。
- `implement.md`：更新机器可读 implementation plan，加入账号禁用/启用 API/UI、自动禁用测试与 rollout 子任务。
- `checks.md`：补充 disabled 账号、自动禁用、UI 审批与手工验收检查项。
- `plan-review.md`：更新审批摘要，明确本次包含 UI，并链接 HTML 原型。

## 验证

- 本次仅更新设计与审批材料，未修改生产代码。
- 未运行 `npm run lint` / `tsc`；本次无代码级验证需求。

## 剩余风险

- UI 原型已产出但尚未记录用户审批；进入实现前需主会话确认。
- active 账号被自动禁用且无 enabled 候选时，是否清空 active mirror 仍需主会话/用户确认。
- 手动禁用 active 账号的最终交互策略需审批：推荐优先要求选择替代账号，无法替代时允许确认清空 active。
- 进程级锁仍不覆盖多 Node 进程/cluster。

## 需要主会话决策

1. 审批 [opencode-go-failover-ui.html](./opencode-go-failover-ui.html)。
2. 确认 `account_unusable` 自动持久禁用触发账号，并由用户手动 Enable 后恢复。
3. 确认 active disabled 且无候选时是否允许清空 active mirror。
4. 批准后保存 implementationPlan 并进入实现流程。