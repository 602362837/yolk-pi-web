# PRD

## 目标与用户价值

修复刷新持久化布局偏好时的 SSR/客户端 hydration mismatch，消除控制台警告及 React 丢弃服务端树/重建 UI 的风险，同时保留用户上次设置。

## 范围内

1. 左侧栏宽度 `pi-web-sidebar-width`。
2. 右侧面板宽度 `pi-web:right-panel-width`。
3. 预览区文件浏览器高度（含 legacy key 一次性迁移）。
4. 预览区文件浏览器展开状态。
5. 同标签页写入后的立即更新，以及可合理支持的跨标签页 `storage` 同步。
6. 无效、越界或 localStorage 不可访问时保持当前默认值/钳制语义。

## 范围外

- 布局视觉、尺寸上下限、拖拽手感、响应式规则调整。
- 改变存储键或清理用户数据。
- 将偏好写入服务端、cookie 或账户配置。
- theme 初始化机制重构。

## 需求与验收标准

### R1 Hydration 一致

- 服务端输出与客户端 hydration 首帧对四项状态使用相同的稳定默认快照。
- 预先写入非默认 sidebar 值后刷新，不出现与 `--sidebar-width` 有关的 hydration mismatch。
- 同类 right panel / explorer 持久值不产生 hydration mismatch。

### R2 偏好恢复

- hydration 完成后应用合法的持久值。
- sidebar 仍限制为 220–520px；右面板仍按视口限制；explorer 高度仍至少 120px；open 缺省为 true。
- legacy explorer 高度仍能迁移到新 key。

### R3 持久化与容错

- 用户拖拽或切换时继续写入现有 key。
- localStorage 读取、写入或迁移失败不导致渲染崩溃。
- 订阅快照必须稳定，避免 `getSnapshot` 返回无意义新对象造成渲染循环。

### R4 无 UI 回归

- 侧栏、右面板、浏览器的结构、控件、标签、动画和操作方式不变。
- 允许 hydration 后发生一次由默认尺寸到持久尺寸的布局校正；不引入阻塞脚本。

## 未决问题

审批时确认推荐范围：同批修复四项持久化布局状态。若要求严格最小 patch，可仅修 sidebar，但不推荐，因为同文件会保留已识别风险。
