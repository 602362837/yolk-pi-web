---
description: 让蛋黄派工作室检查员审查当前任务或改动
argument-hint: "[检查重点]"
---
让蛋黄派工作室检查员审查当前任务或当前改动。

检查重点：${ARGUMENTS:-需求覆盖、代码质量、验证结果、回归风险}

请先确认当前 Studio task。如果没有任务，询问是否创建 review-only 工作流任务。已有任务时，必要时将状态切到 `checking`，然后使用 `ypi_studio_subagent(member=checker)` 指派检查员。检查结论应更新到任务 review 产物或子代理运行摘要。
