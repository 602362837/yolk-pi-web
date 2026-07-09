# prd

## 目标与背景

当前内置 `opencode-go` provider 仅支持“单 provider = 单 API Key”的配置方式：

- `components/ModelsConfig.tsx` 只有单个输入框，语义是覆盖当前 key；
- `app/api/auth/api-key/[provider]/route.ts` 只有单 key 的 `GET/POST/DELETE`；
- 运行时仍通过 `AuthStorage` / `auth.json` 读取 provider 当前有效凭证；
- 上游 pi SDK / `AuthStorage` 仍以“每个 provider 只有一条当前 credential”为基础契约。

用户现在要求为 `opencode-go` 提供“多账号 API Key 管理 + 激活切换”能力，并明确提出 **`apiKey` 需要回显**。因此本任务不只是后端多存几条 key，而是要同时完成：

1. 账号模型设计（账号 = 一条 API Key 记录）；
2. 设置页管理体验设计；
3. 激活后与当前运行时认证链路兼容；
4. 旧单 key 配置兼容迁移；
5. 明文回显的产品定义与安全边界。

## 范围内

- `opencode-go` 的多 API Key 账号模型；
- `ModelsConfig` 中 `opencode-go` 的列表管理、激活、查看、复制、编辑、删除体验；
- `app/api/auth/api-key/[provider]` 的兼容演进；
- 新增 `opencode-go` 多账号管理接口的设计；
- 运行时如何继续通过当前 active key 工作，且尽量不改上游 SDK；
- 旧 `auth.json` 单 key 用户的兼容与迁移策略；
- `apiKey` 回显、复制、接口返回、缓存与日志边界的定义。

## 范围外

- 本轮不实现代码；
- 本轮不改造 OAuth 账号体系；
- 本轮不修改上游 pi SDK / `AuthStorage` 的一 provider 一 credential 基础契约；
- 本轮不把多账号 UI 扩展到所有 API-key provider；
- 不改自定义 `models.json` provider 的 `apiKey` 语义；
- 不提供云端同步、团队共享、权限审计、服务端加密托管等更重的账号系统能力。

## 需求与验收标准

### R1. `opencode-go` 账号模型 = 一条可保存的 API Key 记录

系统需允许用户为 `opencode-go` 保存多条 API Key 记录；每条记录至少包含：

- `accountId`：稳定 id；
- `displayName`：显示名；
- `description`：描述/备注，可空；
- `maskedKeyPreview`：脱敏预览；
- `createdAt` / `updatedAt`；
- `lastActivatedAt`；
- `active`；
- `importedFromLegacyAt?`：是否由旧单 key 导入；
- 内部去重字段 `keyFingerprint`（不用于展示）。

验收：

- 用户可保存多条 `opencode-go` key 记录；
- 列表中能看到显示名、描述、脱敏 key、active 状态；
- 不要求显示名唯一，但每条记录必须有稳定 id 和明确的 active 状态。

### R2. 激活语义：同一 provider 同时最多一个 active；有记录时默认保持一个 active

产品规则建议定为：

- 同一 provider 任一时刻最多只有一个 active key；
- 首次保存的 key 自动成为 active；
- 激活某条记录后，运行时实际生效 credential 必须切到这条 key；
- 删除 active 记录且仍有其他记录时，系统自动激活最近使用/最近激活的一条剩余记录；
- 删除最后一条记录后，provider 进入未配置状态。

验收：

- 任意时刻不会出现两个 active；
- 激活切换后，`reloadRpcAuthState()` 链路被触发，后续请求读取新 active key；
- 删除 active 记录时不会留下“列表里还有账号但运行时完全悬空”的不确定状态。

### R3. `apiKey` 回显的产品定义

为满足“`apiKey` 需要回显”，本任务定义如下：

1. **默认展示**：账号列表和详情默认只显示脱敏预览，不自动返回全部明文；
2. **主动 reveal**：用户必须对某一条记录显式点击“显示 API Key”，前端才可获取该条记录的明文；
3. **单条 reveal**：接口只允许按账号 id 获取单条明文，不允许列表批量返回明文；
4. **复制**：允许显式复制，但复制必须是单独用户动作；
5. **接口策略**：列表接口、provider summary、provider list、日志与错误文本都不得返回明文；只有专用 reveal 接口可返回明文；
6. **前端策略**：明文只保存在当前设置弹窗内的瞬时状态，不写 URL / localStorage / query / analytics，不进 console，不拼到 toast 文案。

验收：

- `/api/auth/all-providers`、`/api/auth/api-key/[provider]`、账号列表接口均不返回明文；
- 只有用户点某条记录的 reveal/copy 动作时，浏览器才收到该条明文；
- reveal 响应与复制链路带 `Cache-Control: no-store`，且错误信息不包含 key；
- 设置弹窗关闭、provider 切换、刷新后不保留已 reveal 明文。

### R4. 旧单 key 配置兼容与迁移

旧用户当前只在 `auth.json` 中有：

```json
{
  "opencode-go": { "type": "api_key", "key": "..." }
}
```

兼容策略建议为：

- 新增“多账号存储”后，**仍保留 `auth.json` 中的当前 active key 作为运行时镜像**；
- 当用户首次访问 `opencode-go` 多账号管理接口时，系统做一次 **read-through、幂等导入**：
  - 若多账号存储中还没有对应记录，则把旧 key 导入为一条账号；
  - 默认显示名可为“Imported key”或“已导入旧 key”；
  - 导入后该记录为 active；
  - `auth.json` 中现有 active key 不删除；
- 之后所有激活切换都更新多账号存储的 `activeAccountId`，同时把 active key 镜像回 `auth.json`。

验收：

- 旧单 key 用户升级后立即可用，无需手工迁移；
- 首次打开管理页时，旧 key 能以正常账号记录形态出现；
- 回滚到旧版本时，旧版本仍能继续读取 `auth.json` 中当前 active key 工作；
- 不因引入多账号而破坏现有 `AuthStorage` / SDK 读取逻辑。

### R5. `ModelsConfig` 中的 `opencode-go` 管理体验

仅 `opencode-go` 在 v1 进入“多账号管理”模式，其它 API-key providers 保持现状单输入框。

`ModelsConfig` 中 `opencode-go` 需提供：

- 账号列表；
- active 标识；
- 添加账号；
- 编辑显示名 / 描述 / 替换 key；
- reveal / hide；
- copy；
- activate；
- delete；
- 旧单 key 已导入提示；
- 空状态、错误状态、加载状态。

验收：

- 只改 `opencode-go` 的设置页体验，其它 API-key provider 不回归；
- 用户能在单个弹窗内完成“新增 / 激活 / 查看 / 复制 / 编辑 / 删除”；
- 空状态、legacy 导入状态、删除 active 状态都有明确交互。

### R6. `/api/auth/api-key/[provider]` 的演进与新增接口

建议采用“**保留兼容 summary 路由 + 新增多账号路由**”的方案：

- 现有 `/api/auth/api-key/[provider]` 保留为 provider summary / 兼容入口；
- `opencode-go` 新增账号管理路由族；
- 不复用现有 OAuth `auth/accounts/[provider]` 路由，避免 secret reveal / 存储语义混杂。

验收：

- 现有 provider summary 调用点仍可工作；
- 新 UI 使用新的多账号路由；
- 单 key 旧兼容逻辑与多账号新逻辑边界清晰。

### R7. 运行时继续读取当前 active key，不改上游 SDK 基本契约

推荐方案：

- 多账号存储只由 web UI / web API 自己管理；
- 当前 active key 始终镜像到 `auth.json` 的 `opencode-go` provider entry；
- 运行时继续通过 `AuthStorage` / `ModelRegistry` / 现有 provider auth 读取 active key；
- 激活切换时调用 `reloadRpcAuthState()`，让现有 live wrapper 尽快切到新 credential。

验收：

- 不需要修改上游 `AuthStorage` 的“一 provider 一 credential”结构；
- 切换 active key 后，不需要重写 provider 实现即可生效；
- 新旧版本都只依赖 `auth.json` 中的当前 active key 工作。

### R8. `opencode-go` 与 `opencode` 账号池独立

尽管二者上游都使用 `OPENCODE_API_KEY` 环境变量，v1 仍建议：

- 多账号池按 provider id 独立；
- `opencode-go` 的账号管理不影响 `opencode`；
- 同一明文 key 如需给两个 provider 用，由用户分别保存；
- 后续若要抽象成跨 provider 共用 key 池，另开任务评估。

验收：

- `opencode-go` 的激活切换只更新 `auth.json` 中 `opencode-go` 条目；
- `opencode` 当前行为不变化。

## 未决问题 / 待主会话审批

1. 是否接受“删除当前 active 且还有剩余账号时，自动切换到最近使用账号”的推荐语义；
2. 是否接受 v1 的产品范围仅对 `opencode-go` 开放多账号 UI，但底层服务层做可复用抽象；
3. 是否接受 `apiKey` 的回显定义为“默认脱敏 + 主动 reveal + 单条明文接口 + 显式 copy”，而不是页面加载即全部明文回显；
4. 由于本任务触发 UI 原型门禁，进入实现前仍必须补齐 UI 设计员的 **HTML 原型** 与用户审批。