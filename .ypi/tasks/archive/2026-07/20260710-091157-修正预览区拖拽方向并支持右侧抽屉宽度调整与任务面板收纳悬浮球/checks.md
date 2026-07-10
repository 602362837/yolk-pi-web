# checks

## 自动验证

- [ ] `npm run lint`
- [ ] `node_modules/.bin/tsc --noEmit`

## 需求覆盖检查

### R1 预览区垂直拖拽方向

- [ ] 打开右侧 files 面板。
- [ ] 向下拖动“项目空间信息/文件树”底部分隔条，上方文件树高度增加。
- [ ] 向上拖动分隔条，上方文件树高度减少。
- [ ] 最小文件树高度和最小预览区高度仍生效。
- [ ] 刷新后高度持久化行为不退化。

### R2 右侧抽屉宽度可调整

- [ ] 桌面端右侧抽屉左边缘出现 resize 热区。
- [ ] 拖拽可调整宽度，拖拽中无明显重排抖动。
- [ ] 刷新后宽度保留。
- [ ] files / studio / trellis 模式共享宽度。
- [ ] 缩小窗口或读取异常历史宽度时会 clamp 到可用范围。
- [ ] 移动端保持全屏 drawer，不显示宽度 handle。

### R3/R4 多任务悬浮 widget、收纳球与拖动 clamp

- [ ] 单任务时 widget 正常展示，可收纳为悬浮球。
- [ ] 多个绑定当前 session 的 task 同时展示为卡片堆叠。
- [ ] 悬浮球展示任务数量 badge 和最高优先级状态色。
- [ ] 展开面板可拖动，无法拖出屏幕可视区。
- [ ] 收纳悬浮球可拖动，无法拖出屏幕可视区。
- [ ] 拖到四边/底部后仍完整或足够可见；窗口 resize 后自动回弹/重算。
- [ ] 刷新后读取历史位置并 clamp；历史越界位置不会导致 UI 消失。
- [ ] 点击悬浮球展开；点击任务卡片打开右侧 Studio drawer 并聚焦对应 task。
- [ ] 右侧 Studio drawer 已打开并聚焦相关 task 时，悬浮 UI 避让或渐隐。
- [ ] 移动端入口和 bottom sheet 可用，且不会遮挡到无法操作。

### R5/R6 session 多任务感知与过滤

- [ ] API 返回旧兼容字段 `task`，且代表 primary task。
- [ ] API 返回 `tasks[]`、`primaryTaskKey`、`warnings` / diagnostics。
- [ ] 同一 session context 绑定多个 task 时，`tasks[]` 返回多个，不返回 fatal `ambiguous` 导致 `task:null`。
- [ ] 未绑定但 transcript 提及的 task 不在 `tasks[]`，前端不显示、不占位。
- [ ] runtime pointer 指向未绑定 task 时不替换已有绑定 task，仅进入 warnings/diagnostics。
- [ ] 新绑定 task 后加入堆叠；未绑定新 task 不会让旧任务消失。
- [ ] 自动继续只对 primary/current 已绑定 implementing task 触发，不对所有 implementing task 盲目触发。

## 质量检查

- [ ] 没有手写重复的 tool-call/task field mapping；共享逻辑放在 `lib/ypi-studio-session-link.ts` / types。
- [ ] pointer event listener / pointer capture 都有 cleanup。
- [ ] localStorage 读取有 try/catch，异常或旧格式会回落默认值。
- [ ] ResizeObserver / window resize 不造成无限 setState 循环。
- [ ] CSS mobile media query 不被 desktop width 逻辑破坏。
- [ ] 若 API/type/component 契约变化，同步更新 `docs/modules/api.md`、`docs/modules/frontend.md`、`docs/modules/library.md`。

## 回归风险

- [ ] 单任务 session widget 兼容旧行为。
- [ ] 无任务 session 不显示悬浮入口。
- [ ] archived session / archived task 处理符合预期。
- [ ] Trellis session widget 不受 Studio widget 改造影响。
- [ ] Chat 输入区、右侧 toggle strip、terminal panel 与悬浮 UI z-index 不冲突。

## 手工验收建议场景

1. 单 session 绑定 1 个 active task。
2. 单 session 绑定 2 个 active task，其中一个 needs_user。
3. 单 session 绑定 1 个 task，同时 transcript 提及另一个未绑定 task。
4. runtime pointer 指向未绑定新 task，但旧 task 仍绑定当前 session。
5. 右侧 drawer 分别处于 closed / files / studio focused / trellis 状态。
6. 桌面宽屏、窄屏、移动断点。
