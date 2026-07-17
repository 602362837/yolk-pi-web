# 计划审批书：pi SDK 0.80.10 / Auth / ModelRuntime 迁移

> **审批状态：等待用户确认。** 本计划批准前不得进入 implementing、claim 子任务或指派实现员。

## 一、审批结论摘要

建议批准一次性将以下三项 exact pin 从 `0.80.7` 升级到 **`0.80.10`**：

- `@earendil-works/pi-coding-agent`
- `@earendil-works/pi-ai`
- `@earendil-works/pi-agent-core`

升级必须与完整 adapter 迁移同批完成，不能只改版本。核心方案是：

1. 新增 Web 自管、实现 pi-ai 公共 `CredentialStore` 的 `auth.json` store；
2. 统一 provider-aware `ModelRuntime` / AgentSession services factory；
3. 全量迁移 Chat、Studio child、Auth、Models、账号、quota/failover、model-price 与 assist 调用面；
4. 保留现有多账号池 + 一 provider 一 Active credential镜像；
5. 更新 provider/race/account测试、两个锁文件和项目文档；
6. 自动检查与人工UAT通过后才进入用户验收。

关联产物：

- [Brief / 证据与边界](brief.md)
- [PRD / 需求与验收标准](prd.md)
- [UI 门禁结论](ui.md)
- [Design / 技术方案、数据流与风险](design.md)
- [Implement / 子任务表与 schemaVersion 2 DAG](implement.md)
- [Checks / 自动验证与 UAT 矩阵](checks.md)

## 二、为什么必须做完整迁移

0.80.8 已移除 coding-agent root 的公开 `AuthStorage`，把 SDK options/services/session 从 `authStorage + modelRegistry` 改为 `modelRuntime`；`ModelRegistry.create()` 与 `modelRegistry.authStorage` 不再存在，`refresh()` 也变为异步。当前仓库在 Auth routes、多账号 Active mirror、quota、main Chat、Studio child、Models/model-price/assist和多组测试中仍使用旧契约。

因此下列做法均不可接受：

- 只修改 package version；
- deep-import SDK 私有 `core/auth-storage`；
- 半升级到 0.80.8/0.80.9；
- 继续把临时/全局 bootstrap 当成另一个 ModelRuntime 的 provider注册保证。

本地发布物、CHANGELOG和第三方包源码已复核。Grok/Kiro/Antigravity当前版本peer覆盖0.80.x，公开扩展均走 `pi.registerProvider(...)`，但Web adapter仍必须迁移。

## 三、PRD 范围

### 范围内

- 三核心包 exact `0.80.10` 与 lock/shrinkwrap同步。
- file-backed Web CredentialStore：`read/list/modify/delete`、全文件锁、CAS、原子写、权限、config-value兼容。
- provider-aware ModelRuntime：fixed providers注入目标runtime；main/Studio runtime隔离。
- main Chat与历史续聊、模型切换、async live auth reload。
- OAuth登录/add/Activate/logout/provider status；single/managed API-key账号。
- OpenAI/Grok/Kiro/Antigravity quota/failover/token refresh、DeepSeek balance。
- Models、models-config test、model prices、Terminal/Trellis/price assist。
- provider/account/race/Studio测试与 integrations/architecture/modules/troubleshooting文档。

### 非目标

- 不改Models/Auth页面、交互、文案或审批体验。
- 不升级第三方provider版本。
- 不新增账号schema、failover策略、quota口径或xAI自动切号。
- 不手工恢复上游删除模型，不重写Session/account/usage历史数据。
- 不发布、不commit/push/merge。

## 四、关键设计决策

### 1. auth.json 继续作为 Active 单一镜像

Web CredentialStore仍读写原 `auth.json`，账号池仍在 `auth-accounts/**` / `auth-api-key-accounts/**`。每个provider只有一个当前credential镜像；账号历史、metadata和secret文件不迁移。

锁是**auth文件级**而非provider级：进程内队列 + `<authPath>.lock`独占mkdir，锁内reread整文件，same-dir temp + atomic rename，目录0700/文件0600。Malformed JSON或锁/写失败fail-closed，不以 `{}` 覆盖原文件。

### 2. API-key兼容不能缩减

store `read()`继续支持literal、`$ENV`/`${ENV}`、`$$`、`$!`和leading `!command`；`list()`不执行命令、不返回secret。OAuth credential的provider附加字段完整保留。

### 3. provider注册属于目标ModelRuntime

新增 `createWebModelRuntime()` / `getWebModelRuntime()` 与 canonical services helper：

- main Chat、Studio child每个services/session使用隔离runtime，避免cwd-local extension provider跨会话泄漏；
- 仅fixed-provider管理runtime可按agentDir/modelsPath键控复用；
- temp modelsPath永不缓存；
- Grok → Kiro → Antigravity始终先于caller extras注册到实际调用runtime。

### 4. live reload变为可等待的异步操作

`reloadRpcAuthState(): Promise<number>` 对所有live wrapper执行offline runtime refresh，按相同provider/id替换descriptor，不调用`setModel()`、不写model_change/settings默认；调用方await完成后再返回成功，最后清理provider session resources。

### 5. canonical auth/request路径

登录/登出用 `ModelRuntime.login/logout`；status用providers/checkAuth；请求用 `getAuth(model|provider)` 或runtime `completeSimple/streamSimple`。应用业务代码最终不使用`AuthStorage`、`ModelRegistry.create()`或旧services字段。

## 五、实施 DAG

完整机器计划见 [implement.md](implement.md)，`schemaVersion: 2`，`maxConcurrency: 3`：

| ID | 内容 | 依赖 |
|---|---|---|
| SDK-01 | 版本、CredentialStore、ModelRuntime/services foundation | — |
| SDK-02 | Auth/账号/Active mirror/quota/balance | SDK-01 |
| SDK-03 | main Chat/live reload/Studio child | SDK-01 |
| SDK-04 | Models/model-price/config-test/assist | SDK-01 |
| SDK-05 | provider/account/race/runtime测试迁移 | SDK-02/03/04 |
| SDK-06 | 文档、锁树、陈旧契约审计 | SDK-02/03/04 |
| SDK-07 | lint/tsc/focused suites/API smoke/UAT | SDK-05/06 |

SDK-02/03/04可并行，SDK-05/06可并行；SDK-01与SDK-07是串行硬门禁。共享文件冲突由主实现员协调，`dependsOn` 是唯一调度依据。

## 六、验证矩阵

### 自动门禁

- `npm run lint`
- `node_modules/.bin/tsc --noEmit`
- 新增CredentialStore并发/权限/损坏/config-value测试
- API-key/OAuth account suites
- Grok/Kiro/Antigravity provider、account、cold-auth、race、quota、failover suites
- model-price、session-model-pin、Studio SDK runner suites
- 静态审计：运行代码无 `AuthStorage`、`ModelRegistry.create`、`services.authStorage/services.modelRegistry/inner.modelRegistry`
- `npm ls`确认核心包解析与第三方peer树

### 人工UAT

- 新Chat、历史0.80.7 Session续聊、session-scoped模型切换；
- OpenAI/Grok/Kiro/Antigravity登录、add、Activate、logout与live session下一请求；
- OpenCode Go/xAI managed keys和普通single key；
- quota/failover安全投影；
- Models列表、models config test、价格读取/写后验证、assist routes；
- Studio SDK child策略模型、独立request affinity与audit session。

详见 [checks.md](checks.md)。真实OAuth/UAT若因无账号无法执行，必须作为残余风险报告，不能用字符串测试代替。

## 七、风险与缓解

| 主要风险 | 缓解 |
|---|---|
| 并发写auth.json丢其他provider | auth文件级跨进程锁、锁内reread、不同provider并发测试 |
| 自管store破坏command/env key | 完整config-value兼容测试；list不解析secret |
| fixed provider注册到错误runtime | canonical target-runtime services helper与cold-path行为测试 |
| runtime全局复用导致cwd extension泄漏 | session/Studio runtime隔离；仅fixed管理runtime缓存 |
| Active reload返回过早 | reload async并全调用方await；per-wrapper失败隔离 |
| 非Active refresh覆盖Active | 保留provider lock + metadata CAS + race suites |
| 第三方provider运行时不兼容 | focused provider/race/quota测试 + API/manual provider smoke |
| 0.80.10模型目录变化 | 接受上游目录；历史不存在模型走SDK安全fallback，不改写JSONL |

## 八、UI 门禁

[ui.md](ui.md) 判定 **no UI surface change / no HTML prototype required**。本任务没有页面、交互、信息结构或审批体验改动，因此不指派UI设计员、不生成HTML原型。

如果实现发现必须改变前端交互或用户可见结构，必须停止对应子任务、退回planning并补走UI设计员HTML原型与用户审批；不得夹带实现。

## 九、回滚

- adapter代码、三项核心依赖、package-lock与shrinkwrap整体回退到0.80.7后重启。
- 禁止只降SDK或只回退部分adapter/核心包。
- 不删除、不迁移 `auth.json`、账号池、Session JSONL或usage ledger；这些格式保持兼容。
- 不需要数据回滚脚本。

## 十、请求用户决策

请确认是否按本计划实施：

- **批准**：主会话记录明确用户批准后，才可进入 implementing并按DAG指派实现员；
- **需要修改**：请指出希望调整的范围、兼容策略、验证矩阵或风险取舍，任务返回planning修订。

在明确批准前，任务停在 `awaiting_approval`。