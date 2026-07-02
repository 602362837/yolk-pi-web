# Handoff — 架构师研究完成

## 产物

- 更新 `prd.md`：明确范围、验收标准、未决问题。
- 更新 `design.md`：记录现状数据流、推荐数据模型、后端/前端影响点、Trellis 隔离方案、风险。
- 更新 `implement.md`：给出实现顺序、需读文件、验证命令、回滚方案。
- 更新 `checks.md`：给出需求覆盖、自动验证、手工验收和检查重点。
- 更新 `ui.md`：给出 Settings 与主 Chat 展示建议。

## 关键建议

1. 新增 `pi-web.json` 的 `studio` section，复用 `PiWebSubagentRunPolicy`，不要把本机模型 ID 写入 `.ypi/agents/*.md`。
2. `ypi_studio_subagent` 后端先解析有效策略，再统一用于 child Pi 启动、progress、final result、task.json 和 transcript 展示。
3. child Pi 启动参数改为 `--model <provider/modelId>` 与 `--thinking <level>` 分离传参。
4. YPI child spawn env 增加 `TRELLIS_SUBAGENT_CHILD=1`；当前 Trellis 扩展已识别该变量并早退，可直接隔离成员子进程。
5. 主 Chat 展示应读取 progress/final details 的实际 model/thinking，运行中也要可见。

## 验证

- 本轮为研究与规划，未修改生产代码，未运行 lint/type-check。
- 已通过源码阅读覆盖指定文件：docs 模块文档、`lib/ypi-studio-*`、`components/YpiStudio*`、`MessageView`、`SubagentPanel`、`useAgentSession`、`pi-web-config`、`SettingsConfig`、`rpc-manager`、`ToolPanel`、相关 API route。

## 剩余风险 / 需主会话决策

- 默认四成员是否保持 followMain/inherit（推荐，兼容优先），还是预置不同 thinking 等级。
- 是否在 MVP 中加入 `modelSource` / `thinkingSource` 字段；推荐加入，便于 UI tooltip 与排障。
- 是否要求 YPI Studio 主会话也完全禁用 Trellis。当前方案只隔离 YPI child member；若主会话也要关闭，需要单独改 Trellis 扩展开关或资源加载策略。
