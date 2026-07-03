# PRD

## 目标与背景

优化 YPI Studio 成员委派体验，解决三类问题：

1. Studio member 子进程模型 / thinking 策略偶发不符合 Settings 配置，且当前 fallback 不够可观测。
2. Chat 中 `ypi_studio_subagent` transcript 展示信息过繁，缺少摘要优先和 debug 分层。
3. Studio member 子进程运行中缺少 phase、tokens、t/s 等实时状态，用户难判断是在等模型、流式输出、跑工具还是等待输入。

## 范围内

- 梳理并固化 Studio member 策略优先级：`toolInput > memberConfig > defaultPolicy > followMain > piDefault`。
- 为策略解析增加可观测诊断字段、fallback warning，并在 Chat transcript / final tool result 中显示。
- 将 `YpiStudioSubagentTranscript` 改为默认折叠、摘要优先；展开后仍默认 compact，二级开关显示 debug/raw。
- 在 `runChildPi` 中从 child Pi JSON 事件统计 `phase/tokens/tps/currentTool`，通过 `tool_execution_update` 实时传到前端。
- 同步前端类型、live overlay、Studio widget 显示规则和相关文档。

## 范围外

- 不更改 YPI Studio 工作流状态机、approval gate 或任务归档逻辑。
- 不引入新的模型路由 / 自动分类策略；本次只修正 Studio member 显式配置链路。
- 不改变 transcript API 路由结构；除非实现时发现必须新增 query 才处理分页/raw。
- 不新增重型测试框架；当前仓库以 lint、tsc 和手工场景验证为主。

## 需求与验收标准

### R1. 成员模型策略可预测且可诊断

- Settings 保存的 `studio.defaultPolicy` 和 `studio.members[*]` 被 `ypi_studio_subagent` 读取并按固定优先级解析。
- `member` id 在策略查询、成员文件读取、run id 展示前统一 canonicalize，避免 `Architect` 绕过 `architect` 配置。
- `toolInput.model/thinking` 仍最高优先级，但 UI/diagnostics 必须明确标记其覆盖了 Settings。
- `followMain` 无法解析主会话模型 / thinking 时，不再 silent fallback；必须在 diagnostics / warnings 中说明回退到 Pi default。
- final result 和 progress details 都能看到 effective model/thinking、source、fallback chain、warnings。

### R2. Transcript 摘要优先

- 默认折叠态只显示工具名、member、status/phase、elapsed、tokens/tps、model/thinking source 和 last preview。
- 展开态默认仍是 summary/compact，不直接渲染全部 transcript item。
- Debug 开关显示 status/stderr/prompt 等噪声项；Raw 开关显示原始 tool input、details、item JSON。
- 错误、waiting_for_user、warnings 必须默认可见，不隐藏到 debug。

### R3. 运行中 t/s 与阶段展示

- `runChildPi` 至少区分：`starting`、`waiting_model`、`streaming`、`running_tool`、`waiting_for_user`、`finished`。
- streaming 时根据 assistant delta / message text 估算 output tokens 和 t/s；有真实 usage 字段时优先使用真实 token。
- running_tool 时显示当前 tool name，保留最近 tokens/tps。
- waiting_for_user 时高亮展示 child extension UI request 摘要。
- finished 后保留 total tokens、平均 t/s、duration。

## 未决问题

- 是否在本次实现中为 policy resolver 增加轻量 Node test script；当前项目规范注明没有专门测试套件，推荐先不引入新框架。
- Settings 中 defaultPolicy 是否继续允许 `unset`。推荐保留兼容，但 UI 文案明确：default unset 会进入 `followMain -> piDefault` fallback。
