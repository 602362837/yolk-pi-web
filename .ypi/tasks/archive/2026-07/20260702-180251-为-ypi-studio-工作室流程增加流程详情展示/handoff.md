# handoff

## 已实现

- 新增 `lib/ypi-studio-workflow-flow.ts`：主路径排序、分支 transition 提取、flow projection。
- `lib/ypi-studio-workflows.ts` re-export flow helper。
- `lib/ypi-studio-session-link.ts` 复用共享排序逻辑。
- `lib/ypi-studio-types.ts` 增加非持久化 flow view types。
- 新增 `components/YpiStudioWorkflowDetail.tsx`：流程详情页、流程图节点、分支列表、任务流程区块。
- `components/YpiStudioPanel.tsx`：Workflows tab 支持列表 -> 详情；Task detail overview 展示当前任务流程并高亮当前状态。
- 更新 `docs/modules/frontend.md`、`docs/modules/library.md`。

## 验证

已补装 devDependencies 后运行：

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

两项均通过。

## 备注

- MVP 为“主路径流程图 + 分支/例外流列表”，不是完整 DAG 编辑器。
- `npm install --include=dev` 只安装依赖，未改 package 文件。