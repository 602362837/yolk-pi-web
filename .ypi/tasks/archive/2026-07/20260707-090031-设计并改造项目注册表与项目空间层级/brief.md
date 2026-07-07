# Brief

## 背景
当前左侧项目选择区域疑似依靠 session 聚合得到项目列表。这会把项目入口与聊天历史绑定：删除 session 会丢失项目信息，session 多后列表扫描与聚合会变卡，也难以维护项目昵称、标签、工作树和扩展元数据。

## 目标
引入真正的项目概念，以项目文件夹记录/描述作为项目数据源；左侧层级以 Project 为基准，Project 下包含主项目空间和工作树子项目空间，session 归属到项目/子项目空间。

## 明确约束
- 不做历史 session 反推项目的迁移，避免错误归类。
- 改造后旧 session 信息仍可读取/打开，不应因为缺少 projectId/spaceId 报错。
- 原先已有工作树配置仍要能识别，并能作为项目的子项目空间展示或关联。
- session 是项目空间下的历史记录，而不是项目列表的数据源。

## 期望能力
- 独立 Project Registry，支持项目路径、昵称/显示名、tag、metadata 预留、pinned/archived/lastOpenedAt 等。
- Project Space 概念：main space 为项目根目录，worktree space 为工作树子项目空间。
- 新建 session 时能够关联 projectId + spaceId；旧 session 兼容 projectId/spaceId 缺失。
- 左侧导航从 Project Registry 读取项目，并在项目下展示主空间与工作树空间，space 下按需加载 sessions。
- 支持对项目/空间改昵称、打 tag，并为元数据扩展预留字段。

## 需要设计的问题
- Project Registry 存储位置和 schema。
- 与现有 worktree 配置/API 的兼容和映射策略。
- session reader/API/UI 对缺失项目归属的兼容策略。
- 左侧导航、项目选择、新建 session、打开已有 session 的数据流改造。
- API 路由和共享 lib 模块边界。
- 实施分阶段计划与验证项。
