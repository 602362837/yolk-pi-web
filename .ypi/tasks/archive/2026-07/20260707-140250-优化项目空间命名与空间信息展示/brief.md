# brief

## 背景

左侧项目区域已经区分“项目”和“项目空间”。当前主空间在 UI 中显示为 `Main`，容易被误认为 Git 分支 `main`。同时左上角/侧边栏顶部的项目空间位置展示信息不足，只能看到空间名或路径，不能快速判断当前分支、是否 WorkTree、以及 WorkTree 的来源/基准信息。

## 目标

- 将默认主空间展示文案从 `Main` 改为中文 `主空间`。
- 在侧边栏顶部项目空间信息中同时展示：空间名称、Git 分支信息、WorkTree 信息。
- WorkTree 空间应尽量展示来源/基准分支；缺失时明确提示未知，不猜测。
- 不改变 session JSONL 的 `spaceId: "main"`、Project Registry 顶层结构或历史会话归属。

## 范围内

- 梳理 Project Registry / Git metadata / Sidebar 展示链路。
- 设计最小 UI 文案、展示规则、数据结构补充方案和验证方式。

## 范围外

- 本轮不直接修改生产代码。
- 不做 Project Registry 全量迁移；旧数据保持兼容。
- 不改变 WorkTree 创建/归档/删除业务行为。
