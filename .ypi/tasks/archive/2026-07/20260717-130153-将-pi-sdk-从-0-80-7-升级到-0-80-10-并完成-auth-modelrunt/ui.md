# UI：无用户界面改动

## 门禁判断

**No UI surface change / no HTML prototype required.**

本任务仅涉及服务端 Pi SDK、credential persistence、ModelRuntime、API 内部实现与测试迁移：

- 不新增/删除页面、面板、按钮或设置项；
- 不改变 OAuth 登录、添加账号、Activate、logout、模型切换的用户步骤；
- 不改变 API wire response 的既有前端消费字段；
- 不改变审批/确认体验或用户可见信息结构。

0.80.10 可能使模型列表出现上游目录差异（Kimi/xAI/Grok 项），这是依赖目录数据变化，不是本项目 UI 结构或交互设计变更，因此不触发 HTML 原型门禁。

## 实现期升级条件

若实现发现必须修改 `ModelsConfig`、Chat 模型选择器、登录提示、错误态或其他用户可见交互，则对应子任务必须停止，回到 planning：

1. 指派 UI 设计员基于现有项目产出 `.html` 原型；
2. 在本文件与 `plan-review.md` 链接原型；
3. 获得用户明确审批后再恢复该 UI 改动。

当前不需要 UI 设计员，不生成 HTML 文件。