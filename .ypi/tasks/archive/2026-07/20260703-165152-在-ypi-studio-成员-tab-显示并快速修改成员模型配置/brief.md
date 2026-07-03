# Brief

## 用户诉求

在 YPI Studio 的「成员」tab 页体现每个成员配置的模型；用户点击“修改模型”时，直接唤出 Settings 中对应的 Studio 成员模型配置区域，方便快速操作。

## 范围

- Members tab 展示成员模型/thinking 策略摘要。
- 从成员卡片/详情打开 Settings Studio 配置，并定位到对应成员。
- 支持默认成员和从 Members tab 跳转的自定义成员。
- 不改变 YPI Studio 子代理运行时模型解析优先级。

## 非目标

- 不新增后端 API。
- 不把模型配置写入 `.ypi/agents` 成员定义文件。
- 设计确认前不实施代码修改。
