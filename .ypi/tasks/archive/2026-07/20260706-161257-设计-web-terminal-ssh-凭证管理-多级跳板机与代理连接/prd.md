# prd

## 目标与背景

现有 Web Terminal 已支持本地多 tab、多 pane、xterm 交互与会话 API。用户希望在同一 Web Terminal 中直接打开 SSH 远端终端，并能管理 SSH profile、复用凭证、通过多级跳板机或代理连接目标机。

目标是让本地 terminal 与 SSH terminal 共用当前 tab/pane 体验，同时把 SSH secret 与普通配置严格分离，避免把私钥、密码、代理密码写入 `pi-web.json` 或浏览器响应。

## 范围内

1. **SSH profile 管理**
   - 新增多个 SSH profile。
   - 每个 profile 包含目标 host、port、username、credential 引用、连接选项、jump chain、proxy 配置、known_hosts 策略。
   - 支持 profile 启用/禁用、创建、编辑、删除、测试/预检。

2. **Credential 管理与复用**
   - 新增可复用 credential，profile target 与每级 jump host 均可引用不同 credential。
   - 首版 credential 类型建议支持：
     - `agent`：使用 ssh-agent / 默认 OpenSSH 行为。
     - `identityFile`：引用已有本机私钥路径。
     - `privateKey`：导入私钥内容，存入 secret vault，运行时写临时 key 文件。
     - `password`：保存 SSH 密码，运行时通过受控 askpass helper 使用。
     - `privateKeyWithPassphrase`：私钥内容/路径 + passphrase，passphrase 进 vault。
   - API/UI 只返回脱敏 summary，不返回 secret。

3. **多级跳板机**
   - 支持 `jumpHosts[]` 有序数组，生成多级 `ProxyJump`。
   - 每级 jump host 可独立设置 host/port/user/credential。
   - 支持目标机与跳板机同 host 不同 credential 的场景。

4. **代理连接**
   - 支持 profile 指定连接代理，用于到达第一跳或目标：
     - `socks5`
     - `http` CONNECT
     - `customProxyCommand`
   - SOCKS5/HTTP 代理支持无认证；如需认证，代理用户名/密码必须进入 secret vault，不进入 `pi-web.json`。
   - custom ProxyCommand 作为危险高级功能，默认关闭/强警告，不支持 secret 直接展开到命令行。

5. **Web Terminal 兼容**
   - 现有 local terminal 行为不变。
   - `POST /api/terminal/sessions` 未传 SSH 字段时继续创建本地 shell。
   - 多 tab 可混合 local/ssh；split pane、rename、close、resize、SSE 输出、输入转发继续复用。

6. **安全边界**
   - secret 不进入 `pi-web.json`、浏览器 local state、SSE 输出、日志或命令行参数。
   - 临时 key/config/helper 文件创建在 session-scoped 0700 目录，key/secret 文件 0600，session 结束清理，服务启动清理过期目录。
   - known_hosts 使用独立文件，不把 host key 写入 profile secret。
   - ProxyCommand 风险显式提示与输入校验。

## 范围外

- 不实现持久化 terminal tab/session 恢复；SSH session 与现有 local terminal 一样是 ephemeral。
- 不提供远程文件浏览、SFTP、端口转发管理 UI。
- 不提供共享团队凭证或云端同步。
- 不在首版替换本地 shell 设置或改变 `terminal.env` 语义。
- 不绕过 OpenSSH/系统 SSH 的可用性限制；没有 `ssh` 可执行文件时返回可操作错误。

## 用户故事与验收标准

### US-1：本地 terminal 不受影响

作为现有用户，我可以继续点击 Terminal 打开本地 shell，并使用多 tab/split pane。

验收：

- 未配置任何 SSH profile 时，现有 Terminal 按钮和 `+` 新 tab 行为保持 local。
- 旧请求 `{ cwd, cols, rows }` 创建 local session 成功。
- Terminal setting disabled 时 local/SSH session 均不能启动。

### US-2：创建 SSH profile 并打开远端 tab

作为用户，我可以在 Settings 或 Terminal 下拉中创建 SSH profile，选择 credential 后打开 SSH tab。

验收：

- profile 列表可新增/编辑/删除。
- 打开 SSH tab 后，tab 标题显示 profile label/host，状态点显示 starting/connected/error。
- 输入、输出、resize 均可用于远端交互式 shell。

### US-3：复用 credential 并为跳板机指定不同 credential

作为用户，我可以创建多个 credential，并在 target 与各级 jump host 复用或分别指定。

验收：

- 同一 credential 可被多个 profile 引用。
- `jumpHosts[0].credentialId`、`jumpHosts[1].credentialId`、`target.credentialId` 可互不相同。
- 生成的 SSH 配置中每个 host alias 有独立 `User` / `IdentityFile` / password askpass 映射。

### US-4：通过多级 ProxyJump 连接

作为用户，我可以配置 A -> jump1 -> jump2 -> target 的连接链路。

验收：

- 后端按 jump host 顺序生成 `ProxyJump jump1,jump2`。
- first jump 使用 proxy 时，proxy 只作用于第一跳；无 jump 时作用于 target。
- 错误消息能说明失败发生在 profile 校验、credential 缺失、ssh binary 缺失、host key、连接失败中的哪一类。

### US-5：通过 SOCKS5/HTTP/custom ProxyCommand 连接

作为用户，我可以为 SSH profile 指定代理。

验收：

- SOCKS5/HTTP 代理 host/port 非 secret，可保存于 profile。
- 代理认证 secret 不出现在 `pi-web.json` 或进程命令行。
- custom ProxyCommand 必须通过危险确认开关，保存/展示 exact command，并拒绝 newline/NUL/secret placeholder。

### US-6：secret 脱敏与存储隔离

作为用户，我不希望私钥/密码意外出现在配置文件、API、日志或 UI。

验收：

- `~/.pi/agent/pi-web.json` 只包含 profile、credentialId、非 secret 代理 endpoint、策略字段。
- 私钥内容、passphrase、password、proxy password 存入独立 vault 文件/目录，权限 0600/0700。
- GET credential/profile API 不返回 secret，只返回 `hasPassword`、`hasPrivateKey`、`fingerprint`、`maskedProxyUrl` 等 summary。
- 删除 credential 前提示被哪些 profile 引用；删除后引用 profile 显示 invalid/missing credential。

## 非功能需求

- **兼容性**：不破坏现有 local terminal API/UI。
- **可维护性**：SSH profile/credential/launcher 逻辑进入 `lib/`，route 只做参数与响应包装。
- **可验证性**：SSH 配置生成、secret masking、vault 文件权限应有轻量测试脚本或纯函数测试。
- **安全默认值**：默认不启用 custom ProxyCommand；默认 host key 策略推荐 `ask/manualTrust`；默认不转发 agent。
- **跨平台**：本地 shell 已跨平台；SSH 功能要求系统存在 OpenSSH client。Windows 下优先使用 PATH 中 `ssh.exe`，文件权限校验降级为 best-effort。

## 未决问题

1. 是否接受系统 OpenSSH 作为必要依赖？
2. 是否允许 password/passphrase 存 vault 并自动 askpass，还是 MVP 仅支持 agent/private key，密码由用户在 terminal 中手输？
3. 默认 known_hosts 策略是否为 `ask`（推荐）还是 `accept-new`？
4. custom ProxyCommand 是否首版开放；若开放，是否需要全局 setting + profile 级二次确认？
