# UI 评估

## 结论：不触发 UI HTML 原型门禁

本计划仅调整服务端 session 候选索引、读取范围、缓存、生命周期维护、Studio task 批量投影和请求可观测性：

- 不改变 Sidebar 页面结构、session/Studio child 行、信息字段、排序或操作入口。
- 不改变成功响应 `{ sessions, legacyUnassigned, studioChildrenByParentSessionId }`。
- 不新增 stale banner、恢复进度、骨架屏、提示文案或确认流程。
- 保留现有 loading/error 行为；冷恢复无安全结果时使用现有错误通道，不增加新视觉状态。

因此无需指派 UI 设计员，也无需 HTML prototype。

## 实现门禁

若实现阶段提出以下任一变更，必须停止对应改动、补派 `ui-designer`，产出任务目录内 `.html` 原型并请求用户审批：

1. 保留旧空间列表的 stale-while-revalidate 视觉语义。
2. 新增“索引重建中”、partial list、性能提示或恢复进度。
3. 改变 Studio child 是否显示、折叠层级、标题字段或 loading/empty/error 状态。
4. 改变设置/模型入口的加载交互。

当前没有 HTML 原型交付物。
