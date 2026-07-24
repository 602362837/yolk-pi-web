# UI 评估：不触发 HTML 原型门禁

## 结论

**本计划不触发新的 UI HTML prototype gate。**

原因：计划不修改 `components/LinksConfig.tsx`、Settings 信息架构、组件状态、布局、文案、交互控件或 API wire shape。服务端默认 `authorizationConfigured=true` 后，用户进入的是现有且已经实现/批准过的 **空态 → 连接 GitHub → Device Flow** 路径；并未设计新页面或新交互。现有“GitHub 授权尚未配置”状态仍保留为防御性/测试状态，不删除、不改文案。

这属于产品 server-only 默认配置与可用性修正，而不是 UI 方案变更。因此不派发 UI 设计员，也不新增 `.html` 原型。

## 现有 UI 行为影响

| 场景 | 变更前 | 变更后 | 是否改组件 |
| --- | --- | --- | --- |
| 未设置 env 的官方运行 | catalog `authorizationConfigured=false`，连接按钮禁用 | catalog `authorizationConfigured=true`，进入既有空态/连接流程 | 否 |
| 非空 env 覆盖 | 进入既有连接流程 | 同上，使用覆盖 Client ID | 否 |
| test-only 强制未配置 | 既有 warning / disabled 状态 | 保留 | 否 |
| 错误 env / Device Flow disabled | 既有安全错误状态 | 保留 | 否 |

## UI 安全边界

- 浏览器仍只接收 `authorizationConfigured`、连接摘要和 Device Flow 的 user-facing 字段。
- 默认 Client ID、env 名和值不进入 React state、DOM、toast 或浏览器配置。
- 不新增 Client ID / Client secret / PAT 输入、显示、复制或持久化控件。
- 不改变 user code、`device_code`、access token 的现有边界。

## 重新触发门禁的条件

实现阶段若提出以下任一改动，必须停止该子任务并补派 UI 设计员产出 HTML 原型，再请求用户审批：

- 删除或重写未配置态、错误态文案；
- 新增 Client ID 配置/禁用入口；
- 改变连接按钮、Device Flow 步骤或 Settings 信息结构；
- 向用户展示新的配置来源、应用身份或诊断信息。

## 人工 UI 回归

实现后只做现有界面的回归，不做视觉重设计：无 env 时按钮可用并进入既有 Device Flow；test-only 未配置态仍可达；DOM/Network 响应不含产品 Client ID 或 `NEXT_PUBLIC` 配置。
