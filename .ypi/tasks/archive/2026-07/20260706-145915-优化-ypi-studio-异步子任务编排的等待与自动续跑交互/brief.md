# brief

## 问题描述

当前 YPI Studio 在主 session 编排 `implementationPlan` 时，异步 implementer 子进程可以后台执行，但主 session 不会在子进程完成后自动获得新的执行回合，也不会自动继续 claim/dispatch 下一个 ready subtask。结果用户必须不断回到 chat 里输入“继续/查看进度”，主 session 才会 `poll/collect` 子进程结果并推进后续任务。

这造成了明显的交互问题：用户看到“已开始实现/后台运行中”后，会自然期待可以等待系统自动推进；但实际需要用户反复手动唤醒主 session。用户不确定自己是否应该一直询问，也不清楚 Studio 面板是否会自动驱动后续子任务。

## 复现场景

1. 创建带 `implementationPlan` 的 Studio 任务。
2. 用户批准方案，主 session 进入 `implementing`。
3. 主 session claim 一个 ready subtask，并通过 `ypi_studio_subagent(action=start, mode=async, member=implementer, subtaskId=...)` 派发实现员。
4. 实现员在后台 running。
5. 主 session 当前回合结束，用户等待。
6. 子进程完成后，如果用户不再发消息，主 session 不会自动 collect，也不会继续派发下一个 ready subtask。

## 用户期望

- 用户批准“开始实现”后，可以选择“后台自动跑完整个 implementation plan”。
- 子任务完成时，Studio/主 session 应能自动 collect 结果、更新 subtask 状态，并在依赖满足时继续 dispatch 下一个 subtask。
- 如果需要用户确认/失败/冲突，系统再主动显示需要关注，而不是要求用户轮询。
- Chat 中应明确告知：当前是自动续跑、需要用户等待，还是需要用户手动输入继续。

## 当前暴露的问题

- 异步子进程只有 `poll/collect` API，但缺少主 session 自动续跑/回调机制。
- Studio 任务面板可能能展示 running，但不能替代主 session 的 orchestration。
- 用户交互语义不清：“后台异步运行”听起来像会自动完成，但其实只是在后台执行当前一个子任务。
- implementationPlan 的多子任务依赖图无法无人值守推进。

## 建议目标

设计并实现一种 YPI Studio 自动续跑机制：

1. 主 session 派发 async member 后，注册一个 continuation/monitor。
2. 子进程 terminal 后自动 collect。
3. 自动更新对应 implementation subtask 状态。
4. 调用 `implementation_next` 获取 ready subtask。
5. 在不超过 `maxConcurrency` 的情况下自动 claim 并 dispatch 下一个 implementer。
6. 遇到失败、blocked、validation 需要人工确认、checker review、或所有任务完成时，向用户/Studio 面板显示明确状态。

## 非目标

- 不要求后台无限运行任意 agent；只针对 Studio implementationPlan 的受控子任务图。
- 不绕过 awaiting_approval 门禁。
- 不让 implementer 一次性执行整个计划；仍保持 subtaskId 单任务派发。
