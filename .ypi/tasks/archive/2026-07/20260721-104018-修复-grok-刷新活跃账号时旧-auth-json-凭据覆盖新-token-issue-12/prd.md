# PRD：修复 Grok 活跃账号刷新后的凭据回退

## 1. 目标与背景

Issue [#12](https://github.com/602362837/yolk-pi-web/issues/12) 已确认：Grok 活跃账号成功刷新 OAuth token 后，`listOAuthAccounts("grok-cli")` 隐式执行 `auth.json -> saved-account` 同步，可能把刷新前的旧凭据重新写回账号文件。若上游轮换或一次性使用 refresh token，下一次刷新会再次提交旧 token 并要求用户重新登录。

本任务要建立明确的一致性边界：Grok managed saved-account 是账号凭据真相，`auth.json["grok-cli"]` 是当前 Active 的派生镜像；普通列表读取不得把旧镜像反向写入真相文件。

## 2. 用户价值

- 成功刷新后不会立即回到旧 token 或错误进入重新登录状态。
- refresh token 轮换能够持续工作，而不是只成功一次。
- 刷新、账号列表读取、Activate、reauth 并发时保持合法 Active 终态。
- 不改变现有 Models、额度、failover 或登录界面。

## 3. 范围内

1. Grok token resolver 的 Active 判定、账号凭据落盘和 `auth.json` 镜像提交语义。
2. `listOAuthAccounts()` 与 `syncActiveOAuthAccountCredential()` 的职责拆分，消除普通列表读取中的 secret 反向覆盖。
3. Grok provider lock 对刷新、Activate、reauth 及显式 Active 凭据接纳路径的协调。
4. legacy `auth.json` 首次接入 managed account store 的兼容边界。
5. Active、非 Active、列表并发、Activate 交错、single-flight、轮换 refresh token 与失败恢复测试。
6. OAuth/Grok 架构和 library 文档修正。

## 4. 范围外

- UI、文案、交互、API response shape 或前端信息结构变更。
- Grok 登录/重新登录产品流程重做。
- 配额协议、自动 failover 决策、ModelRuntime live reload 语义变更。
- 账号 metadata schema、opaque storage id、Session JSONL 或历史凭据迁移。
- 自动修复在本版本前已经失效的一次性 refresh token。
- Kiro/Antigravity token 算法重构；共享列表契约调整必须做回归验证，但不借本 Issue 改写其他 provider 的刷新策略。

## 5. 需求

### R1. 权威来源

对已建立 managed Active 槽位的 Grok provider：

- `accounts.json.activeAccountId` 决定 Active 槽位。
- `<storage-id>.json` 是该槽位完整 OAuth 凭据真相。
- `auth.json["grok-cli"]` 只作为 Active 凭据镜像，不得在普通读取中覆盖已存在的槽位凭据。

### R2. 列表读取无 secret 回写

`listOAuthAccounts()` 可以清理缺失 metadata、回填安全 label 并返回摘要，但不得因读取 `auth.json` 而把 access/refresh token 写入现有账号文件。首次 legacy bootstrap 与成功 OAuth login 的凭据接纳必须是命名明确、可协调的显式操作。

### R3. Active 刷新一致性

Active 账号从 `C0` 刷新得到 `C1` 后，仅当以下条件都满足时才算刷新成功：

1. `C1` 已原子写入该账号文件；
2. 锁内复核该账号仍为 Active；
3. `auth.json["grok-cli"]` 已更新为同一 `C1`。

成功返回后两处不得残留 `C0.access` 或 `C0.refresh`。

### R4. 非 Active 隔离

非 Active 账号刷新只更新自身账号文件，不得改变 Active 指针或 `auth.json["grok-cli"]`。

### R5. refresh token 轮换

当上游使 `C0.refresh` 只能使用一次并返回 `C1.refresh` 时，后续刷新必须读取并提交 `C1.refresh`，不得恢复或再次提交 `C0.refresh`。

### R6. 并发协调

- 刷新与 Activate/reauth/显式 Active 凭据接纳共享 Grok provider lock。
- 普通列表读取即使与刷新并发，也不能写旧 secret。
- 刷新 A 与 Activate B 交错后，最终 Active 为串行顺序的最后合法 Activate；A 的新凭据不得回退，B 的镜像不得被 A 抢回。
- 同一进程、同一 storage id 的并发刷新继续复用 single-flight。

### R7. 异常与恢复

- 上游刷新失败：账号文件和 Active 镜像均保持原值。
- Active metadata 在刷新前不可解析：fail closed，不消费 refresh token、不写 secret。
- Active 账号的镜像写入失败：不得用旧 `auth.json` 回滚已取得的轮换凭据；本次调用返回安全错误，后续 resolver 调用必须能用已保存的新凭据重试镜像并收敛。
- 不得吞掉会让调用方误判“两处已提交成功”的 Active 镜像错误。

### R8. Legacy 兼容

- 仅有有效 `auth.json`、尚无 managed Active 槽位时，仍可通过显式 bootstrap 建立账号。
- 成功 provider OAuth login 可显式接纳刚产生的 Active 凭据。
- 普通 provider/accounts GET 不得反复用 `auth.json` 覆盖已存在槽位。
- logout/断开后现有 Active 展示语义保持不变，但不能通过旧镜像删除或覆盖 saved secret。

### R9. 存储与隐私

保持同目录 tmp + `rename`、目录 `0700`、JSON 文件 `0600`。API、日志、错误和测试输出不得包含 access/refresh token、原始 OAuth payload、上游响应正文或绝对凭据路径。

### R10. 外部契约保持

不改变 OAuth accounts API wire、provider id、metadata schema、opaque id、quota/failover 调用契约和 Session JSONL。

## 6. 验收标准

| ID | 验收标准 |
| --- | --- |
| AC-01 | Active A 从 `C0` 刷新到 `C1` 成功后，A 文件与 `auth.json.grok-cli` 的 access/refresh/expires 均为 `C1`。 |
| AC-02 | 第二次强制刷新收到的输入 refresh token 是 `C1.refresh`，不是一次性 `C0.refresh`。 |
| AC-03 | 在受控 barrier 下并发刷新与 `listOAuthAccounts("grok-cli")`，列表读取不把 `C0` 写回账号文件。 |
| AC-04 | 刷新 A 与 Activate B 并发后，B 为 Active 且镜像为 B；A 文件保留刷新后的凭据。 |
| AC-05 | 非 Active A 刷新不改变 Active B 的 metadata 或镜像。 |
| AC-06 | 同一进程同一账号并发调用只触发一次上游 refresh；调用方得到同一 flight 结果。 |
| AC-07 | 上游失败零写入；metadata 失败 fail closed；Active 镜像失败不恢复旧 refresh token，并可在后续调用收敛。 |
| AC-08 | legacy auth-only 初始化、正常 login、logout、Activate、reauth 和账号列表行为保持兼容。 |
| AC-09 | 账号/metadata 权限、原子替换和 secret 不出边界要求保持。 |
| AC-10 | 聚焦测试、Grok/OAuth 回归、lint 和 TypeScript 检查通过。 |

## 7. UI 门禁

**不触发 UI 原型门禁。** 本任务只改变服务端 OAuth 持久化与并发一致性，不新增或修改用户可见页面、交互、确认体验和信息结构，不派发 UI 设计员、不制作 HTML 原型。若实现范围扩展到恢复提示、冲突提示或人工修复入口，必须停止实现并重新走 HTML 原型审批。

## 8. 未决问题

无阻塞产品问题。建议审批以下技术决策：

1. managed Grok saved-account 为真相，`auth.json` 为单向 Active 镜像。
2. 列表读取不再隐式回写 secret；legacy bootstrap/login 使用显式接纳路径。
3. Active 镜像写失败不回滚已轮换 refresh token，而是安全失败并由后续 resolver 收敛。
