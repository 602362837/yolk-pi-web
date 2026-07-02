# brief

## 目标

按 YPI Studio 流程研究并设计：

1. 工作室四种默认成员（architect、ui-designer、implementer、checker）可以单独指定使用模型和思考等级，而不是总是继承主会话。
2. 主 Chat 中展示 `ypi_studio_subagent` 工具调用的位置，需要体现该 subagent 实际使用的模型与思考等级。
3. 研究如何避免/关闭 Trellis 在该流程中的影响，只按 YPI Studio 执行。

## 范围

- 先研究现有 `.ypi`、`lib/ypi-studio-*`、`components/YpiStudio*`、`components/MessageView.tsx`、`hooks/useAgentSession.ts` 的数据流。
- 输出实现方案与影响点；未经确认前不直接实现。
