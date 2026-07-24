# Design：GitHub App 本机凭据存储、覆盖解析与设置页配置

## 方案摘要

新增 GitHub automation 专属的 server-only credential store 与独立 credentials API。store 使用 generation key 文件 + metadata 原子指针：先写并 fsync `private-key.<generation>.pem`，再原子替换 `credentials.v1.json`；读者只读取 metadata 指向且通过 basename containment、普通文件、RSA 解析和 SHA-256 指纹校验的 key。运行时 resolver 对 App ID、key、Webhook secret、slug 逐字段应用 env → local → missing。现有 JWT、GitHub App client、Webhook runtime 继续只依赖 `loadGithubAppCredentials()` / `loadGithubAppWebhookSecret()`，调用方无需各自理解存储来源。

设置页通过 `/api/github-automation/credentials` 进行即时保存、轮换和删除；safe projection 提供布尔 readiness、local readiness 与字段来源，不回显值。现有 `/config` 继续是非 secret CAS 控制面并继续拒绝 secret 字段。

## AS-IS / TO-BE

```text
AS-IS
GithubAutomationConfig
  └─ 复制 env 名 / 外部手工配置
process.env
  └─ github-app-credentials
      ├─ JWT / installation token
      └─ webhook HMAC

TO-BE
GithubAutomationConfig
  └─ GET/PUT/DELETE /api/github-automation/credentials
      └─ github-app-credential-store (0700/0600 + lock + atomic pointer)

process.env ────────────────┐
local credential bundle ───┼─ github-app-credentials resolver (per-field overlay)
missing ───────────────────┘      ├─ safe projection/status/verify
                                 ├─ JWT / installation token
                                 └─ webhook HMAC
```

## 影响模块与边界

| 模块 | 变更 | 不承担 |
| --- | --- | --- |
| `lib/github-app-credential-store.ts`（新增） | 本机 bundle schema、路径、锁、读/写/删、RSA/指纹/权限、safe local summary | env 解析、GitHub 网络、浏览器投影拼装 |
| `lib/github-app-credentials.ts` | env + local 逐字段 resolver、effective projection、full credential load | HTTP body 解析、UI |
| `lib/github-automation-types.ts` | additive readiness/source/safe projection types；更新 env-only 注释 | 存盘实现 |
| `lib/github-app-client.ts` | 暴露内部 cache invalidation；本机保存/删除后清 installation token cache | 凭据持久化 |
| `app/api/github-automation/credentials/route.ts`（新增） | GET safe status、PUT multipart、DELETE confirm、no-store、固定错误 | non-secret config CAS、verify 网络探测 |
| `lib/github-automation-setup-verify.ts` | checklist/next step 改为设置页主路径并理解 source/local 状态 | 接收 secret body |
| `lib/github-automation-projection.ts` | status safe projection保持无 secret，并允许 additive source/local 字段 | 凭据 mutation |
| `components/GithubAutomationConfig.tsx` | 本机配置、轮换、文件/粘贴、env 高级覆盖、删除、状态清理 | reveal、服务端 path 输入 |
| `app/globals.css` | 复用现有 GitHub automation card/field/button 样式，增加 secret form 状态 | 新的全局设计系统 |
| `scripts/test-github-automation.mjs` | store/resolver/API contract/sentinel/cache/验签回归 | 真实 GitHub 或真实用户 secret |
| docs | 设置页主路径、env 覆盖、存储/权限/排障 | 暴露真实 secret/path |

### 保持隔离

- 不导入 `links-store`、`oauth-accounts`、`api-key-accounts`、`web-credential-store` 作为运行依赖；只复用模式。
- 不写 `pi-web.json`、`auth.json`、Links、Session JSONL、Studio task、job/event/delivery。
- P1 secret scrub 继续清理 `YPI_GITHUB_APP_*`；本机文件不会主动注入 agent env/prompt。

## 磁盘契约

目录：`<getAgentDir()>/github-automation/`

```text
github-automation/                         # 0700
  config.json                              # 0600，既有非 secret
  credentials.v1.json                     # 0600，secret bundle metadata
  private-key.<generation>.pem             # 0600，metadata 当前引用
  .locks/
    credentials.lock/                      # 0700 mkdir lock + owner metadata
  .tmp-*                                   # 0600，失败/启动清理；永不参与读取
  deliveries/ jobs/ repositories/ ...      # 既有
```

`credentials.v1.json` server-only schema：

```json
{
  "schemaVersion": 1,
  "kind": "ypi-github-app-local-credentials",
  "appId": "123456",
  "webhookSecret": "server-only",
  "appSlug": "optional-slug-or-null",
  "keyFile": "private-key.7d12...pem",
  "keySha256": "sha256:...",
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601"
}
```

### 存盘规则

1. `getAgentDir()` 是唯一根；不接受客户端 path。
2. `keyFile` 必须匹配固定 basename 正则，不含 `/`、`\\`、`.` traversal；resolve 后必须仍在 automation root。
3. `lstat` 必须是普通文件，拒绝 symlink；读取有 64 KiB 上限。
4. metadata 有 16 KiB 上限；Webhook secret 最大 4096 bytes；App slug 最大 100；App ID 1–32 位数字。
5. 私钥通过 `createPrivateKey()`，且 `asymmetricKeyType` 是 `rsa` 或兼容 GitHub App RSA；拒绝公钥、证书、EC key。
6. key SHA-256 必须与 metadata 一致；不投影 fingerprint。
7. 未知 schema/kind、损坏 JSON、key 缺失/不匹配均 fail closed。显式 DELETE 可清理损坏 bundle；普通 PUT 不静默覆盖未知未来 schema。

### 写入事务

在 process queue + credentials mkdir lock 中：

1. 锁内重读当前 metadata；确认可合并（缺失/有效 v1）。
2. 合并只来自“现有 local + 本次提交”；**绝不从 env 复制**。
3. 校验完整 bundle；生成新 generation。
4. 若 key 未变，可继续引用当前 key；若变，写新 generation tmp → fsync → chmod → rename。
5. 写新 metadata tmp → fsync → chmod → rename，原子切换 active generation。
6. best-effort fsync 父目录；清理旧 key 和未引用 tmp/generation。
7. 任一步失败返回固定 storage error，不报告成功；metadata 未切换时新孤儿 key可在下一次锁内清理。

删除在同一锁内先将 metadata 原子 quarantine，再删除当前 key；失败时 best-effort restore，最终只在两者不再 active 后返回成功。未知/损坏 metadata 的 DELETE 清除 `credentials.v1.json` 与固定匹配的 key slots，但不递归删除 automation 其他状态。

## 解析与优先级契约

### 逐字段 overlay

| 字段 | env | local | required |
| --- | --- | --- | --- |
| App ID | `YPI_GITHUB_APP_ID` | `credentials.v1.json.appId` | 是 |
| private key | `YPI_GITHUB_APP_PRIVATE_KEY_FILE` 指向并解析的 key | metadata 当前 key slot | 是 |
| Webhook secret | `YPI_GITHUB_APP_WEBHOOK_SECRET` | `credentials.v1.json.webhookSecret` | 是 |
| App slug | `YPI_GITHUB_APP_SLUG` | `credentials.v1.json.appSlug` | 否 |

每个非空 env 独立覆盖。env key 仍可指向运维管理的外部 PEM；local key 永不暴露路径。解析结果在一次 load 内使用同一 local bundle snapshot，避免字段来自不同 local generations。

### Safe projection（additive）

```ts
type GithubAppCredentialValueSource = "env" | "local" | "missing";

interface GithubAppCredentialSafeProjection {
  configured: boolean;
  readiness: GithubAppCredentialReadinessCode;
  appSlug: string | null;
  hasAppId: boolean;
  hasPrivateKeyFile: boolean; // 兼容字段
  hasPrivateKey: boolean;     // additive alias
  hasWebhookSecret: boolean;
  checkedAt: string;
  local: {
    configured: boolean;
    readiness: "ready" | "missing" | "invalid" | "unsupported";
    hasAppId: boolean;
    hasKey: boolean;
    hasWebhook: boolean;
    updatedAt: string | null;
  };
  sources: {
    appId: GithubAppCredentialValueSource;
    key: GithubAppCredentialValueSource;
    webhook: GithubAppCredentialValueSource;
    slug: GithubAppCredentialValueSource;
  };
}
```

避免在 wire object 中使用 `privateKey` / `webhookSecret` 容器字段；`assertGithubAutomationProjectionSafe` 继续拦截 secret-like 值、绝对路径和禁用字段。

### Readiness 顺序

1. missing app ID
2. invalid App ID
3. missing key
4. unreadable/invalid env key，或 invalid/unsupported local bundle when key needs local
5. missing Webhook secret
6. ready

Local 无效但三个 required 字段全部被 env 覆盖时，effective 可为 `ready`，同时 `local.readiness=invalid`，UI 提示 fallback 需修复。部分 env 覆盖需要 local 时，local invalid 会阻塞 configured。

## API 契约

### `GET /api/github-automation/credentials`

响应 `200`：

```json
{
  "ok": true,
  "status": { "configured": true, "readiness": "ready", "sources": {}, "local": {} }
}
```

- `Cache-Control: no-store`。
- 无网络、无 scheduler/job side effect。

### `PUT /api/github-automation/credentials`

`multipart/form-data`，总请求上限建议 96 KiB；字段 allowlist：

| field | 语义 |
| --- | --- |
| `appId` | 非空才替换 local App ID；未提交/空白 preserve |
| `webhookSecret` | 非空才替换 local secret；未提交/空白 preserve |
| `appSlug` | 非空 set；`clearAppSlug=true` 清除；否则 preserve |
| `privateKeyPem` | PEM 粘贴；与 file 二选一 |
| `privateKeyFile` | 单个上传文件；与 paste 二选一 |

- 首次保存/现有缺失时，合并结果必须含 App ID + key + Webhook secret。
- `privateKeyPem` 与 `privateKeyFile` 同时存在、重复字段、多文件、未知字段、query secret、JSON body、server path 字段均 `400 invalid_credentials_request`。
- 返回 `200 { ok:true, status }`；先持久化成功、清 installation token cache、再生成响应。
- 不回显输入；错误不含字段内容。

### `DELETE /api/github-automation/credentials`

JSON 固定 body：

```json
{ "confirm": "remove_local_credentials" }
```

- 删除 local bundle；不修改 env、GitHub App、installation、config、allowlist、jobs。
- 清 installation token cache。
- 返回删除后的 effective safe projection；若 env 完整，仍可能 `configured=true`。

### 错误码

`invalid_credentials_request`、`invalid_app_id`、`invalid_webhook_secret`、`invalid_private_key`、`private_key_too_large`、`local_credentials_invalid`、`local_credentials_unsupported`、`credentials_lock_timeout`、`credentials_store_error`。HTTP 文案固定、路径无关、secret 无关。

## UI 设计契约

详见 [ui.md](ui.md) 与 HTML 草案。核心信息顺序：

1. 页面说明与即时保存 badge。
2. **本机 GitHub App 凭据**主卡：三项状态/来源 → 编辑/轮换表单 → 保存到本机。
3. Setup checklist + 验证配置。
4. **高级：环境变量覆盖**折叠区。
5. 既有运行模式、readiness、allowlist、policy、jobs。

### 表单行为

- App ID 普通 text/numeric input；已存时 placeholder “留空则保留已配置值”。
- Webhook secret `type=password`，`autoComplete="new-password"`；不提供眼睛/reveal；可临时显示“本次输入”的按钮也不建议，原型默认不提供。
- 私钥使用 segmented/radio：粘贴 PEM / 选择文件。切换时清理另一种输入。
- 选择文件不读取为页面预览；FormData 直接提交 File。粘贴文本只存在组件临时 state。
- 保存成功/删除/卸载/切换 view 清空 secret、PEM、File input（通过 ref.value=""）。
- env source chip 放在字段状态旁；本地 fallback 仍可轮换，提示“当前进程优先使用 env”。
- 删除本机凭据使用 AppPrompt danger confirm。

## 数据流

### 首次本机保存

```text
User form
 → PUT multipart credentials API
 → strict parse / size / RSA validation
 → store lock + generation key + metadata pointer
 → clear installation token cache
 → effective resolver safe projection
 → UI clears transient secrets
 → status + verify refresh
```

### Webhook

```text
POST webhook raw bytes
 → loadGithubAppWebhookSecret()
 → env webhook if non-empty, else local bundle webhook
 → timing-safe HMAC compare before JSON parse
```

### GitHub API

```text
App operation
 → installation token cache
 → cache miss: loadGithubAppCredentials()
 → env/local resolved App ID + KeyObject
 → App JWT → installation token
```

本机 mutation 清 cache，避免身份轮换后命中旧 token。

## 兼容性与迁移

- 无磁盘迁移：未存在 local bundle 时行为仍由 env 提供。
- 既有 env-only 部署 100% 保持；优先级仍是 env。
- `hasPrivateKeyFile` wire 字段保留，新增 alias/source/local 字段为 additive。
- 现有 `/api/github-automation/config` schema/version 不变；不把 secret 纳入 revision。
- 现有 config、deliveries、jobs、issues、events 不搬迁。
- 若未来 schema 升级，v1 reader 对未知版本 fail closed，不自动覆盖。

## 安全分析

- 浏览器必须发送用户本次输入才能配置；安全边界是 TLS/本机 loopback、no-store、无日志、无回显，而不是拒绝输入。
- 公网暴露的 ypi Settings/API 本身没有新增认证机制；这项功能会让能访问设置 API 的主体写入 App 凭据。部署文档必须重申：不要把管理 UI 无认证暴露公网；公网只代理必要 webhook route，或由外部访问控制保护 UI/API。
- multipart parser 不接受任意路径；文件名只作忽略的元数据，服务端生成 generation basename。
- secret 文件同 OS 用户仍可读，这是本机 0600 模型边界，不是硬件/系统 keychain。
- P1 full agent 不是 sandbox；产品只保证不主动注入，建议独立低权限 OS 用户/container。

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| ypi 管理 API 被非授权网络用户调用 | 文档强调管理 UI 需本机/受控访问；API 不扩大到 webhook 公网入口；未来 auth 是独立项目 |
| 多进程轮换读到中间态 | generation key 先写、metadata 单文件原子切换；读只跟随 metadata |
| 旧 key 文件残留 | 切换后和下次锁内清理未引用固定-pattern generation；均 0600 |
| env/local 混配 | 字段 source 可见、verify 真实探测、文档要求属于同一 App |
| 旧 installation token | mutation 后显式 clear cache；测试覆盖 |
| secret 泄漏到 React error/toast | 错误固定映射；不使用 response raw message；成功即清 transient state |
| 误清空 | 空字段 preserve；删除必须 danger confirm；不提供空字符串清单字段 |
| Store 损坏无法恢复 | safe 状态给出删除本机 bundle + 完整重配路径；未知 schema 不自动覆盖 |

## 回滚

1. UI 隐藏/禁用本机凭据表单，恢复 env 高级说明为唯一临时运维入口。
2. credentials route 可返回 `503 local_credentials_disabled`；runtime resolver 保留读取 local 以避免已配置用户突然停机，或代码级回滚后 env 接管。
3. 不自动删除 `credentials.v1.json` / key slots；回滚版本不识别时文件保持静默，不进入 config/session。
4. 紧急停用自动化仍使用 `enabled=false` / `mode=off`，与凭据存储删除分离。
5. 删除 local bundle 必须由用户显式操作，不作为版本回滚副作用。
