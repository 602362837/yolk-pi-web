# IMP-001 修复计划

## 问题
Usage 底部的“Session 统计 / 调用限制”切换控件在窄空间中被裁切或被相邻元素遮挡。

## 最小修复
检查 Usage modal 的 header、切换控件容器和 z-index/overflow；让切换控件在 header 中拥有独立布局空间，必要时允许横向滚动或缩小标签，不改变旧 Usage 数据逻辑和新用量逻辑。

## 验证
在 30142 调试服务验证桌面与窄窗口，确认两个切换项完整可见、可点击，且旧 Usage 与调用限制视图均可切换。运行 lint 与 tsc。

## 参考
- [主任务 UI 说明](../ui.md)
- [主任务 HTML 原型](../usage-provider-model-prototype.html)
