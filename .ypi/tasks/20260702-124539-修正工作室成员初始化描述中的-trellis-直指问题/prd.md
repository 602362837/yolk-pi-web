# prd

## 目标与背景

YPI Studio 应作为独立的工作室体验呈现。成员定义可以借鉴内部工程经验，但不能在初始化内容、成员卡片预览或成员提示词中直接暴露 Trellis 名称、路径或专属流程术语。

## 范围内

1. 清理默认成员模板中的 Trellis 直指文本。
2. 明确已有 `.ypi/agents/*.md` 的兼容/迁移策略。
3. 保持 YPI Studio 现有成员职责、工作流状态、任务产物和派发机制不变。
4. 验证 Studio 相关可见面不再出现不应暴露的 Trellis 文案。

## 范围外

- 不移除项目中独立的 Trellis 功能、设置页、面板、API 或文档。
- 不重命名任务标题、历史事件、历史会话 transcript 中用户已输入的 Trellis 文本。
- 不改变 `.ypi/workflows` 状态机语义、任务目录结构或子进程派发机制。

## 需求与验收标准

| 需求 | 验收标准 |
| --- | --- |
| 默认成员文本独立表达 | 新初始化的四个默认成员文件正文不包含 `Trellis`、`.trellis`、`task.py`、`check.jsonl`、`jsonl manifest` 等 Trellis 专属引用。 |
| 用户展示不泄露内部参考 | 工作室成员面板打开默认成员预览时不出现 Trellis 直指。 |
| 成员提示词不泄露内部参考 | `buildMemberPrompt` 注入的 `Member Definition` 来自已清理成员文件；新任务派发提示词中不出现默认 Trellis 文案。 |
| 兼容已有项目 | 已自定义的 `.ypi/agents/*.md` 不被静默覆盖；只有可判定为旧默认内容的文件可自动升级，其他情况给出可见提示或保持跳过。 |
| 非目标 Trellis 功能保留 | `components/SettingsConfig.tsx`、`TrellisPanel`、`app/api/trellis/**` 等独立 Trellis 功能不在本任务中清理。 |

## 未决问题

- 是否允许实现阶段自动升级“完全匹配旧默认模板”的现有 `.ypi/agents/*.md`，并在初始化结果中报告 `updated`？推荐允许。
- 对“用户修改过但仍含 Trellis 文案”的成员文件，是仅提示用户手动处理，还是提供可选一键重置默认成员？推荐先提示/跳过，避免覆盖自定义内容。
