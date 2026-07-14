# PRD

## 目标与用户价值

让用户看到精确且直观的 token 用量，在不再暴露 cache-write 用量的同时保持历史费用可审计；对无价格模型，用户可以安全地手工补价或基于有来源的智能建议补价，使后续 SDK 调用费用进入账本。

## 范围内

- Session Usage、调用账本、聊天顶栏、单条消息用量中的 cache-write 获取/聚合/展示移除。
- 所有主要 token 数值显示“精确整数 + M 换算”，复制/tooltip 仍可获得精确值。
- Settings 新增“模型价格”页：搜索、按缺价筛选、provider/model 列表、价格来源/状态、手工编辑、智能填写、确认差异、失败与空状态。
- resolved 模型价格读取、最小 merge 保存、智能建议 API。
- 历史账本/API 兼容、迁移、权限、安全、测试与文档。

## 范围外

- 追溯重算历史账本费用。
- 自动改写历史 session JSONL 或 `usage-events/v1`。
- 无用户确认的自动保存、定时自动更新价格。
- 任意用户 URL 抓取、通用浏览器代理、凭据化付费搜索。
- 汇率、多币种、税费、provider 套餐额度推算。
- 删除 Pi 模型价格 schema 中的 `cacheWrite` 价格字段；该字段由 SDK 兼容需要保留但本页默认不展示。

## 功能需求与验收标准

### FR-1 Cache-write 停止采集与展示

- 新账本事件不从 SDK 复制 `cacheWrite`、`cacheWrite1h` 和 `cost.cacheWrite`，兼容字段为 0/省略。
- legacy Usage 聚合不累加 session 中的 cache-write token。
- Usage 页面、Provider/Model 表格、Token 拆分、tooltip、顶栏与消息尾注不出现 Cache Write / Cache W / Cache R/W。
- Cache Read 保留；缓存命中率仍为 `cacheRead / (input + cacheRead)`。
- 历史事件文件不改写，session JSONL 不迁移。
- `cost.total` 保持 SDK 原值；UI 明确它是记录时费用，不因当前价格配置追溯变化。

### FR-2 精确 token 与 M 换算

- 所有 Usage 主 token 数显示完整整数千分位，例如 `1,234,567 tokens`。
- 同区域显示派生值，例如 `1.234567 M`；不得用整数 M 替代精确值。
- M 使用 `tokens / 1_000_000`，最多 6 位小数、去除无意义尾零；0 显示 `0 M`。
- 图表轴/紧凑芯片可显示 M，但 tooltip/辅助文本必须给出完整整数。
- 不使用浮点结果作为存储值或后续聚合输入。

### FR-3 模型价格配置

- 页面列出当前 Model Registry 可见模型，至少展示 provider、model id、价格状态、来源、input/output/cache-read 的 USD/1M 价格。
- “缺价”定义为 resolved cost 的 input/output 全为 0 且没有明确的用户 zero-price 标记；合法免费模型必须可显式标记 `free`，避免反复告警。
- 手填接受有限非负十进制，区分空值与 0；禁止 NaN、Infinity、负数和过大值。
- 保存前显示 resolved 旧值、建议/编辑后新值、写入位置和影响范围。
- 保存内置/扩展模型时写 `modelOverrides[model].cost`；保存自定义模型时更新对应 `models[]` 条目；不得覆盖 provider 的 auth、baseUrl、headers、compat、tiers 等无关字段。
- 保存成功后重新读取 registry 并显示实际生效值；未知模型、并发修改、解析失败不写文件。

### FR-4 智能填写

- 用户可对一个模型或缺价模型批次请求建议；批次有数量上限。
- 建议结果逐字段包含值、币种/单位、source URL、source title、fetchedAt、match method、confidence 和 warning。
- 固定来源抓取器优先；AI 只处理已抓取的有限文本/JSON和模型身份，不拥有文件写权限，不接触 API key。
- 低置信度、provider 路由不一致、tier/缓存规则复杂、来源冲突时不得默认勾选应用。
- 用户可逐项编辑/取消，并通过显式确认保存；关闭弹窗或请求失败不改变配置。
- 无结果时保留手填入口并说明失败原因，不编造 0 价格。

### FR-5 安全与运维

- 所有 API 仅操作 `getAgentDir()/models.json` 固定路径，无自定义路径参数。
- 抓取仅 HTTPS 固定 allowlist，限制重定向、响应大小、MIME、超时和并发；错误不返回绝对路径或远端原始页面。
- 响应不返回 `apiKey`、headers secret、auth/account 数据；价格列表 API 只返回 allowlist 字段。
- 写入采用原子 rename、最佳努力 `0600`、revision/ETag 比较，冲突返回 409。
- 智能建议 API 限流/单飞、`Cache-Control: no-store`；日志不记录凭据、完整远端正文或用户配置。

## 非功能要求

- 单页 500 个模型仍可搜索/筛选，无明显输入延迟。
- 键盘可操作、焦点恢复、错误关联到字段；移动端支持单列编辑和底部确认。
- AI/网络失败不影响手工配置、模型选择或聊天。
- 账本与 Usage API 的兼容字段变更必须写入文档和 coverage note。

## 未决问题

见 [brief.md](brief.md#阻塞项)。这些问题和 HTML 原型审批完成前不得进入实现。
