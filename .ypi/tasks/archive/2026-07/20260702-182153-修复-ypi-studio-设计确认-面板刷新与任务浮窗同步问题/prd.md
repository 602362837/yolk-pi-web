# PRD

## 目标与背景

用户反馈 YPI Studio 当前存在 3 个影响工作流可信度和可读性的问题：

1. **最高优先级**：设计阶段完成后，主 session 没有把 PRD/Design/Implement/Checks 交给用户确认，而是直接进入制作/实现。
2. Studio 面板展开后数据加载慢；当 session 正在工作时，面板似乎持续刷新，用户无法稳定阅读。
3. 某个 session 创建/绑定 Studio 任务后，任务浮窗不实时出现，需要刷新页面。

本任务目标是给出可实现、可验证的最小可靠修复方案：状态机硬约束 + prompt/流程约束 + UI/API 同步修复。未经用户确认，不进入实现。

## 范围内

- 阻断 `awaiting_approval -> implementing` 的无确认转移。
- 明确主 session 在设计完成后必须停在 `awaiting_approval`，展示方案并等待用户批准。
- 优化 `YpiStudioPanel` 加载和刷新策略，减少空白和阅读打断。
- 修复 session 与 Studio task 的实时关联，使浮窗能在任务创建/绑定后自动出现。
- 更新相关模块文档中的行为说明。

## 范围外

- 不重做 YPI Studio 工作流系统或成员定义体系。
- 不引入 WebSocket/全局实时事件总线作为第一阶段方案。
- 不改变 Trellis 行为。
- 不在本设计阶段修改生产代码。

## 需求与验收标准

### R1：设计确认硬门禁

- 当任务从 `planning` 进入 `awaiting_approval` 后，系统必须等待后续用户输入中的明确批准。
- 同一轮 agent turn 内不得从 `planning` 经 `awaiting_approval` 继续进入 `implementing`。
- `override: true` 不得绕过 `awaiting_approval -> implementing` 的用户批准门禁。
- 如果无批准证据，`ypi_studio_task(action=transition, to=implementing)` 返回明确错误。

### R2：流程/prompt 提示

- `/studio-start`、注入的 Studio state、工具 guideline 都明确要求：设计完成后只转入 `awaiting_approval` 并回复用户确认，不调度 implementer。
- 当当前状态为 `awaiting_approval` 时，主 session 应优先展示待确认产物、询问批准/修改意见。

### R3：面板加载与刷新

- 打开 Studio 面板时，当前 Tab 的关键数据优先加载；非当前 Tab 可懒加载或后台加载。
- 已有数据时，后台刷新不得把内容替换成全屏 loading/空白。
- session 工作中最多进行轻量、静默、节流的任务刷新；用户正在查看任务详情/滚动阅读时不得频繁打断。

### R4：任务浮窗实时出现

- session 创建/绑定 Studio task 后，浮窗无需刷新页面即可出现。
- 任务关联优先基于稳定 session context id（`pi_<sessionId>` 或 transcript hash），避免 `pi_process_*` 导致无法高置信关联。
- 创建/绑定/transition 工具事件结束后，前端应触发一次即时、去抖的 `/api/sessions/[id]/studio-task` 重查。

## 未决问题

- 用户批准文本是否只接受明确中文/英文批准词（如“确认/批准/同意/开始实现/approve/go ahead”），还是任何非修改意见都算批准？建议只接受明确批准词。
- 是否需要在 UI 中增加“批准方案”按钮？最小修复可先用聊天批准文本；按钮可作为后续增强。
