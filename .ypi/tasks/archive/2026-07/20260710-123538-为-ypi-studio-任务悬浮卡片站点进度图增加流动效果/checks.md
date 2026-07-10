# Checks

## 门禁

- [x] `ui-prototype.html` 由 UI 设计员交付，覆盖 [UI](./ui.md) 指定状态。
- [x] 用户已审批流动仅代表活动 current 出站线、其他状态静止（事件记录：2026-07-10 04:51:04）。
- [x] 未审批前没有生产代码改动或状态迁移（进入 `awaiting_approval` 仅用于收集该确认）。

## 自动验证（实施后）

```bash
npm run lint
node_modules/.bin/tsc --noEmit
git diff --check
```

## 代码检查

- [x] `is-flowing` 只由既有 task/station/runtime 派生；没有修改 workflow stage、artifact evidence 或 task projection。
- [x] 当前阶段仅在 intake/planning/implementing/checking 且有下一段线时流动。
- [x] awaiting_approval、needs_user、waiting_for_studio_children、attention、failed、blocked、done、unknown、ready/completed 和 Review 末站静止。
- [x] 动画只在 line/伪元素上运行；drag shell 继续独占位置和 `transform`。
- [x] `.is-dragging` 与 `prefers-reduced-motion: reduce` 均禁用轨道 animation/transition；reduced-motion 还隐藏 shimmer 伪元素，静态状态色仍可见。

## 人工验收

1. 在 desktop 360px expanded card 依次核验 Brief、Design、Implement、Checks 活动时，仅正确出站线由左向右低调流动。
2. 核验 awaiting approval、needs user/waiting children、failed、blocked、completed/ready 的连线完全静止，节点/tooltip/标签仍与原语义一致。
3. 拖拽 expanded panel：位置稳定跟随、流动暂停；松开后仅符合条件的线恢复。Detail 按钮可点击且不启动拖拽。
4. 两个绑定任务并存：每张卡独立，primary 高亮、排序及运行摘要不变。
5. 打开 drawer 并 focused 任一任务、仅使用 Detail 进入、收纳/恢复悬浮球：轨道增强不改变既有显示或操作路径。
6. ≤640px：pill 与 bottom sheet 正常，轨道不横向溢出，卡片可滚动。
7. 在系统/browser 开启 reduced motion 后刷新：无 shimmer、pulse 或 transition，静态当前连线仍可辨。

## 回归执行记录（2026-07-10）

### 已完成

- [x] `npm run lint`
- [x] `node_modules/.bin/tsc --noEmit`
- [x] `git diff --check`
- [x] 源码回读：`is-flowing` 仅由本地 `current`、活动 workflow stage、runtime 与非 Review 出站线条件派生；不修改 task/workflow/artifact 投影。
- [x] 源码回读：`needs_user` / `waiting_for_studio_children`、failed/blocked、awaiting approval、terminal/unknown 与 Review 末站不会附加流动 class。
- [x] 源码回读：halo/shimmer 仅使用 node/line 伪元素；expanded panel 的 `.is-dragging` 暂停两者，`prefers-reduced-motion` 禁用其 animation/transition 并保留静态 halo。
- [x] 本地开发服务（`http://localhost:30141`）可访问（HTTP 200）。

### 待真实数据人工确认

当前浏览器会话没有可直接打开的本任务绑定 widget fixture，未对真实卡片逐项完成以下场景的目视验收：桌面拖拽、双任务堆栈、Detail-only/收纳球路径、≤640px bottom sheet，以及操作系统 reduced-motion。请主会话在绑定对应任务后按上方“人工验收”清单确认。

## 重点风险

视觉低对比度不足或过强、等待状态误动、以及 reduced-motion/dragging 的 CSS 覆盖遗漏是上线阻塞项。