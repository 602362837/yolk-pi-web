# implement

## 实施计划概览

- ST1 为串行基础任务，先定义 schema/normalize/兼容逻辑。
- ST2、ST3、ST4 在 ST1 完成后可并行：分别处理流程路线 UI、实现 tab 二级 tab、文件名/刷新稳定性。
- ST5 在 ST2/ST3/ST4 后串行收尾：抽屉刷新体验、文档与整体验证。

## 主要修改文件

- `lib/ypi-studio-types.ts`
- `lib/ypi-studio-tasks.ts`
- `components/YpiStudioPanel.tsx`
- `components/AppShell.tsx`
- `docs/modules/frontend.md`
- `docs/modules/library.md`
- 相关测试文件（如已有 studio policy/plan 测试则补充）

## 执行关系

```text
ST1 串行基础
  ├─ ST2 并行组 ui-detail-flow
  ├─ ST3 并行组 ui-implementation-tabs
  └─ ST4 并行组 ui-refresh-artifact
       ↓
ST5 串行收尾与验证
```
