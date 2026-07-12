# Review

## 结论

无已知 blocker/high 代码问题。共享 `ModelSelect` 已改为 viewport modal，provider 分组、跨 provider 搜索、选中态、遮罩/关闭、Escape、Tab focus trap、焦点恢复和 body scroll lock 均在组件内实现；移动端通过 `640px` media query 收敛为单列。

## 静态审阅

- 保留 `ModelSelect` 的公开 props、`placement` 兼容参数、`value/onChange` 语义和 provider/modelId option 值。
- 搜索排序与 provider 分组来自同一 `filtered` 结果，键盘高亮使用同一扁平索引。
- 选择后只调用一次 `onChange`（值未变化时不调用），关闭路径不修改值并恢复触发按钮焦点。
- Settings 嵌套 modal 的 Escape 由内层 document listener 先处理，关闭后恢复原字段焦点；body overflow 在 cleanup 中恢复。

## 验证状态

- `npm run lint`：通过。
- `node_modules/.bin/tsc --noEmit`：通过。
- 浏览器截图和完整人工验收尚未执行，剩余风险记录在 checks.md。
