# UI — 不触发 HTML 原型门禁

## 结论

**本规划不触发 UI 原型门禁。不指派 UI 设计员。无需 HTML 原型。**

原因是本任务不新增或修改页面结构、交互、确认流程、状态枚举或展示文案；只让服务端把真实 handler/bootstrap 状态正确写入现有 Jobs 观测字段。

## 门禁判定

| 触发条件 | 是否命中 | 说明 |
| --- | --- | --- |
| 页面变更 | 否 | Settings → GitHub 自动化结构不变 |
| 前端功能新增 | 否 | retry/pause/resume 控件不变 |
| 已有交互变化 | 否 | 仍为确认后 POST 单 job action |
| 审批/确认体验变化 | 否 | 无新弹窗或授权语义 |
| 用户可见信息结构变化 | 否 | 复用既有 dual-layer fields |
| 新文案/视觉状态 | 否 | 复用“Session 失败/不存在”“阻塞层”“REASON”“调度尝试” |

## 现有 UI 已具备的表达能力

`components/GithubAutomationConfig.tsx` 已消费并展示：

- `schedulerState`
- `agentExecutionState`
- `sessionAvailability`
- `blockedAtLayer`
- `retryability`
- `reasonCode`
- `counts.schedulerRuns / agentRuns / noProgressRuns / meaningfulProgress`

现有详情卡也已具备：

- `session_bootstrap` → 「Session 启动」阻塞层
- Session failed → 「Session 失败 / 启动或绑定失败」
- no Session → 「尚未启动 Agent / Session 不存在」
- scheduler layer → 「调度」
- `attempt` → 「调度尝试 N」
- raw stable reason code 诊断行

因此实现只需让 server projection 准确设置这些既有值：

| 后端事实 | 既有 UI 投影 |
| --- | --- |
| handler 未注册/加载失败 | `blockedAtLayer=scheduler`、`reasonCode=handler_not_ready`、Session none、不得 Agent active |
| bootstrap transient | scheduler backoff、Session creating/bootstrapping、layer session_bootstrap |
| bootstrap hard fail | Session failed、layer session_bootstrap、stable reason |
| Session 创建成功 | Session active/ended、short id、Agent count ≥1 |

## 实现边界

计划内不修改：

- `components/GithubAutomationConfig.tsx`
- `app/globals.css`
- Jobs 卡布局、rail、filters、按钮、确认弹窗
- wire 的状态 union/信息架构

允许的只有后端对既有字段的真值修复，以及现有 TypeScript union 消费所需的非 UI 类型同步（如无新 wire 值则无需改）。

## 回退门禁

若实现阶段发现以下任一需求，必须停止实现并回到架构/UI 门禁：

1. 新增 `failureSummary`、新的 session/agent/scheduler 状态值；
2. 新增中文错误卡、按钮、提示、确认体验；
3. 改 Jobs 卡信息层级、rail、颜色或过滤器；
4. 仅凭现有字段无法让用户识别 handler/bootstrap 层。

此时必须由主会话明确指派 `ui-designer`，交付 task-local HTML 原型并取得用户批准后才能继续。当前批准请求不包含上述 UI 变更。
