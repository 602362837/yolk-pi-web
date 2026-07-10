# Implement

## 前置门禁

先完成 [UI 委托](./ui.md) 中的 HTML 原型并取得用户审批。审批前不得修改生产代码。

## 先阅读

1. `docs/modules/frontend.md`
2. `docs/standards/code-style.md`
3. `app/globals.css`（sidebar/right-panel desktop CSS）
4. `components/AppShell.tsx`（right-panel handle 渲染与 resize 生命周期）

## 子任务

| ID | 阶段 | 顺序 | 内容 |
| --- | --- | ---: | --- |
| `ui-prototype` | UI | 1 | UI 设计员交付并获批 8px 命中区 HTML 原型。 |
| `fix-resize-hitbox` | Implement | 2 | 排除 handle 于 right-panel 内容通用尺寸规则，保留 8px handle。 |
| `verify-resize-hitbox` | Checks | 3 | 自动检查与三 mode/断点人工回归。 |

```json ypi-implementation-plan
{"schemaVersion":1,"tasks":[{"id":"ui-prototype","title":"右侧抽屉拖拽命中区 HTML 原型与审批","phase":"ui","order":1,"dependsOn":[],"files":[".ypi/tasks/20260710-104156-修复右侧抽屉左侧拖拽区域遮挡导致无法点击/ui.md",".ypi/tasks/20260710-104156-修复右侧抽屉左侧拖拽区域遮挡导致无法点击/ui-prototype.html"],"instructions":"ui-designer 根据 ui.md 交付独立 HTML 原型；主会话向用户取得审批。","acceptance":["原型标明 desktop 8px hit area、内容可点击区、三种状态与 mobile/reduced-motion 行为","用户审批已记录"],"validation":["浏览器预览 HTML 原型"],"risks":["未经审批擅自改变 drag hit-area"],"parallelizable":false,"localReview":false},{"id":"fix-resize-hitbox","title":"限制右侧抽屉固定宽度规则到内容子元素","phase":"implement","order":2,"dependsOn":["ui-prototype"],"files":["app/globals.css"],"instructions":"在 desktop right-panel CSS 中将通用直接子元素尺寸选择器排除 .right-panel-resize-handle；不要改 AppShell resize 算法、localStorage 或 mobile CSS。","acceptance":["handle 不再继承 300px min-width","handle 保持左缘 8px 拖拽能力","内容固定宽度规则仍作用于实际内容子元素"],"validation":["npm run lint","node_modules/.bin/tsc --noEmit"],"risks":["错误扩大改动范围或使内容在开合时 reflow"],"parallelizable":false,"localReview":true},{"id":"verify-resize-hitbox","title":"右侧抽屉交互回归","phase":"checks","order":3,"dependsOn":["fix-resize-hitbox"],"files":["app/globals.css","components/AppShell.tsx"],"instructions":"按 checks.md 在桌面和 mobile 断点检查 Preview、Studio、Trellis。","acceptance":["所有人工矩阵通过","自动验证通过"],"validation":["npm run lint","node_modules/.bin/tsc --noEmit"],"risks":["仅验证 files mode 导致 Studio/Trellis 回归遗漏"],"parallelizable":false,"localReview":true}]}
```

## 评审门禁

审阅 CSS 计算尺寸：handle 不得匹配 content 宽度/min-width 规则；不接受以关闭 pointer events 或降低层级来规避问题。

## 实施记录（2026-07-10）

已在 `app/globals.css` 的 desktop right-panel 内容尺寸选择器中排除 `.right-panel-resize-handle`。未修改 `AppShell.tsx`、宽度持久化、resize 算法或 mobile CSS；实际内容直接子元素继续保留固定宽度和最小宽度规则。
