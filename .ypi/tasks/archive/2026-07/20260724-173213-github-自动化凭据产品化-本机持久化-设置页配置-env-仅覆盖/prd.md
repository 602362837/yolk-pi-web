# PRD：GitHub 自动化凭据产品化

## 目标与背景

让所有本机安装 `ypi` 的用户都能在 **设置 → GitHub 自动化** 完成一次 GitHub App 凭据配置，正常启动或重启 `ypi` 后继续可用，不再要求每次 `export`。环境变量保留为 CI、容器和专业部署的高级覆盖层。

## 产品原则

1. 本机优先可用：安全不能等价于拒绝用户在产品内配置。
2. secret 可写不可读：允许明确提交/轮换，不提供回显、reveal、复制或下载。
3. 默认持久，env 覆盖：本机存储是默认产品路径，env 是可选高级控制。
4. 来源透明：只显示“env / 本机 / 未配置”，不显示值、路径或指纹。
5. 域隔离：GitHub App 凭据不进入 Links、LLM auth、Session、Task 或非 secret config。

## 范围内 / 范围外

详见 [brief.md](brief.md)。本 PRD 不改变 GitHub App 创建/安装、公网 HTTPS、allowlist、机器 Assignee、Triage 与无人值守策略；只产品化 App 身份材料的本机配置、解析和指引。

## 用户故事

- 作为本机用户，我可以在设置页填写 App ID、Webhook secret，并粘贴或选择私钥 PEM，一次保存后重启仍可用。
- 作为已配置用户，我看到的是“已配置”和来源，不会看到历史 secret 或 PEM。
- 作为轮换密钥的用户，我可以只提交变更字段；空白字段不会清空已有本机值。
- 作为 CI/容器运维，我可以继续使用 env 覆盖任一字段，并看到该字段当前由 env 接管。
- 作为排障人员，我可以运行验证，知道缺失/损坏/覆盖来源和下一步，但拿不到 secret/path。
- 作为不再使用自动化的用户，我可以确认移除本机凭据；已存在的 env 不会被产品修改。

## 功能需求与验收标准

### R1 — 本机凭据存储

服务端在 `<getAgentDir()>/github-automation/` 持久化 schema v1 本机凭据：`credentials.v1.json` 与 metadata 指向的 `private-key.<generation>.pem`。generation key 先落盘，metadata 再原子切换，避免固定双文件轮换的中间态。

**验收：**
- 目录为 `0700`、文件为 `0600`（平台支持时强断言，否则 best effort）。
- 使用同目录临时文件、fsync、rename；写入受进程队列和跨进程 mkdir 锁保护。
- 文件不位于项目工作区，不进入 git。
- metadata 与 PEM 指纹不一致、JSON 损坏或未知 schema 时 fail closed，写入不会把损坏文件覆盖成空配置。

### R2 — 运行时解析优先级

App ID、私钥、Webhook secret、可选 App slug 按字段解析：非空 env → 本机值 → missing。

**验收：**
- 无 env 时完整本机 bundle 可加载、签 JWT、验 Webhook。
- 设置单个 env 只覆盖对应字段；其他字段继续使用本机值。
- env 为空白视为未设置。
- 移除 env 后无需迁移即可回落本机值。
- 既有 env-only 部署保持兼容。

### R3 — 凭据安全投影

所有浏览器可见响应只返回状态，不返回秘密。

**验收：**
- 至少包含：`configured`、`readiness`、`hasAppId`、`hasPrivateKey`/兼容 `hasPrivateKeyFile`、`hasWebhookSecret`、`localConfigured`、安全来源枚举、`checkedAt/updatedAt`。
- 不包含 App ID 原值、Webhook secret、PEM、绝对路径、私钥指纹、JWT、installation token。
- status 与 verify 继续使用同一有效凭据投影；没有第二套相互矛盾的 readiness。

### R4 — 独立凭据 API

新增 `/api/github-automation/credentials`，与非 secret `/config` 分离。

**验收：**
- `GET` 返回 no-store safe projection。
- `PUT` 接受 multipart：App ID、Webhook secret、私钥文件或 PEM 粘贴值；私钥文件与粘贴值同时提交时拒绝歧义。
- `DELETE` 只删除本机凭据，并要求 UI 确认；不修改 env、allowlist、jobs 或 GitHub 远端 App。
- body/字段/文件数/尺寸均有固定上限和 allowlist；未知字段、secret 放入 query、任意服务端 path 均拒绝。
- 错误只用稳定码和固定安全文案；响应 `Cache-Control: no-store`。

### R5 — 首次保存与轮换语义

首次本机保存必须得到完整有效 bundle；后续保存可只轮换部分字段。

**验收：**
- App ID 是合法正整数字符串；Webhook secret 非空且在大小范围；私钥可解析为 GitHub App RSA private key。
- 首次缺任一必需字段返回可恢复校验错误，不产生“半配置成功”。
- 已有本机 bundle 时，空白/未提交字段表示 preserve，不从 env 复制到本机。
- 新 private key 在写盘前完成尺寸、PEM 和 RSA 校验。
- 成功后只返回 safe projection，客户端立即清空表单中的 password/PEM/File 对象。

### R6 — 设置页主流程

`GithubAutomationConfig` 的 App 配置卡改为本机凭据表单，位置仍在 setup/status/jobs 之前。

**验收：**
- 可输入 App ID、Webhook secret（password），可在“粘贴 PEM / 选择 .pem 文件”间切换。
- 已配置字段显示“已配置”；轮换输入默认空白，不显示旧值或 masked 片段。
- 保存按钮明确“保存到本机”，busy 时禁止重复提交。
- 成功、校验失败、冲突/锁超时、存储损坏、env 覆盖、移除后的状态都有明确反馈。
- 全局 Settings Save/Reset 仍不控制此页；操作即时保存。

### R7 — env 高级覆盖 UI

环境变量从主配置方式降为折叠的“高级：环境变量覆盖”。

**验收：**
- 默认主 CTA 是本机保存，不是复制 env 名。
- 高级区仅列 env 名、覆盖规则和适用场景，不要求普通用户每次 export。
- 若某字段由 env 接管，UI 显示“环境变量覆盖”；允许更新本机 fallback，但提示当前进程仍使用 env。
- UI 不显示 env 值。

### R8 — 私钥选择与粘贴

用户可以粘贴 PEM 或通过浏览器选择本机文件上传给服务端保存。

**验收：**
- 文件选择只接受单个合理大小 `.pem`/文本文件；服务端不信任扩展名或 MIME，始终解析内容。
- File 对象不长期留存；离开页面、保存成功、删除或切换输入方式时清理。
- 已保存私钥不可下载、回显、复制或恢复到输入框。
- 页面不会接受服务端绝对路径字符串。

### R9 — 保存后的即时运行时一致性

凭据变更后后续请求使用新值。

**验收：**
- 成功保存或删除本机 bundle 后清理 installation token cache。
- Webhook secret 后续请求即时重读有效解析结果；不依赖进程重启。
- 状态/验证重新读取服务端 projection，不以客户端乐观状态冒充成功。

### R10 — Setup checklist 与 verify

checklist 的前三项改为设置页动作，verify 仍是只读验证。

**验收：**
- 缺 App ID / 私钥 / Webhook secret 时 next step 引导“在上方本机凭据卡配置”；若对应字段是 env source，可说明高级覆盖。
- 私钥 invalid/unreadable/local bundle inconsistent 给稳定原因和可执行下一步。
- verify 仍不接收凭据 body、不写盘、不 enqueue、不唤醒 scheduler、不产生 GitHub mutation。
- verify 返回中无 secret/path。

### R11 — Webhook 验签

本机保存的 Webhook secret 必须进入现有验签链路。

**验收：**
- 用本机 secret 生成的合法 `X-Hub-Signature-256` 通过；错误 secret 返回 401。
- env secret 存在时只认 env；本机 secret 不绕过覆盖。
- raw body、signature、secret 不被持久化或记录。

### R12 — GitHub App JWT / installation 行为

本机 App ID + PEM 必须进入既有 GitHub App JWT 和 installation token 流程。

**验收：**
- JWT `iss` 使用有效解析后的 App ID，签名可由对应公钥验证。
- 保存不同 App/key 后旧 installation token cache 不再命中。
- env-only 旧测试与运行路径继续通过。

### R13 — 删除本机凭据

设置页提供危险操作“移除本机凭据”。

**验收：**
- AppPrompt 明确：只删除本机 fallback，不删除 GitHub App/安装/仓库/jobs，也不修改 env。
- 删除在锁内执行，两个文件均处理；中间失败不报告成功。
- env 仍完整时 effective status 保持 configured，并显示 env source；无 env 时变为未配置。

### R14 — 文档主路径切换

客户指南、架构、API、前端、库、部署、排障文档同步。

**验收：**
- 默认步骤是 Settings → GitHub 自动化 → 本机凭据 → 安装/仓库/verify。
- env 被标为高级覆盖（CI/容器/专业部署），不是唯一入口。
- 文档写明数据路径、0700/0600、env 优先级、无 reveal、删除/轮换、备份风险。
- 不再出现“设置页故意不接受密钥是正常设计”的陈旧结论。

### R15 — 隐私与非注入

本机持久 secret 继续受 P1 非注入边界保护。

**验收：**
- App secret/PEM/JWT/installation token 不进入 agent prompt、child env、Task、Session、jobs/events、API/DOM/log。
- 现有 unattended env scrub 继续移除 `YPI_GITHUB_APP_*`；本机 secret 也不会被主动注入。
- sentinel 扫描覆盖凭据文件之外的所有测试捕获面。

### R16 — 并发与恢复

多标签页/多进程保存不能损坏本机 bundle。

**验收：**
- 同进程队列 + 跨进程锁串行化写/删。
- 锁超时返回固定安全错误；不删除活跃新锁。
- 残留 tmp/未引用 generation key 不参与读取并在锁内 best-effort 清理；未来 schema/损坏 metadata fail closed。
- 注入 rename/fsync/metadata-write 失败时不出现假成功；可保留可诊断但不投影路径的安全错误。

### R17 — UI 可访问与响应式

**验收：**
- label 与 input 正确关联；password/textarea 有 autocomplete 与安全提示。
- 文件选择、粘贴方式、保存、删除、验证均可键盘操作；focus visible。
- 状态不只靠颜色；busy 使用 `aria-busy`；结果使用适度 live region。
- ≤640px 单列；长 env 名/错误码不横向溢出；dark/light/reduced-motion 可用。

## 状态矩阵

| 状态 | 页面行为 |
| --- | --- |
| 全未配置 | 展示完整本机表单，保存要求三项齐全 |
| 本机完整 | 三项显示已配置，轮换输入为空；可验证/移除 |
| 本机损坏/不一致 | fail closed，提示重新提交完整 bundle；不回显损坏内容 |
| env 完整 | configured；每项显示环境变量覆盖；本机表单仍可维护 fallback |
| env 部分 + local 补齐 | configured；逐字段展示来源，并提示属于同一 App |
| env 部分且 local 缺失 | 未配置；指出具体 missing 字段 |
| 保存中 | 表单 busy、禁止重复保存/删除 |
| 保存失败 | 输入保留以便修正（secret 不进入 toast），服务端状态不乐观更新 |
| 保存成功 | 清空 secret/PEM/File，刷新 safe projection 和 checklist |
| 删除本机但 env 完整 | 仍 configured；显示由 env 提供 |
| 删除本机且无 env | 未配置；Triage/无人值守门禁保持 fail closed |

## 未决问题

产品范围已足够稳定，没有阻塞实现的产品决策。仍有一个流程阻塞：本任务触发 UI 原型门禁，但当前委派环境没有 `ypi_studio_subagent` / `subagent` 工具，无法真实派发 `ui-designer`。架构师可提供 HTML 草案，但必须由主会话派 UI 设计员审阅/替换并取得用户批准，之后才能进入 implementing。
