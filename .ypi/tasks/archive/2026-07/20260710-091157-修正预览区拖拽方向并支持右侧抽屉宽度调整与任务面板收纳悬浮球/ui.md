# ui

## UI 原型门禁结论

已满足。HTML 原型已写入任务目录下的 [ui-prototype.html](./ui-prototype.html)。用户已确认原型方向基本通过。

## 用户确认与新增约束

- 多任务悬浮 widget 采用**卡片堆叠 B**。
- 当前 session 的悬浮区仅展示**明确绑定当前 session**的 task；未绑定但仅被 transcript / 创建动作提及的 task 不显示、不占位。
- 新增硬约束：**悬浮球和展开后的多任务面板都必须可拖动**。
- 新增硬约束：拖动位置必须受 viewport 安全区限制，不能拖到屏幕下方或边缘后不可见；窗口 resize、刷新读取历史位置、内容尺寸变化、收纳/展开切换时都要 clamp / 回弹。

## HTML 原型设计说明

1. **右侧抽屉 resize（宽度拖拽调整）**
   - 在右侧面板左边缘新增纵向 `col-resize` 热区（示意：`left: -4px`、宽度 `8px`）。
   - 鼠标悬浮或拖拽中高亮提示；拖拽动作修改 CSS variable 或 inline width，松开后写入 `localStorage`。
   - 文件、Studio、Trellis 模式共享此宽度状态。
   - 移动端保持现有全屏遮罩效果，不展示宽度拖拽热区。

2. **预览区垂直 resize 方向纠正**
   - 修正为：向上拖拽减小上方 FileExplorer 高度，向下拖拽增加上方 FileExplorer 高度。
   - 拖拽松开后继续持久化高度。
   - 保证 FileExplorer 最小高度和下方预览区最小高度限制。

3. **YPI Studio session 多任务悬浮 widget（卡片堆叠 B）**
   - 展开态显示当前 session 已绑定 task 列表，覆盖已完成、进行中、需要用户处理等状态。
   - 排序：需要用户处理 / 失败 / 阻塞优先，其次运行中，再次当前 runtime pointer 指向的已绑定 task，最后最近更新和完成/归档任务。
   - 每个任务卡片可点击，点击后打开右侧工作室抽屉并聚焦对应 task 详情页。
   - 若右侧 Studio drawer 已打开且已聚焦当前堆叠中的 task，可对悬浮面板/球做渐隐或避让，减少重复遮挡。

4. **展开面板拖动**
   - 展开态面板本体可拖动，推荐顶部 header / 空白区为主要 drag handle，任务卡片点击区域避免误拖。
   - 拖动中显示 `grabbing` cursor、轻微透明或边框高亮。
   - 拖动结束后持久化位置。
   - 面板宽高会随任务数量变化，因此每次 `tasks[]` 变化、展开/收纳切换、ResizeObserver 触发时都要重新 clamp。

5. **收纳悬浮球**
   - 点击 widget 顶部收起按钮将多任务面板收纳为圆形/胶囊悬浮球。
   - 悬浮球展示任务数量 badge；若有关联任务处于 `needs_user`、失败或阻塞，悬浮球变为橘色/红色并使用轻量 pulse 提醒。
   - 悬浮球可拖动，拖动结束后持久化位置。
   - 点击且未发生拖动时展开为卡片堆叠面板。
   - 悬浮球也必须通过 clamp 保持完整可见，不能只保留部分像素在屏幕边缘。

6. **移动端适配**
   - 移动端保持底部悬浮球/入口优先。
   - 点击悬浮球弹出 Mobile Bottom Sheet 展示当前 session 已绑定 task 列表。
   - 移动端如支持拖动悬浮球，也必须考虑 safe-area inset 与底部输入区；首版可仅允许在安全范围内移动入口。

7. **会话过滤原则（过滤未绑定任务）**
   - 仅展示绑定当前 session 的 task。
   - 未绑定 task 即使由 transcript、create tool result 或 runtime transient pointer 提及，也不占当前 session 悬浮入口，不替换已有任务。
   - API 可把这类未展示证据放入 warnings/diagnostics，但 UI 默认不渲染为卡片。
