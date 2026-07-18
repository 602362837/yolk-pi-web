# PRD：自定义 OpenAI 兼容 provider 从 `/models` 同步模型

## 目标与用户价值

用户维护 OpenAI-compatible 网关、本地推理服务或私有代理时，不再需要逐个复制模型 id。系统从已保存 provider 的标准模型目录端点读取列表，先展示安全预览，再按用户选择 merge 到 `models.json`。

核心价值：

- 降低手工录入模型 id 的成本和拼写错误；
- 明确区分“远端发现”与“本地模型能力/价格配置”，避免自动猜测；
- 用 merge、revision 和确认流程保护已有配置；
- 将网络访问限制在用户已经保存的 custom provider，避免任意 URL 探测能力。

## 目标用户与主路径

### 主路径 A：选择性同步

1. 用户在 Models 中选择一个已保存的 custom OpenAI-compatible provider。
2. 点击“从端点同步模型”。
3. 系统读取远端列表并展示预览。
4. 用户搜索、勾选若干“新增”模型；已存在模型可见但不可重复选择。
5. 用户点击“写入所选”，查看本次将新增的数量和“不覆盖已有配置”说明。
6. 用户确认后，系统 merge 写入并展示新增/跳过结果。

### 主路径 B：快捷同步全部新增项

1. 用户进入预览后看到新增数量。
2. 点击“全部新增并写入”。
3. 系统明确提示将新增 N 项，不删除、不覆盖已有模型。
4. 用户确认后一次写入全部新增项并看到结果反馈。

## 范围内

### Provider 资格

仅当全部满足时允许同步：

- provider 存在于已保存的 `models.json.providers`；
- provider id 不属于 Pi built-in provider；
- provider id 不属于固定扩展（至少 `grok-cli`、`kiro`、`google-antigravity`）；
- provider 级 `api` 明确为 `openai-completions` 或 `openai-responses`；
- provider 有可解析的 `http:` 或 `https:` `baseUrl`；
- Models 当前没有未保存草稿，避免同步写入后又被旧草稿整文件覆盖。

### 远端发现

- 服务端仅接收 provider id，不接收 URL、headers、apiKey 或任意请求参数。
- 从已保存 provider 配置解析 baseUrl、凭据和自定义 headers。
- 支持 `/models` 与 `/v1/models` 路径策略。
- 只接受有界 OpenAI 列表响应，提取模型 id；远端其他字段仅可作为有界预览信息，不直接持久化。
- 提供超时、大小、重定向、响应格式和错误分类保护。

### 预览与写入

- 预览可搜索、全选新增、清空选择、逐项勾选。
- 标识“新增”与“已存在”。
- 写入使用预览 token + revision，防止过期预览和配置竞争。
- merge 只向目标 provider 的 `models[]` 追加不存在的 `{ id }`。
- 已存在模型对象原样保留；不更新其 name/cost/reasoning/input/contextWindow/maxTokens/compat/api 等字段。
- 保留 provider 的 `modelOverrides`、headers、compat、apiKey、baseUrl 和未知手工字段。
- 不删除远端已经下线但本地仍存在的模型。

## 范围外

- 不同步或覆盖 Pi SDK built-in model catalog。
- 不同步 Grok、Kiro、Antigravity 或其他固定扩展目录。
- 不支持 Anthropic Messages、Google Generative AI 或其他非 OpenAI 协议。
- 不从远端推断价格、免费状态、上下文窗口、最大输出、reasoning、thinking level、图像输入、compat 或 model override。
- 不做后台定时同步、启动时自动同步或静默写入。
- 不接受自定义发现 URL、路径、请求体或临时 headers。
- 不删除本地模型，不做“双向镜像”。
- 不改变 `settings.json` 默认模型和当前 Session 的已选模型。

## 功能需求与验收标准

### FR-1：同步入口资格

**需求**：目标 custom OpenAI provider 显示同步入口；非目标 provider 不提供可执行入口或明确禁用。

**验收**：

- `openai-completions`、`openai-responses` custom provider 可进入同步。
- `anthropic-messages`、`google-generative-ai` custom provider 显示协议不支持或不显示入口。
- Pi built-in id、`grok-cli`、`kiro`、`google-antigravity` 即使在 `models.json` 有 override 也不能同步。
- 未保存 provider、未保存 API/baseUrl 变更或整个 Models 有 dirty draft 时，入口禁用并提示先保存。

### FR-2：端点预览

**需求**：点击同步后显示远端模型预览。

**验收**：

- 用户已把 `/v1` 写入 baseUrl 时，请求精确落到 `/v1/models`，不产生 `/v1/v1/models`。
- baseUrl 未带 `/v1` 时，先尝试 `<base>/models`，仅在 404/405 时尝试同源 `<base>/v1/models`。
- baseUrl 已是 `/models` 或 `/v1/models` 时不重复追加。
- 预览至少展示远端总数、新增数、已存在数、模型 id、状态和搜索。
- 重复远端 id 被去重，顺序以首次出现为准。

### FR-3：选择与快捷操作

**需求**：用户可选择部分新增项，或一次选择全部新增项并写入。

**验收**：

- 新增项可勾选；已存在项不可重复写入。
- 默认选择全部新增项，但用户可清空或调整。
- “写入所选”在 0 项时禁用。
- “全部新增并写入”触发明确确认，确认文案说明新增数量和 merge 语义。
- 取消确认不发生任何磁盘写入。

### FR-4：安全 merge

**需求**：确认后只 merge 目标 provider。

**验收**：

- 新模型以 `{ id }` 追加到 `providers.<id>.models[]`。
- 本地已有同 id 对象逐字段保持不变，包括 cost 和任意未知手工字段。
- provider 的 `modelOverrides` 和其他字段不变。
- 其他 provider 不变。
- 已存在项返回为 skipped，不重复追加。
- 写入使用原子替换、备份与写后 ModelRuntime 验证；验证失败回滚。
- revision 不一致或 preview 过期时返回冲突，要求重新预览，不盲写。

### FR-5：安全与隐私

**需求**：同步不成为任意网络探测或 secret 投影接口。

**验收**：

- 请求 body 中出现 URL/baseUrl/headers/apiKey 等字段时拒绝。
- 服务端只从当前 agent dir 的已保存 provider 读取目标。
- API 响应、错误、日志不包含 apiKey、Authorization、自定义 header 值或原始远端错误 body。
- 重定向只允许有限次数的同源跳转；跨源跳转拒绝，避免凭据泄漏。
- 请求有固定超时和响应体大小上限。
- 401/403、404/405、429、5xx、timeout、network、invalid JSON/schema、too large、unsupported provider、stale revision 使用稳定安全错误码。
- UI 对可恢复失败提供“重试”。

### FR-6：结果和后续可用性

**需求**：写入后用户立即看到结果和更新后的模型树。

**验收**：

- 成功反馈包含新增数、跳过数和“不覆盖已有配置”的结果摘要。
- ModelsConfig 重新读取最新配置和 revision，避免后续 Save 覆盖同步结果。
- `/api/models` 可看到新增模型；如 live runtime reload 部分失败，写入仍保持成功并返回非敏感 warning，用户可重新打开/刷新。

## 非功能需求

- 预览最大模型数、id 长度、响应字节数和 preview cache 数量均有固定上限。
- API 响应设置 `Cache-Control: no-store`。
- 同一 provider 并发预览可共享或隔离，但 apply 必须由 models.json 写锁串行化。
- 新增纯函数需有针对性测试：资格判定、URL 拼接、响应解析、merge 保留、revision 冲突。
- 交互支持键盘、焦点管理、Escape、窄屏和 loading/error/empty/success 状态。

## 未决问题

产品范围和主交互已由用户确认，没有待猜测的产品决策。

流程未决项只有：主会话必须真实派发 UI 设计员产出 HTML 原型，并在用户审批后才能进入 implementing。