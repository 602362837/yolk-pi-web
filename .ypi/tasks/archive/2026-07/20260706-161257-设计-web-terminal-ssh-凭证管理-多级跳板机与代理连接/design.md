# design

## 方案摘要

在现有 Web Terminal 进程模型上扩展 SSH session 类型：local tab 继续启动本地 shell；SSH tab 启动系统 OpenSSH client，并用 session-scoped 临时 `ssh_config`、临时 key 文件、askpass helper、proxy helper 完成 profile、credential、ProxyJump、proxy、known_hosts 的组合。

核心原则：

1. **兼容优先**：`POST /api/terminal/sessions` 未指定 `kind` 时仍创建 local session；现有 local 多 tab/split/xterm 不重写。
2. **配置与 secret 分离**：profile 和非 secret 设置可进入 `pi-web.json`；私钥、密码、passphrase、代理认证等必须进入独立 vault。
3. **OpenSSH 生态复用**：ProxyJump、ProxyCommand、known_hosts、ssh-agent、IdentityFile 交给 OpenSSH；后端负责安全生成配置与清理临时文件。
4. **危险能力显式化**：custom ProxyCommand、agent forwarding、password auto-fill、accept-new host key 都必须在 UI/API 中有明确风险提示或开关。

## 影响模块和边界

### 前端

- `components/TerminalPanel.tsx`
  - `TerminalTabState` 增加 `kind: "local" | "ssh"`、`profileId`、`profileLabel`、`targetLabel`。
  - `add_tab` action 支持 local/ssh 两种 payload。
  - `TerminalSessionView` 创建 session 时传 `{ kind, cwd, profileId, cols, rows }`。
  - header `+` 改为 local/ssh profile picker。
- `components/SettingsConfig.tsx`
  - Terminal section 增加 SSH profiles、credentials、known_hosts 管理区块。
  - 保留现有 shell/env/env assistant UI。
- 可选新增组件：
  - `components/TerminalSshProfilePicker.tsx`
  - `components/TerminalSshProfileEditor.tsx`
  - `components/TerminalSshCredentialEditor.tsx`
  - `components/TerminalKnownHostsPanel.tsx`

### 后端 API

- `app/api/terminal/sessions/route.ts`
  - 扩展 body，默认 local。
- 新增 SSH 管理 API：
  - `app/api/terminal/ssh/profiles/route.ts`
  - `app/api/terminal/ssh/profiles/[id]/route.ts`
  - `app/api/terminal/ssh/profiles/[id]/test/route.ts`
  - `app/api/terminal/ssh/credentials/route.ts`
  - `app/api/terminal/ssh/credentials/[id]/route.ts`
  - `app/api/terminal/ssh/known-hosts/route.ts`
  - `app/api/terminal/ssh/known-hosts/scan/route.ts`
- 现有 events/input/resize/delete route 继续通过 session id 操作统一 terminal session。

### Library

- `lib/pi-web-config.ts`
  - 扩展 `PiWebTerminalConfig`，添加 `ssh` 非 secret 配置与 profile 列表。
- `lib/terminal-manager.ts`
  - 把 local spawn 与 SSH spawn 分流，但保留统一 `TerminalProcess` / `TerminalSession` 生命周期。
- 新增：
  - `lib/terminal-ssh-types.ts`：wire/config/vault summary 类型。
  - `lib/terminal-ssh-profiles.ts`：profile normalize/validate、读写 pi-web config 中的 SSH profile。
  - `lib/terminal-ssh-vault.ts`：credential secret storage、masking、引用检查。
  - `lib/terminal-ssh-runner.ts`：OpenSSH launch plan、临时文件、ProxyJump/proxy/askpass/known_hosts 组装。
  - `lib/terminal-known-hosts.ts`：dedicated known_hosts 路径、scan/trust/list/remove。

## 数据模型

### `pi-web.json` 中允许保存的数据

推荐新增于 `terminal.ssh`：

```ts
interface PiWebTerminalSshConfig {
  enabled: boolean;
  allowCustomProxyCommand: boolean;
  defaultKnownHostsPolicy: "ask" | "strict" | "accept-new";
  applyTerminalEnvToSsh: boolean;
  profiles: TerminalSshProfile[];
}

interface TerminalSshProfile {
  id: string;
  label: string;
  enabled: boolean;
  target: TerminalSshEndpoint;
  jumpHosts: TerminalSshEndpoint[];
  proxy?: TerminalSshProxyConfig;
  options?: {
    connectTimeoutSeconds?: number;
    serverAliveIntervalSeconds?: number;
    forwardAgent?: boolean;
    knownHostsPolicy?: "ask" | "strict" | "accept-new";
    requestTty?: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

interface TerminalSshEndpoint {
  id?: string;
  label?: string;
  host: string;
  port: number;
  username?: string;
  credentialId?: string;
}

type TerminalSshProxyConfig =
  | { type: "none" }
  | { type: "socks5"; host: string; port: number; credentialId?: string }
  | { type: "http"; host: string; port: number; credentialId?: string }
  | { type: "custom"; commandTemplate: string; acknowledgedRisk: boolean };
```

这些字段可进入 `pi-web.json`：

- profile id/label/enabled。
- SSH host、port、username、jump chain 拓扑。
- `credentialId` 引用。
- proxy type、proxy host/port。
- custom ProxyCommand 的非 secret command template（必须危险确认）。
- known_hosts policy、connect timeout、server alive interval、forwardAgent 开关。

这些字段不应进入 `pi-web.json`：

- 私钥内容。
- 私钥 passphrase。
- SSH password / keyboard-interactive secret。
- proxy auth password/token。
- 带 userinfo/password 的 proxy URL。
- 可展开 secret 的 ProxyCommand 片段。

### 独立 vault / secret storage

新增独立目录，沿用项目 OAuth account store 的权限模式：

- 目录：`~/.pi/agent/terminal-secrets/`，mode `0700`。
- 文件：`credentials.json` 或每 credential 独立 JSON，mode `0600`。
- 删除归档可选：`~/.pi/agent/terminal-secrets/deleted/`，mode `0700`。

建议 schema：

```ts
interface TerminalCredentialVaultFile {
  version: 1;
  credentials: TerminalCredentialRecord[];
}

interface TerminalCredentialRecord {
  id: string;
  label: string;
  type: "agent" | "identityFile" | "privateKey" | "password" | "proxyAuth";
  username?: string;
  identityFilePath?: string;
  privateKeyPem?: string;
  passphrase?: string;
  password?: string;
  proxyUsername?: string;
  proxyPassword?: string;
  fingerprint?: string;
  createdAt: string;
  updatedAt: string;
}
```

API 只返回 summary：

```ts
interface TerminalCredentialSummary {
  id: string;
  label: string;
  type: string;
  username?: string;
  identityFilePath?: string;
  hasPrivateKey: boolean;
  hasPassword: boolean;
  hasPassphrase: boolean;
  hasProxyPassword: boolean;
  fingerprint?: string;
  usedByProfileIds: string[];
  createdAt: string;
  updatedAt: string;
}
```

> 可选增强：后续接入 OS keychain。首版至少必须做到独立文件、0700/0600 权限、API 脱敏、日志不输出 secret。

## 后端架构

### Session 创建流程

`POST /api/terminal/sessions` body 扩展：

```ts
type CreateTerminalSessionInput =
  | { kind?: "local"; cwd: string; cols?: number; rows?: number }
  | { kind: "ssh"; cwd: string; profileId: string; cols?: number; rows?: number };
```

流程：

1. 读取 `readPiWebConfig().terminal`。
2. 要求 `terminal.enabled === true`；SSH 还要求 `terminal.ssh.enabled === true`。
3. 校验 `cwd` 存在且在 allowed roots 内。SSH 虽然连接远端，也仍需要当前 workspace 作为 UI/权限上下文。
4. `kind` 缺省或 `local`：走当前 `resolveShell` + `spawnTerminalProcess`。
5. `kind === "ssh"`：
   - 读取并校验 profile。
   - 从 vault 解析 credential references。
   - 构造 `SshLaunchPlan`。
   - 创建 session temp dir。
   - 写临时 `ssh_config`、必要的 key files、askpass helper/proxy context。
   - 用 `node-pty` spawn `ssh -F <config> <targetAlias>`。
6. 返回统一 `TerminalSessionInfo`：

```ts
interface TerminalSessionInfo {
  id: string;
  kind: "local" | "ssh";
  cwd: string;
  shell: string;
  backend: "pty" | "script" | "pipe";
  profileId?: string;
  profileLabel?: string;
  targetLabel?: string;
}
```

### OpenSSH 配置生成

每个 session 生成独立 host aliases：

- `ypi-<session>-target`
- `ypi-<session>-jump-1`
- `ypi-<session>-jump-2`

目标 Host 段：

```sshconfig
Host ypi-<sid>-target
  HostName target.example.com
  Port 22
  User deploy
  HostKeyAlias target.example.com:22
  UserKnownHostsFile ~/.pi/agent/terminal/known_hosts
  StrictHostKeyChecking ask
  ProxyJump ypi-<sid>-jump-1,ypi-<sid>-jump-2
  IdentityFile /tmp/ypi-terminal-ssh-<sid>/cred-target-key
  IdentitiesOnly yes
  ForwardAgent no
  ServerAliveInterval 30
```

每级 jump Host 段独立生成 `User`、`IdentityFile`、password askpass mapping。若配置 proxy：

- 有 jump chain：proxy 应作用于第一跳 host alias。
- 无 jump chain：proxy 作用于 target alias。

SOCKS5/HTTP 使用内置 proxy helper：

```sshconfig
ProxyCommand /path/to/node /path/to/terminal-proxy-helper.js /tmp/ypi-terminal-ssh-<sid>/proxy-context.json %h %p
```

Custom ProxyCommand：

- 仅当全局 `allowCustomProxyCommand` 与 profile `acknowledgedRisk` 均为 true。
- 只允许 `%h`、`%p` 或 `{{host}}`、`{{port}}` 这样的非 secret 占位符。
- 拒绝 newline、NUL、过长字符串、`{{secret:*}}`。
- UI/API 展示 exact command template 与危险提示。

### Password / passphrase askpass

对于 password credential 或 private key passphrase：

- 临时 secret context 写入 temp dir 0600 文件。
- 生成 askpass helper，helper 从 context 读取 secret，绝不把 secret 放进命令行参数。
- SSH 进程环境只包含 `SSH_ASKPASS`、`SSH_ASKPASS_REQUIRE=force`、context path 等必要字段。
- 如果当前 OpenSSH/平台不支持强制 askpass，连接仍可回落为 terminal 中手动输入密码/口令。
- password 自动填充应在 UI 中作为明确能力提示；不要静默保存用户输入。

注意：多跳 password prompt 顺序由 OpenSSH 控制。设计上用 connection order queue + host/key prompt mapping；对于同 host/user 多 credential 的歧义，UI 应提示可能需要手输或要求改用 key/agent。

## API 设计

### Session API 兼容扩展

- `POST /api/terminal/sessions`
  - local 旧 body 兼容。
  - SSH body 新增 `kind: "ssh"`、`profileId`。
  - 错误分类：`TerminalError` status 400/403/404/500。

### Profiles

- `GET /api/terminal/ssh/profiles?cwd=...`
  - 返回 profile list + validation summary，不含 secret。
- `POST /api/terminal/ssh/profiles`
  - 创建 profile，写入 `pi-web.json`。
- `PATCH /api/terminal/ssh/profiles/[id]`
  - 更新 profile，拒绝 secret 字段。
- `DELETE /api/terminal/ssh/profiles/[id]`
  - 删除 profile，不删除 credential。
- `POST /api/terminal/ssh/profiles/[id]/test`
  - body：`{ mode: "validate" | "resolve" | "network" }`。
  - 返回脱敏 launch plan、缺失 credential、ssh binary、known_hosts/proxy warning、可选 network result。

### Credentials

- `GET /api/terminal/ssh/credentials?cwd=...`
  - 返回 `TerminalCredentialSummary[]`。
- `POST /api/terminal/ssh/credentials`
  - 新增 credential；secret 只在请求体进入服务端，不回显。
- `PATCH /api/terminal/ssh/credentials/[id]`
  - 更新 label/metadata；secret fields 留空表示不改；显式 `replaceSecret` 才替换。
- `DELETE /api/terminal/ssh/credentials/[id]`
  - 若被 profile 引用，默认 409 并返回引用；`?force=true` 才允许删除并让 profile 标 invalid。

### Known hosts

- `GET /api/terminal/ssh/known-hosts`
  - 返回 dedicated known_hosts 条目摘要。
- `POST /api/terminal/ssh/known-hosts/scan`
  - body：`{ host, port, throughProfileId? }`；首版可 best-effort 直连 scan。
- `POST /api/terminal/ssh/known-hosts`
  - body：用户确认的 host key line/fingerprint，写入 dedicated known_hosts。
- `DELETE /api/terminal/ssh/known-hosts`
  - body：`{ host, port, fingerprint? }` 删除条目。

## 安全边界

### Secret 脱敏

- API responses 永不返回 `privateKeyPem`、`password`、`passphrase`、`proxyPassword`。
- 错误消息不得拼接完整 ssh_config、ProxyCommand 展开结果或 temp secret path 中的内容。
- UI secret 输入框不回填，只显示 summary。
- 日志/debug 只允许 redacted plan：`IdentityFile <temp-key:redacted>`、`ProxyAuth <present>`。

### 临时文件

- 目录：`os.tmpdir()/ypi-terminal-ssh-<sessionId>/`，mode 0700。
- 文件：
  - `ssh_config` 0600。
  - imported key 0600。
  - askpass/proxy context 0600。
  - helper script 0700 or use packaged static helper。
- 清理：
  - `closeTerminalSession` 调用 cleanup。
  - SSH process exit 调用 cleanup。
  - service startup sweep older than e.g. 24h。
- 不在 terminal 输出中主动打印 temp paths；如 OpenSSH 错误泄露 key path，路径本身不含 secret，但仍应接受。

### known_hosts

- 使用 dedicated file：`~/.pi/agent/terminal/known_hosts`，mode 0600。
- `HostKeyAlias` 使用稳定实际 host:port，避免 session alias 污染 known_hosts。
- 默认推荐 `ask` 或 UI manual trust；`accept-new` 必须提示首次连接 MITM 风险。
- 不建议设置 `StrictHostKeyChecking no`；如提供，只能作为 debug/unsafe 选项并强警告，首版可不支持。

### ProxyCommand 风险控制

- custom ProxyCommand 是本机命令执行能力，风险等价于在 ypi 进程用户下运行 shell command。
- 默认禁用，全局 setting + profile acknowledgement 双门禁。
- 不允许 secret placeholder；不把 proxy password 放入命令行或 env。
- 拒绝控制字符与 newline，限制长度。
- UI 展示 exact template 和运行目标 host/port。
- SOCKS5/HTTP 代理优先使用内置 proxy helper，避免要求用户写 `nc` 命令。

### 环境变量边界

- 现有 `terminal.env` 明文保存，默认只应用于 local shell。
- SSH launcher 默认使用最小必要环境：`PATH`、`HOME`、`TERM`、`SSH_AUTH_SOCK`、askpass/proxy 所需变量。
- 是否把 `terminal.env` 应用到 SSH 由 `terminal.ssh.applyTerminalEnvToSsh` 控制，默认 false，避免把本地代理/密钥类 env 暴露给 custom ProxyCommand。

## 迁移与兼容

- `PiWebTerminalConfig` 新增 `ssh` 字段，normalize 时缺省：

```ts
ssh: {
  enabled: false,
  allowCustomProxyCommand: false,
  defaultKnownHostsPolicy: "ask",
  applyTerminalEnvToSsh: false,
  profiles: []
}
```

- 旧 `pi-web.json` 不需要迁移脚本；保存 Settings 后会带上默认 ssh 配置。
- 旧 API body 创建 local session 不变。
- 旧 `TerminalSessionInfo` 的 `shell/backend` 仍存在；新字段可选。
- 现有 session 是内存态，部署新版本不会尝试恢复旧 terminal session。

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| OpenSSH 不存在或版本不支持 askpass force | preflight 检测；UI 显示；password 回落手输；推荐 key/agent。 |
| custom ProxyCommand 执行任意命令 | 默认禁用、双确认、无 secret placeholder、输入校验、文档警告。 |
| secret 写入 pi-web.json/API/log | 独立 vault、summary API、redaction 测试、review gate。 |
| 临时私钥残留 | 0700 temp dir、0600 key、close/exit/startup sweep。 |
| known_hosts 首次信任 MITM | 默认 ask/manual trust；显示 fingerprint；`accept-new` 强警告。 |
| 多跳 password prompt 映射不稳定 | 推荐 key/agent；askpass best-effort；歧义时手输 fallback。 |
| SSH remote host 绕过 allowed roots | 这是功能目标；仍要求本地 cwd allowed 与 terminal enabled。 |

## 回滚方案

- 新字段是可选兼容扩展；关闭 `terminal.ssh.enabled` 即禁用 SSH session 创建。
- 如出现问题，可保留 profile/vault 文件但 UI 不展示打开入口。
- local terminal 路径独立，若 SSH runner 出错不影响 `kind=local`。
