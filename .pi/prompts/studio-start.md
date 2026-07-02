---
description: 启动蛋黄派工作室结构化任务流程
argument-hint: "<目标>"
---
启动蛋黄派工作室流程。

目标：$ARGUMENTS

请按 YPI Studio 状态机执行：
1. 如果没有 active Studio task，先调用 `ypi_studio_task(action=create)` 创建任务，默认 workflow 用 `feature-dev`，除非目标明显是 bugfix / ui-change / review-only。
2. 进入接单和设计阶段后，使用 `ypi_studio_subagent(member=architect)` 指派架构师。
3. 涉及界面时，使用 `ypi_studio_subagent(member=ui-designer)`。
4. 方案稳定后切到 `awaiting_approval`，等待我确认后才允许进入 `implementing`。
5. 实现和检查必须分别通过 `ypi_studio_subagent(member=implementer)` 与 `ypi_studio_subagent(member=checker)` 指派。
