# plan review（v2 - FileExplorer 整合至预览区）

任务：项目切换体验优化——session 重置、列表加载态、FileExplorer 整合至预览区。

本审批书是进入实现前的主审阅入口。

## 产物索引

- [prd.md](prd.md) — 目标、范围内/外、需求与验收标准（P1/P2/P3）
- [design.md](design.md) — 根因与方案、数据流、影响模块
- [implement.md](implement.md) — 执行顺序、子任务表、改动点
- [checks.md](checks.md) — 需求覆盖、切换路径回归矩阵
- [ui.md](ui.md) — UI 原型门禁说明
- [**ui-prototype-v2.html**](ui-prototype-v2.html) — **HTML 原型（请审阅）**

## 方案要点

1. **P1·Session 重置**：把重置触发源从「cwd 字符串变化」提升为「active space 变化」。在 `AppShell` 新增依赖 `activeProjectContext` 的 effect，当新 context 不匹配当前 session 时调用 `resetOnSpaceSwitch`。覆盖所有 8 类切换路径，URL 恢复不误清。

2. **P2·列表加载态**：`loadSessions` 引入 `sessionsSwitching` 状态 + `loadSessionsTokenRef` 竞态保护；space 变化才显示 skeleton，后台刷新保持平滑。

3. **P3·FileExplorer 整合至预览区**：
   - Sidebar **底部** FileExplorer（「项目空间信息」折叠区域）→ 移到预览区（右面板）内部**顶部**
   - Sidebar **顶部**选择空间区域（切换按钮、项目名/副标题、WT badge、Workspace 菜单）→ **保留不动**
   - 预览区 FileExplorer 可折叠/展开、可刷新、可拖拽调整高度
   - 仅 Files 模式显示 FileExplorer（Studio/Trellis 模式不显示）
   - 切换项目/空间后 FileExplorer 按新 cwd 自动重载

## ⚠️ 请审阅 HTML 原型

**原型文件**：[ui-prototype-v2.html](ui-prototype-v2.html)

### 原型覆盖场景

- ✅ Sidebar 顶部选择空间区域保持不动
- ✅ Sidebar 底部不再有 FileExplorer
- ✅ 预览区顶部 FileExplorer（可折叠/展开）
- ✅ 预览区关闭态（只有 sidebar + 聊天区）
- ✅ 预览区展开 + FileExplorer 折叠态
- ✅ 预览区展开 + FileExplorer 展开态
- ✅ 刷新按钮（2s 绿勾反馈）
- ✅ 拖拽调整 FileExplorer 高度
- ✅ Session 列表 skeleton 加载态
- ✅ 明/暗主题切换
- ✅ WorkTree badge、路径缺失态、长项目名省略

### 操作指引

原型顶部有场景模拟控制按钮：
- **A/B/C/D** 切换不同场景
- **切换明/暗主题** 按钮
- **折叠/展开预览面板** 按钮
- 预览区内 FileExplorer 可折叠/展开

## 审批请求

请审阅 [ui-prototype-v2.html](ui-prototype-v2.html) 后明确回复：

1. **原型方案是否接受？**
2. **整体计划（P1+P2+P3）是否批准进入实现？**

批准后任务进入实现阶段。
