---
description: 继续当前蛋黄派工作室任务
---
继续当前蛋黄派工作室任务。

请先调用 `ypi_studio_task(action=current)` 或读取注入的 `<ypi-studio-state>`，确认当前 task、workflow、status、owner、缺失产物和下一步。然后按状态机推进：需要成员工作时必须使用 `ypi_studio_subagent` 指派对应成员；等待确认状态不得直接实现。
