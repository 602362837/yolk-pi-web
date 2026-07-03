# PRD

## 目标

在 YPI Studio 的「成员」tab 中直接展示每个成员当前模型策略，并提供一键进入 Settings 修改该成员模型配置的入口。

## 用户故事

- 作为用户，我能在成员列表/详情看到该成员使用的模型与 thinking 策略来源。
- 作为用户，我点击“修改模型”后，Settings 直接打开到 Studio 配置并定位对应成员，减少查找成本。
- 作为用户，我修改并保存后，回到 Members tab 能看到最新配置。

## 功能需求

1. Members tab 成员卡展示模型摘要、thinking 摘要、配置来源。
2. 成员详情展示更完整的运行策略信息。
3. 默认成员和自定义成员均支持从 Members tab 跳转修改。
4. Settings 支持外部指定初始 section 与 focused studio member。
5. 不改变实际子代理运行策略解析优先级。

## 非功能需求

- 不新增后端 API。
- 保持 Settings 常规入口既有体验。
- 避免嵌套 button，保持键盘可访问性。
