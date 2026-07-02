# PRD

## 目标与背景

YPI Studio member 委派通过 `ypi_studio_subagent` 在主 chat 中表现为一个普通工具调用。现状是子 Pi 进程运行期间工具展开区主要只显示输入 JSON，子进程 stdout/stderr 被缓存到结束后才返回，用户长时间只能看到类似“等待 subagent”的状态，容易误判为卡死。

本任务目标是在不重做主 chat 的前提下，让 `ypi_studio_subagent` 工具调用展开区显示可读、可回放的子 agent transcript：运行中有明确进展，且用户保持展开时能持续看到实时变化；完成后可查看 member prompt、assistant 输出、工具调用/结果摘要和错误/stderr，并对历史无 transcript 的运行优雅降级。

## 范围内

- 主 chat 的 `ypi_studio_subagent` 工具展开区专用渲染。
- 子 Pi JSON 事件流的实时解析、进度上报和 sidecar transcript 持久化。
- 展开区在子 agent 仍工作时随 SSE `tool_execution_update` 持续刷新最新 transcript/progress，而不是只在结束后更新。
- YPI Studio task subagent run 记录增加 transcript 引用/状态摘要，但不把完整 transcript 写入 `task.json`。
- 新增只读 transcript API，用于前端按 `taskId/runId` 拉取完整或分页/截断后的 transcript。
- 前端运行中状态、完成后 transcript、错误/取消/超长/缺失文件降级展示。
- 更新相关 docs：`docs/modules/frontend.md`、`docs/modules/api.md`、`docs/modules/library.md`。

## 范围外

- 不改变 YPI Studio 工作流状态机、审批规则、成员定义和调度策略。
- 不把普通工具调用全部改成 chat-like 展示。
- 不默认增强顶部 `Subagents` 面板；本任务优先主 chat 工具展开区。
- 不暴露 child 运行的 system/developer 隐藏提示。
- 不引入提交、推送、合并行为。

## 用户价值

- 用户在 member 委派执行期间能确认子 agent 已启动、仍在推进、最近输出是什么。
- 用户展开工具块并停留观察时，可以看到子 agent 工作中的状态和 transcript 片段实时变化，避免误以为卡死。
- 完成后可在主 chat 中回看子 agent 的关键执行过程，而不是只看 prompt 和最终摘要。
- 失败/取消/异常 stderr 有诊断入口，减少“卡死”和“无输出”的误解。

## 需求与验收标准

1. 运行中实时进展
   - 当 `ypi_studio_subagent` 开始执行后，展开区显示 member、task/run、状态、已等待时长、模型/thinking（如有）和最近 transcript 片段。
   - 用户在子 agent 工作中保持展开工具块时，展开区必须随 `tool_execution_update`/SSE 事件持续刷新最新状态、事件计数、最后更新时间和 transcript preview；不能只在子 agent 结束后一次性显示。
   - 若技术上没有 token 级输出，至少显示“child Pi 已启动 / 等待模型 / 正在执行工具 / 已收到 N 条事件 / 最后更新时间”，并在这些状态变化时实时刷新。

2. 完成后 transcript
   - 展开区能显示可读 transcript，包含 delegated prompt/member prompt 摘要、assistant 输出、工具调用摘要、工具结果摘要、stderr/error。
   - 默认不显示 system/developer 隐藏提示；若原始 JSON 事件不含这些内容，不额外生成或暴露。
   - 最终 tool result 仍保留给主 agent 使用的 final output。

3. 持久化与审计
   - 每次新运行产生 transcript sidecar 文件，task run 只保存 transcript 引用、计数、截断状态和摘要。
   - `.ypi/tasks/<task>/task.json` 不写入大段完整 transcript。
   - transcript 文件丢失、旧 run 无 transcript、格式不兼容时，UI 显示明确降级原因并回退到 result/summary。

4. 大输出策略
   - 实时 partialResult 和 task run summary 有字节/行数上限。
   - transcript API 默认返回 bounded projection；超长内容折叠/截断，并提供查看完整或打开 sidecar 文件路径的入口。

5. 错误与取消
   - 子进程 exit non-zero、abort、stderr 非空、stdout 非 JSON、transcript 写入失败时，展开区显示可读状态和错误原因。
   - 取消时 run 状态为 `cancelled` 或失败降级状态，不停留在 running。

6. 兼容性
   - 历史 `ypi_studio_subagent` result 没有 transcript 时不报错，仍显示输入 JSON 和最终 result/summary。
   - 通用 `subagent` / `trellis_subagent` 的现有面板行为不被破坏。

## 未决问题

- 是否需要在后续迭代同步把 YPI Studio member run 纳入顶部 `Subagents` 面板。本任务建议不做，避免两套入口状态不一致。
- transcript sidecar 是否需要长期清理策略。本任务只设计路径和 bounded 写入，不做自动 GC。
