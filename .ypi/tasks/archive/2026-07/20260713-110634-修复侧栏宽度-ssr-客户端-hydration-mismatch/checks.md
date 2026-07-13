# Checks

## 需求覆盖

- [ ] SSR 与 hydration 首帧对四项布局状态使用稳定默认快照。
- [ ] hydration 后恢复 sidebar/right panel/explorer 的合法持久值。
- [ ] 现有 storage key、默认值、clamp 和 legacy explorer migration 不变。
- [ ] 用户拖拽、展开/收起后仍持久化。
- [ ] localStorage 异常安全回退。
- [ ] 无 `suppressHydrationWarning`、禁用 SSR 或新增 blocking layout script。

## 自动验证

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

如项目已有适合的测试基础，增加针对 parse/clamp/store snapshot 的单元测试；不要为这一窄修复引入新的测试框架。

## 手工复现与验收

1. `npm run dev`，浏览器打开 `http://localhost:30141`，清空控制台。
2. 将左侧栏拖到 220px 左右，确认 `localStorage['pi-web-sidebar-width']` 为非默认值；硬刷新。
3. 确认控制台无 hydration mismatch，侧栏 hydration 后恢复该宽度；再次拖拽和刷新仍有效。
4. 打开右面板并拖为非默认宽度，硬刷新后再打开，确认宽度恢复且无 hydration 警告。
5. 调整文件浏览器高度并切换收起状态，分别在 open=true/false 下硬刷新，确认状态/高度恢复且无警告。
6. 设置边界/异常值：sidebar 低于 220、高于 520、非数字；确认回退或 clamp 与原语义一致。
7. 改变浏览器宽度，确认右面板仍按 65% 视口上限 clamp。
8. 仅设置 legacy explorer key，移除新 key 后刷新；确认迁移成功且高度生效。
9. 可选跨标签：两个同源标签页中改变一项，确认另一页响应对应 `storage` 事件（若实现该能力）。
10. 在 DevTools 临时模拟 localStorage get/set 抛错或受限环境，确认页面不崩溃。

## 重点代码审查

- [ ] `getSnapshot` 返回 primitive/null，引用与结果稳定，无无限重渲染。
- [ ] 当前标签写入后显式通知；不依赖不会在当前标签触发的 `storage` 事件。
- [ ] 不存在初始化 effect 把默认值覆盖已有持久值的竞态。
- [ ] subscribe 清理监听器；只响应相关 key/clear 事件。
- [ ] explorer legacy 迁移不在 render 中引发通知递归。
- [ ] docs 与实际范围一致。

## 回归风险

重点观察 hydration 后短暂默认尺寸校正、移动端侧栏条件样式、右面板关闭时宽度恢复、explorer 条件子树，以及 resize callback 是否取得最新快照。
