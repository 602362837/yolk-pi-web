# design

## 数据结构

在 implementationPlan 中规范可选的结构化编排字段，兼容旧任务：

```ts
type SubtaskRelation = "serial" | "parallel" | "barrier";
interface ImplementationSubtask {
  id: string;
  title: string;
  status: "pending" | "ready" | "running" | "blocked" | "done" | "skipped";
  dependencies?: string[];
  relation?: SubtaskRelation;
  parallelGroup?: string;
  phase?: string;
  order?: number;
}
interface ImplementationPlan {
  schemaVersion: 1 | 2;
  execution?: {
    mode: "mixed" | "serial" | "parallel";
    maxParallel?: number;
    groups?: Array<{ id: string; title: string; relation: SubtaskRelation; dependencies?: string[]; subtaskIds: string[] }>;
  };
  subtasks: ImplementationSubtask[];
}
```

兼容策略：没有 `execution/groups/relation/parallelGroup` 的旧任务按 `order`/数组顺序渲染为 serial。

## 后端/编排

- 在 `lib/ypi-studio-types.ts` 增加字段类型。
- 在 `lib/ypi-studio-tasks.ts` normalize implementationPlan：过滤非法依赖、补默认 relation/order、计算 ready 子任务。
- 当前 claim 仍一次 claim 一个 ready subtask；可并行关系先用于计划与 UI 展示，不改变 approval gate。

## 前端

- `components/YpiStudioPanel.tsx`：任务详情流程路线增加 execution flow 组件，展示串行步骤与并行组。
- 实现 tab 二级 tab：按 subtask 生成 tab，保留 activeSubtaskId；只渲染当前 tab 内容。
- 文件名 helper：把 artifact key 与 fileName 分离，只有没有扩展名的 artifact key 才映射默认 `.md`，已带 `.md` 的值不再追加。
- 详情刷新：refreshKey 变化时后台重新拉取 detail，但不重置 active tab/subtab，不显示额外刷新行。
- 抽屉刷新提示：移除/隐藏“正在刷新”行，改为 header 中非布局占位的 aria-live 或 title 状态。

## 文档

更新 `docs/modules/frontend.md`、`docs/modules/library.md`，说明 implementationPlan 结构化串并行字段与 UI 规则。
