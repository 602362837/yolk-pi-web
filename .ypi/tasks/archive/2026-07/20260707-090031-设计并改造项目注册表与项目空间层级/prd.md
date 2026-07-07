# PRD

## 用户问题
左侧项目选择当前依靠 sessions 聚合，导致删除 session 会丢项目入口、session 多后卡顿，且无法稳定维护项目昵称、标签、工作树和元数据。

## 产品目标
建立独立 Project Registry，左侧项目树以 Project 为顶层数据源；Project 下包含 main space 和 worktree space；session 归属到 project/space，且仅作为空间下的历史记录懒加载。

## 必须满足
- 不做历史 session 反推项目迁移。
- 旧 session 缺少 projectId/spaceId 时仍可读取、打开、继续，不报错。
- 原有 WorkTree 配置和已有 Git worktree 仍可识别。
- 支持项目/空间昵称、tags、pinned、archived、metadata、lastOpenedAt 等元数据。
- 空 registry 时左侧显示添加项目入口，不扫描 sessions 生成项目。

## 主要体验
- 左侧层级：Project -> Space(main/worktree) -> Sessions(lazy)。
- 注册项目路径后生成 main space；注册/刷新项目时可发现 Git worktree 作为子空间。
- 新建 session 时带 projectId + spaceId；旧 session 可通过 URL/历史入口打开并标记未关联。
- 项目/空间支持改昵称、打 tag、pin/archive。
