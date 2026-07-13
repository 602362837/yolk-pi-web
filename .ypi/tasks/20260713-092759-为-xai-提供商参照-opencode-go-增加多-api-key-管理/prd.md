# PRD：xAI 多 API Key 管理

## 目标与用户价值

拥有多个 xAI API Key 的用户可以在 Settings → Models 中统一保存和切换，不再反复覆盖单个 Key；现有单 Key 用户首次进入时无损升级。

## 范围内需求与验收标准

1. **进入 managed 模式**：provider id 为 `xai` 时，provider summary 返回 `authMode: "managed_accounts"`，Models 页面显示现有多账号管理 UI，而非单 Key 表单。
2. **legacy 无损导入**：若 `auth.json` 已有 xAI API Key，首次列账号时创建一个 `Imported key`；重复读取不重复创建，导入项保持 active。
3. **账号管理**：可新增（名称、描述、Key、可选立即激活）、编辑、逐个删除、启用/禁用、激活、单项 reveal/copy；列表和普通响应不含明文。
4. **运行时生效**：激活或更新 active xAI Key 后镜像到 `auth.json`，调用现有 auth reload，后续请求使用新 Key。
5. **安全删除**：删除 active 项时使用现有最近使用项回退；删除最后一项断开 xAI。旧 provider DELETE 在已有 managed accounts 时返回 409。
6. **隔离性**：xAI 数据仅写入 `auth-api-key-accounts/xai/`，不得影响 `opencode-go` 或其他 provider。
7. **兼容性**：非 allowlist provider 保持 single 模式；现有 opencode-go 行为不变。
8. **文档**：API、frontend、library 文档准确列出 `opencode-go` 与 `xai`；运维文档注明 xAI 存储位置和无自动 failover。

## UI 状态

复用现有 loading/empty/error/account-list/add/edit/disable/delete/reveal 状态，只将同一交互暴露给 xAI。显示 provider 名称应来自 registry（xAI），不得硬编码 OpenCode Go 文案。

## 范围外

- xAI 自动 failover、余额或额度探测。
- 批量导入、Key 标签新字段、跨 provider 复制。
- 修改 upstream SDK credential schema。

## 未决问题

- **审批项**：是否确认本轮不包含 xAI auto-failover（推荐确认“不包含”）。
- HTML 原型需经用户审批后才能进入实现。
