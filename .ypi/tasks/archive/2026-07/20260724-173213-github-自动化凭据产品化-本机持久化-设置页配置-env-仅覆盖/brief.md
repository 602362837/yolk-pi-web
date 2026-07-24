# Brief：GitHub 自动化凭据产品化

## 结论

GitHub App 自动化当前把 App ID、私钥文件路径、Webhook secret 全部限定为进程环境变量，导致普通 `ypi` 本机安装无法完成一次配置、重启复用的产品闭环。本任务将 **Settings → GitHub 自动化** 改为默认本机凭据配置入口：服务端在 agent data dir 下以 `0700/0600`、原子写和跨进程锁持久化凭据；运行时按 **逐字段 env 覆盖 → 本机持久值 → 未配置** 解析。env 保留给 CI、容器和专业部署，不再是唯一入口。

## 用户问题

- `ypi` 是用户从终端启动的 Node 本机进程，不是稳定注入环境变量的 systemd 服务。
- 当前 `lib/github-app-credentials.ts` 只读 `YPI_GITHUB_APP_ID`、`YPI_GITHUB_APP_PRIVATE_KEY_FILE`、`YPI_GITHUB_APP_WEBHOOK_SECRET`；关机或新终端启动后配置容易丢失。
- 当前 `components/GithubAutomationConfig.tsx` 明确拒绝 App ID、Webhook secret、PEM 输入/上传，只展示 env 名称，因此设置页无法完成设置。
- 同仓库已有 `lib/links-store.ts`、`lib/api-key-accounts.ts`、`lib/web-credential-store.ts` 的本机秘密落盘实践：私有目录、私有文件、同目录临时文件 + fsync + rename、进程队列与 mkdir 锁、安全投影。
- 当前客户指南、部署文档、排障文档都把 env 写成主路径，和“设置页可用”的产品目标冲突。

## 目标用户与价值

| 用户 | 当前障碍 | 本任务价值 |
| --- | --- | --- |
| 普通本机安装用户 | 不会或无法稳定注入 Node 进程 env | 在设置页一次配置，正常启动 `ypi` 即可复用 |
| 开发者 | 每次 shell/export 或启动命令前缀易遗漏 | 项目外的 agent data dir 持久化，重启不丢 |
| CI / 容器 / 专业部署 | 需要外部 secret manager 控制 | 继续用 env，并明确覆盖本机值 |
| 运维/排障人员 | 不知道实际生效来源 | 安全显示每个字段来源是 env / 本机 / 未配置，不显示值 |

## 已确认范围

### 范围内

1. 在 `<getAgentDir()>/github-automation/` 新增本机 GitHub App 凭据存储：
   - `credentials.v1.json`：App ID、Webhook secret、可选 App slug、当前私钥槽 basename/指纹/版本元数据；`0600`。
   - `private-key.<generation>.pem`：GitHub App RSA 私钥；`0600`。采用 generation 文件 + metadata 原子切换，避免双文件轮换中间态；清理未引用旧槽。
   - 根目录和锁目录 `0700`；同目录暂存、fsync、rename；进程队列 + mkdir 跨进程锁。
2. 运行时逐字段优先级：非空进程 env > 本机持久值 > missing。
3. 设置页支持：
   - App ID 输入；
   - Webhook secret password 输入，保存后只显示“已配置 / 轮换”；
   - PEM 粘贴或选择本机 `.pem` 文件；浏览器不回显已保存内容；
   - 安全来源提示、保存/轮换、移除本机凭据、验证配置。
4. 新增独立凭据 API；只返回 safe projection，不与非 secret `config.json` CAS PATCH 混合。
5. 保存/轮换后立即清理 GitHub installation token 内存缓存，新的 App 身份不复用旧 token。
6. checklist、status、verify、客户指南、模块文档、部署与排障文档改为“设置页主路径，env 高级覆盖”。
7. 自动测试覆盖持久化、重启模拟、env 覆盖、Webhook 验签、权限、并发、损坏文件与 secret 泄漏。

### 范围外

- 托管共享 GitHub App 或云端 secret vault。
- 将 GitHub App 凭据写入 `pi-web.json`、Links、`auth.json`、模型 CredentialStore、Session/Task/日志。
- 显示、复制、下载已保存的 Webhook secret 或私钥。
- 从任意服务端路径导入私钥；浏览器文件选择只上传用户明确选择的文件内容。
- 自动创建 GitHub App、自动安装 App、自动开公网隧道。
- shell wrapper、zshrc、Homebrew/node_modules 本机补丁或要求每次 `export`。
- 改变允许仓库、机器 Assignee、Triage/无人值守、发布策略的既有语义。

## 证据与现状

- `lib/github-app-credentials.ts`：`resolveAppId/resolvePrivateKeyFile/resolveWebhookSecret` 全部只调用 env；`loadGithubAppCredentials()` 从 env 路径读 PEM。
- `components/GithubAutomationConfig.tsx`：页面文案和 fallback checklist 明确“不会提供输入”“只复制 env 名”；`App 配置方式` 是 env 指南。
- `app/api/github-automation/config/route.ts` 与 `lib/github-automation-projection.ts`：现有 config API 是非 secret CAS 控制面，并主动拒绝 secret/private/credential 字段，不适合承载凭据写入。
- `lib/github-app-client.ts`：installation token 以内存 Map 缓存至过期前 60 秒；凭据轮换后需要显式失效。
- `lib/github-automation-setup-verify.ts`：App ID、私钥、Webhook secret 的 next step 全部指向 env，需要改成设置页默认路径。
- `docs/integrations/github-app-automation-setup.md`、`docs/deployment/README.md`、`docs/operations/troubleshooting.md`：均把 env 当作必选主路径。
- `lib/links-store.ts`、`lib/api-key-accounts.ts`、`lib/web-credential-store.ts`：已有 0700/0600、原子写、进程队列、mkdir 锁、元数据/秘密投影分离模式。

## 冻结方案决策

1. **独立 secret store 与独立 API**：不把秘密塞入 `config.json` 或现有 config PATCH。
2. **逐字段覆盖**：App ID、私钥、Webhook secret、可选 slug 各自按 env → local → missing 解析；UI 显示安全来源。高级用户只覆盖某个 env 时，其他字段仍可来自本机。
3. **本机 bundle 完整性**：首次本机保存必须形成 App ID + 有效 RSA PEM + Webhook secret 的完整 bundle；轮换时空白输入表示保留已保存字段，不从 env 反向写盘。
4. **无 reveal**：GET/status/verify 只给布尔值、readiness、来源枚举和时间；不返回 App ID 原值、secret、PEM、文件路径或指纹。
5. **私钥一致性**：先原子写 generation key 文件，再以 `credentials.v1.json` 原子切换当前槽；metadata 保存 basename 与内容指纹，读取时同时校验 containment、文件类型和指纹，不一致即 fail closed。旧槽在切换后 best-effort 清理。
6. **env 只覆盖，不导入**：设置页保存永远不会读取并复制 env 值到本机文件；删除本机凭据也不会修改进程 env。
7. **即时生效**：保存/删除后重读 projection，并清理 installation token cache；不要求重启，但必须通过“重启无 env 仍 configured”验收。

## 主要风险

| 风险 | 缓解 |
| --- | --- |
| 两个凭据文件无法获得文件系统级跨文件原子事务 | 单锁、同目录 staging、指纹一致性、错误回滚；崩溃中间态 fail closed，不静默混用 |
| env 与 local 属于不同 App，逐字段混用 | UI 按字段显示覆盖来源；verify 对 App JWT/installation 做真实只读校验；文档提示覆盖值必须属于同一 App |
| 保存后仍使用旧 installation token | 保存/删除成功后清空 App installation token cache |
| secret 进入 API 错误、DOM、日志或任务文件 | 固定错误码/文案、no-store、禁止 reveal、sentinel 扫描与投影 allowlist |
| 浏览器大文件/非 PEM 上传 | multipart/body 上限、文件数/字段 allowlist、RSA PEM 解析、尺寸限制、拒绝证书/公钥/多文件 |
| UI 以空 password 覆盖已有 secret | 空白默认为 preserve；轮换必须输入新值并明确保存 |

## 完成定义

- 设置页完成一次本机配置，停止并重新启动 `ypi`，不设置任何 `YPI_GITHUB_APP_*` env，status/verify 仍显示 configured。
- 使用本机保存的 Webhook secret 可通过 HMAC 验签并接收合法 delivery。
- 单字段或全量 env 仍覆盖本机值，移除 env 后自动回落到本机值。
- 凭据 API、status、verify、DOM、日志、测试输出不含 secret/PEM/绝对路径/指纹。
- 文档的默认路径是设置页，本机 shell/env 只列为高级覆盖。
