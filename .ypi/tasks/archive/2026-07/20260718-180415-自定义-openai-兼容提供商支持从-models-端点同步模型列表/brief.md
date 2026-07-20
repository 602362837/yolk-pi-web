# Brief：自定义 OpenAI 兼容提供商同步远端模型列表

## 背景

当前 Models 配置页直接编辑 `~/.pi/agent/models.json`。自定义 provider 由 `components/ModelsConfig.tsx` 中 `config.providers` 展示，provider 级 `api` 可取：

- `openai-completions`
- `openai-responses`
- `anthropic-messages`
- `google-generative-ai`

现有能力只能手工新增 `providers.<id>.models[]`；`GET/PUT /api/models-config` 负责整文件读取/写入，`POST /api/models-config/test` 只测试单个已配置模型。项目尚无从 OpenAI 风格 `/models` 端点发现并安全 merge 模型的能力。

Pi 0.80.10 文档确认：OpenAI 兼容协议由 `openai-completions` 与 `openai-responses` 表示；自定义模型最小配置只要求 `{ "id": "..." }`，其余 cost、reasoning、input、contextWindow、maxTokens 等字段可继续由用户手工维护。

## 目标

让用户在 Models 中针对一个**已保存的、自定义且 OpenAI 兼容** provider：

1. 从其自身已配置的 `baseUrl` 派生 `/models` 请求地址；
2. 预览远端模型列表并搜索、勾选；
3. 明确确认后把选中新增模型 merge 到该 provider 的 `models[]`；
4. 通过快捷操作一次选中并确认写入全部新增项；
5. 保证已有模型的 cost、手工字段、compat、thinking、overrides 和其他 provider 完全不被覆盖。

## 用户已确认的产品决策

1. 默认交互为“预览 → 用户确认写入”；同时提供快捷按钮，一键选择并写入全部新增项，但仍必须有清晰确认和结果反馈。
2. 仅支持 custom + OpenAI compatible provider；不得覆盖 SDK 内置目录、Grok、Kiro、Antigravity、其他固定扩展或非 OpenAI 协议 provider。
3. 写入目标固定为 `~/.pi/agent/models.json` 的 `providers.<id>.models[]`，使用 merge，不盲写、不改无关 provider，并保留已有 cost/手工字段/overrides。
4. 远端端点通常为 `GET {baseUrl}/models` 或 `GET {baseUrl}/v1/models`，必须兼容用户已在 `baseUrl` 中配置 `/v1`。
5. API 只能接收 provider id，服务端从已保存配置读取 baseUrl、headers 和凭据；不得接收请求方提供的任意 URL。密钥和 headers 不进入日志或 API 投影；请求有超时、稳定错误分类和用户可重试入口。
6. 本任务改变 Models 信息结构与交互，必须由 UI 设计员交付 HTML 原型并经用户审批后才能进入实现。

## 现状证据与实现约束

- `components/ModelsConfig.tsx`：custom provider 默认新建为 `{ api: "openai-completions" }`；当前没有 dirty snapshot、同步入口或预览弹窗。
- `app/api/models-config/route.ts`：当前 GET 返回整份配置，PUT 整文件覆盖且仅补齐已有 cost 的缺失费率。
- `app/api/models-config/test/route.ts`：通过临时 `models.json` 与隔离 `ModelRuntime` 测试单个模型，证明配置验证应继续使用 Web `ModelRuntime` 边界。
- `lib/model-price-config.ts`：已有 JSONC 读取、revision、备份、原子写和写后验证能力；同步不能建立与模型价格并行且互不协调的第三条写路径。
- Pi 文档说明 built-in provider 也可出现在 `models.json` 中做 baseUrl/modelOverrides/custom model 覆盖，因此“存在于 providers”不等于“custom”。后端必须排除 Pi built-in provider id 和固定扩展 id。
- 新增模型只写 `{ id }`；不得根据 `/models` 响应猜测价格、上下文、thinking、图像能力或 API override。

## 成功口径

- 目标 provider 可成功预览、搜索、勾选和 merge。
- 已存在模型保持对象级原样；新增项按远端顺序追加；重复项不重复写入。
- provider 以外的顶层配置和其他 provider 字节语义不被业务逻辑改动。
- 非目标 provider 无可用同步入口或显示明确禁用原因。
- 认证、超时、404 路径回退、无效响应、超大响应、revision 冲突均有安全错误和重试路径。

## 当前流程阻塞

当前 delegated architect 环境没有 `ypi_studio_subagent` / `ypi_studio_wait` / Studio transition 工具，无法真实派发 `ui-designer`、保存 task state 中的 implementationPlan，或把任务合法 transition 到 `designing` / `awaiting_approval`。本轮可完成架构规划材料和 UI 设计派发契约，但 HTML 原型与审批门禁仍需主会话派发 UI 设计员完成。