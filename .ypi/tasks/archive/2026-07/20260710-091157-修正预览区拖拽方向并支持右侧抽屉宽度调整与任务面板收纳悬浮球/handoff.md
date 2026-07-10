# handoff

## 当前阶段结论

规划已完成，可进入 `awaiting_approval` 由主会话/用户审批是否开始实现。当前未实现生产代码。

用户已确认 UI 原型方向基本通过，并新增硬约束：**悬浮球和展开后的多任务面板都必须可拖动，且必须 clamp / 回弹到可视安全区，避免拖到屏幕下方或边缘后看不见。**

## 已更新产物

- [brief.md](./brief.md)
- [prd.md](./prd.md)
- [ui.md](./ui.md)
- [design.md](./design.md)
- [implement.md](./implement.md)（含 fenced `json ypi-implementation-plan`）
- [checks.md](./checks.md)
- [plan-review.md](./plan-review.md)

## 核心设计决策

1. 多任务悬浮 UI 采用卡片堆叠 B。
2. 当前 session 悬浮区只展示明确绑定当前 session 的 task。
3. 未绑定但 transcript / 创建动作提及的 task 不显示、不占位、不替换旧任务；仅进入 API warnings/diagnostics。
4. API 保留旧 `task` 字段为 primary 兼容项，新增 `tasks[]` / `primaryTaskKey` / `warnings`。
5. runtime pointer 只对已绑定 task 标记 current/primary，不作为未绑定 task 展示依据。
6. 多个 bound task 不再 fatal `ambiguous`，应返回全部 candidates。
7. 展开面板与收纳悬浮球都可拖动、持久化，并在初始化/拖动/resize/形态切换时 clamp 到安全区。

## 推荐下一步

主会话保存 implementationPlan 并将任务推进到 `awaiting_approval`，向用户请求实现审批。审批通过后按 `implement.md` 子任务执行。

## Validation

未运行 `npm run lint` / `tsc`；本轮仅更新任务规划 artifacts，没有修改生产代码。
