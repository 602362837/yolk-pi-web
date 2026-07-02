# UI — YPI Studio 模型与 thinking 配置展示

## 是否需要 UI 设计员

需要轻量 UI 设计，但不需要单独派发 UI 设计员即可实现：该功能主要复用 Settings 中已有模型策略控件，新增一个 Studio 配置分区即可。

## Settings → Studio

建议新增 Settings section：`Studio` / `工作室`。

布局：

1. 顶部说明
   - “配置 YPI Studio 成员运行时使用的模型与思考强度。该配置保存在本机 `pi-web.json`，不会写入项目 `.ypi/agents`。”
2. 默认策略卡片
   - 字段：默认模型、默认思考强度。
   - 说明：当成员没有独立策略时使用。
3. 四个默认成员策略表格 / 卡片
   - architect：架构师
   - ui-designer：UI 设计员
   - implementer：实现员
   - checker：检查员
   - 每行字段：模型策略、thinking。
4. 帮助文案
   - “显式工具调用入参会覆盖这里的配置。”
   - “跟随主会话无法解析时会退回 Pi 默认。”

## 主 Chat `ypi_studio_subagent` 展示

折叠头建议：

```text
ypi_studio_subagent  architect · Running · model: anthropic/claude-sonnet-4 · thinking: high · 12 events
```

展开 Meta 保持当前网格，并增强：

- Model：实际 label，title 显示 source。
- Thinking：实际 label，title 显示 source。
- 若 source 可用，可新增 Source 或在 title 中展示：`memberConfig`、`toolInput`、`followMain`、`piDefault`。

## YPI Studio Panel

非必需改动。可在 Members tab 顶部或成员详情中增加一行提示：

> 成员职责定义保存在 `.ypi/agents`；运行模型和 thinking 在 Settings → Studio 配置。
