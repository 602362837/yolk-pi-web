# summary

已为 YPI Studio 工作室流程增加流程详情展示：

- Workflows tab 支持点击流程卡片进入详情，并可返回列表。
- 流程详情按主路径流程图展示节点，说明 owner、委派成员、用户确认、必需/可选产物和 instruction。
- 流程详情展示触发方式、分支与例外流、状态/transition 元数据。
- Task detail 概览页新增“当前任务流程”，按任务 workflow 高亮当前 status，帮助用户理解该任务应该走的流程。
- 抽出共享 workflow flow helper，session widget 与详情页复用排序逻辑。
- 文档已更新。

验证：

- `npm run lint` 通过。
- `node_modules/.bin/tsc --noEmit` 通过。
