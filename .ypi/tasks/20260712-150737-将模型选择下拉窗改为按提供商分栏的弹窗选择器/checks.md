# Checks

## 需求覆盖

- [x] 用户已审批 HTML 原型和分栏语义。
- [x] ChatInput 与 Settings 继续使用共享 modal，未改变调用方值契约。
- [x] provider 分栏、选中态、搜索态和空态已实现；窄屏为单列。
- [x] disabled、fallbackLabel、选择即生效并关闭保持原行为。

## 自动验证

- [x] `npm run lint`：通过（无 errors/warnings）。
- [x] `node_modules/.bin/tsc --noEmit`：通过。

## 静态检查结果

- `ModelSelect` 保留公开 props 和 `placement` 兼容参数。
- provider 分组和键盘扁平索引均来自同一过滤结果。
- modal cleanup 恢复 body scroll、query、高亮状态；关闭后恢复 trigger focus。
- `640px` 以下 provider 网格改为单列，长文本使用 ellipsis。

## 待环境恢复后的人工验收

- [ ] 新聊天和已有会话选择模型。
- [ ] Settings Studio/Trellis/Terminal 策略字段保存和还原。
- [ ] 搜索 model name、model id、provider id、provider display name。
- [ ] Escape、X、遮罩关闭不改值；选择后关闭并恢复焦点。
- [ ] Tab/Shift+Tab、ArrowUp/Down、Enter 和空结果 Enter。
- [ ] Settings 外层 modal 中打开选择器时 Escape 层级正确。
- [ ] 1440x900、768x800、320x568 无溢出。
- [ ] 浅色、深色、200% 缩放、reduced-motion。
- [ ] modal 打开时底层不滚动，关闭后恢复。

## 结论

自动 lint/typecheck 已通过。浏览器人工验收仍需在开发服务器中完成，当前记录为剩余验证项。
