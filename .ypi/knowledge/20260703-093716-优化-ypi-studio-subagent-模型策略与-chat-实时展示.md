# 优化 YPI Studio subagent 模型策略与 Chat 实时展示

- Task: 20260703-085853-优化-ypi-studio-subagent-模型策略与-chat-实时展示
- Workflow: feature-dev
- Archived task: .ypi/tasks/archive/2026-07/20260703-085853-优化-ypi-studio-subagent-模型策略与-chat-实时展示
- Archived at: 2026-07-03T01:37:16.497Z
- Tags: studio, feature-dev

## Summary
完成 YPI Studio subagent 模型策略与 Chat 实时展示优化：新增纯策略解析模块 lib/ypi-studio-policy.ts，固化 toolInput > memberConfig > defaultPolicy > followMain > piDefault 优先级，输出 diagnostics/fallback warnings；ypi_studio_subagent progress 增加 phase/tokens/tps/currentTool；Chat transcript 改为摘要优先并支持 debug/raw 二级展开；Session widget/live overlay 展示 waiting_model/streaming/running_tool/waiting_for_user 和 t/s；新增 npm run test:studio-policy。验证：test:studio-policy、lint、tsc 通过，checker review pass。

## Reusable knowledge
# 优化 YPI Studio subagent 模型策略与 Chat 实时展示

## 背景

用户反馈 YPI Studio `ypi_studio_subagent` 存在三类问题：

1. 有时没有遵从 Settings 中为工作室成员配置的模型。
2. Chat 中 subagent 对话栏信息过繁，工具调用明细默认暴露过多。
3. 运行中只能看到“在工作”，缺少类似主 session 的 `xxx t/s` 状态，难以判断是否在等待/接收模型输出。

## 实现要点

- 新增 `lib/ypi-studio-policy.ts` 作为纯策略解析模块。
- 固化 Studio member 模型/thinking 优先级：`toolInput > memberConfig > defaultPolicy > followMain > piDefault`。
- 策略解析输出 `policy` diagnostics、fallback chain、warnings，并保留兼容字段 `model/thinking/modelSource/thinkingSource`。
- `lib/ypi-studio-extension.ts` 的 `runChildPi` 增加实时进度状态：`starting`、`waiting_model`、`streaming`、`running_tool`、`waiting_for_user`、`finished`。
- live progress 增加估算 `tokens/tps/currentTool`；usage 存在时优先使用 usage output token。
- `components/YpiStudioSubagentTranscript.tsx` 改为摘要优先：默认折叠，展开默认 compact；prompt/status/stderr/raw JSON 放到 debug/raw 二级开关；错误/warning/waiting_for_user 默认可见。
- `ChatWindow` 和 `YpiStudioSessionWidget` 透传/展示 phase、tokens、t/s、current tool 和 `waiting_for_user` 状态。
- Settings 文案说明 tool input override 与 fallback 规则。
- 新增轻量测试脚本 `scripts/test-ypi-studio-policy.mjs` 和 `npm run test:studio-policy`。

## 验证

- `npm run test:studio-policy` passed。
- `npm run lint` passed。
- `node_modules/.bin/tsc --noEmit --pretty false` passed。
- Checker review passed；检查阶段补齐了 `waiting_for_user` live/widget status 透传。
- 主会话复核时补齐了 transcript deferred fetch：普通展开只使用 progress preview，debug/raw 才拉完整 bounded transcript。

## 注意事项

- `tokens/tps` 是 UI 展示估算，不代表 billing usage。
- 新增字段均 optional，旧 task/transcript 可 fallback 渲染。
- 建议发版前手工验证：Settings 覆盖链路、长 transcript 展开体验、`waiting_for_user` 高亮、streaming/running_tool/finished 的实时 phase/tps 展示。

## Source artifacts
- handoff.md
- review.md
- checks.md
- design.md
- implement.md
- prd.md
