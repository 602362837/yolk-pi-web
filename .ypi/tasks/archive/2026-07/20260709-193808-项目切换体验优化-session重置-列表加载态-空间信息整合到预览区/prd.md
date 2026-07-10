# prd

## 目标与背景

上一轮已把项目切换重构为弹窗分层选择。本轮修复切换链条上的三个体验问题：

## 范围内

- **P1·Session 重置**：用户切换项目或空间后，立即清除当前选中 session、清除 URL `?session=`、在新空间进入空状态（与 `+` 一致）。覆盖弹窗选择空间、右键菜单切换、WorkTree 新建选中、注册项目（add path / 目录选择 / default-cwd）、Git clone、WorkTree 归档·删除 fallback。URL 恢复（`?session=` 直接打开）不算切换，不得被重置清掉。
- **P2·列表加载态**：切换瞬间清空旧列表并显示 skeleton/spinner，加载完成前禁止点击旧列表项；后台刷新（agent 结束、归档等）不闪 skeleton，保持现有平滑行为；加入竞态保护，旧 fetch 慢响应不得覆盖新 list。
- **P3·文件浏览器移到预览区**：侧边栏**底部**的「项目空间信息」折叠区域（FileExplorer 文件浏览器）从左侧 sidebar 移到右侧预览区（右面板）内部**顶部**，作为可折叠的文件浏览区域。侧边栏**顶部**的「选择空间」区域（切换按钮、项目名/副标题、WT badge、Workspace 菜单）**保留在原位不动**。切换项目/空间时文件浏览器需重新加载。

## 范围外

- 不改 Project Registry / 会话 JSONL / 后端 API / WorkTree 语义。
- 不改 SSE/JSONL 记录格式、`lib/normalize.ts` 工具口径。
- 不引入"自动选中最新 session"。
- 不改项目/空间数据模型，不改星标/排序/拖拽规则。
- 不调整侧边栏宽度。
- **不动侧边栏顶部的选择空间区域**（切换按钮、项目名/副标题、WT badge、Workspace 菜单）。

## 需求与验收标准

### P1 切换重置

| ID | 需求 | 验收 |
| --- | --- | --- |
| P1-1 | 切换项目/空间后立即清空当前选中 session，`?session=` 从 URL 移除 | 切换后 URL 为 `/`，`selectedSession` 为 null，聊天区为新空间空状态 |
| P1-2 | 空状态使用新空间的 cwd/projectId/spaceId 上下文，首条 prompt 落到正确空间 | 在新空间发首条消息，落盘 session header 的 projectId/spaceId 与所选空间一致 |
| P1-3 | 所有显式切换路径统一走同一重置逻辑 | 弹窗选择、右键切换、WorkTree 新建、注册、clone、WorkTree 删除/归档 fallback 全部重置 |
| P1-4 | URL 恢复（`?session=xxx` 直接打开）不算切换 | 直接打开 URL 时正确恢复 session 与对应空间，不被"重置"清掉 |
| P1-5 | 切换后 branch tree / system prompt / 顶部下拉面板 / git dirty 复位 | 切换后顶部面板反映新空间，旧 branch 树消失 |

### P2 列表加载态

| ID | 需求 | 验收 |
| --- | --- | --- |
| P2-1 | 切换空间的瞬间清空旧列表并显示 skeleton | 不出现旧项目 session 残影；显示 3~5 行骨架占位 |
| P2-2 | 加载完成前禁止点击列表项 | skeleton 期间列表区域无交互 |
| P2-3 | 后台刷新不闪 skeleton | agent 结束、归档操作触发的列表刷新保持当前内容平滑过渡 |
| P2-4 | 竞态保护 | 切换后旧 fetch 的慢响应不会覆盖新列表 |
| P2-5 | 加载失败保留错误态 | 失败时显示错误提示而非旧列表 |

### P3 文件浏览器移到预览区

| ID | 需求 | 验收 |
| --- | --- | --- |
| P3-1 | 侧边栏底部的 FileExplorer（项目空间信息折叠区域）移到预览区顶部 | sidebar 不再渲染 FileExplorer；预览区展开时顶部显示文件浏览器 |
| P3-2 | 侧边栏顶部选择空间区域保持不动 | 切换按钮、项目名/副标题、WT badge、Workspace 菜单仍在 sidebar header |
| P3-3 | 预览区的文件浏览器可折叠收回 | 点击折叠按钮可收起文件浏览器，下方预览内容占满 |
| P3-4 | 切换项目/空间时文件浏览器重新加载 | 切换后面包屑/文件树反映新空间 cwd |
| P3-5 | 保留文件浏览器全部能力 | 刷新按钮、文件树展开/折叠、点击打开文件等能力不变 |
