# Implement

## 需先阅读

- `AGENTS.md`
- `components/AppShell.tsx`：四个 `getInitial*`、state、持久化 effects、resize handlers、style/条件渲染。
- `hooks/useTheme.ts`：`useSyncExternalStore` 参考。
- `app/layout.tsx`：仅确认不新增布局 blocking script。
- `docs/modules/frontend.md`

## 人类可读子任务表

| ID | 阶段 | 顺序 | 依赖 | 工作 | 可并行 |
| --- | --- | ---: | --- | --- | --- |
| IMP-1 | implement | 1 | - | 设计并实现稳定的 localStorage external-store helper，保留解析/clamp/迁移/容错 | 否 |
| IMP-2 | implement | 2 | IMP-1 | 将 sidebarWidth 切换为 hydration-safe snapshot 与显式 setter | 否 |
| IMP-3 | implement | 3 | IMP-1 | 将 rightPanelWidth、explorerHeight、explorerOpen 同批迁移，更新所有写入调用 | 可与 IMP-2 逻辑审查并行，但同文件编辑应串行 |
| IMP-4 | docs | 4 | IMP-2, IMP-3 | 更新 frontend module 文档 | 是 |
| IMP-5 | checks | 5 | IMP-4 | lint、tsc、浏览器复现与回归检查 | 否 |

## 实现要点

1. 明确每个 store 的 server default 与 client parser；保持返回 primitive/null。
2. subscribe 同时支持模块内 listener 与 `storage` 事件，保证 cleanup。
3. 用 store setter 替代无条件 persistence effects，避免 hydration 后默认值抢写。
4. right panel 的 viewport resize clamp 仍通过 setter；拖拽 handlers 使用最新 snapshot。
5. explorer legacy migration 幂等且 try/catch，避免读取过程广播。
6. 不调整 JSX 结构、样式规则或文案。

```json ypi-implementation-plan
{
  "version": 1,
  "subtasks": [
    {
      "id": "IMP-1",
      "title": "建立 hydration-safe 持久化布局 store",
      "phase": "implement",
      "order": 1,
      "dependsOn": [],
      "files": ["components/AppShell.tsx"],
      "instructions": "使用 useSyncExternalStore 建立稳定 server snapshot/client snapshot/subscribe/setter；保留四项解析、clamp、legacy migration 和 storage 异常回退。避免 render 期广播与初始化默认值覆写。",
      "acceptance": ["server snapshot 固定", "client snapshot 为 primitive/null", "同标签通知与 storage cleanup 正确"],
      "validation": ["静态审查订阅生命周期", "检查 localStorage 全部读写有容错"],
      "risks": ["无限渲染", "迁移副作用", "默认值覆盖持久值"],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "IMP-2",
      "title": "迁移左侧栏宽度",
      "phase": "implement",
      "order": 2,
      "dependsOn": ["IMP-1"],
      "files": ["components/AppShell.tsx"],
      "instructions": "将 sidebarWidth 改为 external-store snapshot，拖拽通过显式 setter 持久化，删除旧初始化/无条件 effect。保持 220/520/260 语义。",
      "acceptance": ["非默认宽度刷新无 hydration warning", "拖拽与持久化不变"],
      "validation": ["浏览器硬刷新复现", "边界值检查"],
      "risks": ["resize callback 使用陈旧值"],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "IMP-3",
      "title": "迁移右面板与 Explorer 持久状态",
      "phase": "implement",
      "order": 3,
      "dependsOn": ["IMP-1"],
      "files": ["components/AppShell.tsx"],
      "instructions": "迁移 rightPanelWidth、explorerHeight、explorerOpen；所有交互和 viewport clamp 走 store setter；保持 legacy 高度迁移。",
      "acceptance": ["三项持久状态刷新无 hydration warning", "条件子树、拖拽、展开和 clamp 无回归"],
      "validation": ["逐项持久值硬刷新", "legacy key 迁移", "窗口 resize"],
      "risks": ["explorer 条件子树不一致", "right panel clamp 写回竞态"],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "IMP-4",
      "title": "更新前端模块文档",
      "phase": "docs",
      "order": 4,
      "dependsOn": ["IMP-2", "IMP-3"],
      "files": ["docs/modules/frontend.md"],
      "instructions": "记录 AppShell 四项布局持久化采用 useSyncExternalStore 与稳定 server snapshot。",
      "acceptance": ["文档与实现范围一致"],
      "validation": ["人工审阅"],
      "risks": ["文档声称未实现能力"],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "IMP-5",
      "title": "自动与手工验证",
      "phase": "checks",
      "order": 5,
      "dependsOn": ["IMP-4"],
      "files": ["components/AppShell.tsx", "docs/modules/frontend.md"],
      "instructions": "执行 lint、tsc，并按 checks.md 验证 sidebar/right panel/explorer 持久化、hydration、边界和迁移。",
      "acceptance": ["lint/tsc 通过", "控制台无相关 hydration mismatch", "原交互无回归"],
      "validation": ["npm run lint", "node_modules/.bin/tsc --noEmit", "checks.md 手工步骤"],
      "risks": ["仅静态验证无法覆盖浏览器 hydration"],
      "parallelizable": false,
      "localReview": true
    }
  ]
}
```

## 验证命令

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

## 门禁与回滚

- 主会话保存 implementationPlan 并取得用户审批后才能进入实现。
- 实现后 checker 必须检查 hydration 控制台、首次写入竞态和订阅清理。
- 回滚只需恢复 AppShell 原状态初始化/effects；不改变存储 schema。
