# checks

## 需求覆盖检查

- [ ] 多个 SSH profile：可创建、编辑、删除、禁用、选择打开。
- [ ] Credential 复用：同一 credential 可被多个 profile/host 引用。
- [ ] 目标机与每级 jump host 可使用不同 credential。
- [ ] 多级 ProxyJump：按 jumpHosts 顺序连接。
- [ ] SOCKS5 proxy：可配置 host/port，认证 secret 不进命令行/pi-web。
- [ ] HTTP CONNECT proxy：可配置 host/port，认证 secret 不进命令行/pi-web。
- [ ] Custom ProxyCommand：默认禁用，开启有双确认，拒绝 secret placeholder/control chars。
- [ ] 本地 terminal 保留：旧 API body 与 UI `+ Local` 正常。
- [ ] 多 tab 混合：local/ssh tab 可在同一 dock 和 split pane 中共存。
- [ ] Web Terminal disabled 时 local/ssh 均不能启动。

## 数据与安全检查

### `pi-web.json` 边界

允许出现：

- profile label/id/enabled。
- host/port/username。
- credentialId 引用。
- jump host 拓扑。
- proxy type/host/port。
- custom command template（非 secret，且危险确认）。
- known_hosts policy、timeout、serverAlive、forwardAgent。

禁止出现：

- private key PEM。
- SSH password。
- private key passphrase。
- proxy password/token。
- 带 userinfo/password 的 proxy URL。
- 展开后的 secret ProxyCommand。

检查方式：

- [ ] 创建 privateKey/password/proxyAuth credential 后，grep `~/.pi/agent/pi-web.json` 不含 secret 样本。
- [ ] GET profile/credential API response 不含 secret 字段和值。
- [ ] 浏览器 Network response 不含 secret。

### Vault / secret storage

- [ ] `~/.pi/agent/terminal-secrets/` mode 0700（Windows best-effort）。
- [ ] credential secret file mode 0600（Windows best-effort）。
- [ ] list API 只返回 summary/has* flags/fingerprint。
- [ ] replace secret 不会在 UI 回填旧 secret。
- [ ] 删除被引用 credential 默认 409。

### 临时文件

- [ ] SSH session temp dir mode 0700。
- [ ] imported key / askpass context / proxy context mode 0600。
- [ ] close tab / close dock / process exit 后 temp dir 清理。
- [ ] 服务启动清理过期 temp dir。
- [ ] OpenSSH 命令行参数不包含 password/private key/proxy password。

### known_hosts

- [ ] dedicated known_hosts 位于 `~/.pi/agent/terminal/known_hosts`，不在 `pi-web.json`。
- [ ] HostKeyAlias 使用稳定 host:port，不使用 session alias。
- [ ] default policy 与 UI 文案一致。
- [ ] `accept-new` 或 unsafe 策略有明确警告。

### ProxyCommand

- [ ] custom ProxyCommand 默认不可选或 disabled。
- [ ] 开启需要全局 setting 与 profile acknowledgement。
- [ ] 拒绝 newline/NUL/control chars。
- [ ] 拒绝 `{{secret:*}}` 或任何 secret 占位符。
- [ ] UI 展示“本机会执行此命令”的高风险提示。

## 自动验证

实现后运行：

```bash
npm run lint
node_modules/.bin/tsc --noEmit
node scripts/test-terminal-ssh-config.mjs
```

建议 `scripts/test-terminal-ssh-config.mjs` 覆盖：

- 旧 terminal config normalize 兼容。
- profile validation：端口、host、username、jump order、secret 字段拒绝。
- credential summary redaction。
- vault path/mode best-effort。
- 多级 ProxyJump ssh_config 生成。
- SOCKS5/HTTP proxy helper command 不含 secret。
- custom ProxyCommand 风险门禁。
- known_hosts HostKeyAlias 生成。

## 手工验收矩阵

### Local terminal 回归

- [ ] Terminal disabled：按钮/API 按预期拒绝。
- [ ] Terminal enabled：打开本地 tab。
- [ ] 新建多个 local tab、rename、close。
- [ ] split pane 拖拽移动 tab。
- [ ] resize/fullscreen/collapse 不报错。
- [ ] `initialInput` 仍只注入 active tab。

### Direct SSH

- [ ] agent/default credential direct SSH。
- [ ] identityFile credential direct SSH。
- [ ] imported private key credential direct SSH。
- [ ] password credential：askpass 支持时自动；不支持时可手输 fallback。
- [ ] known_hosts 缺失时按策略提示/拒绝/接受。

### Multi-hop

- [ ] target + 1 jump。
- [ ] target + 2 jumps。
- [ ] target 和 jumps 使用不同 username/credential。
- [ ] jump credential 缺失时 profile picker 与 API 都提示 invalid。

### Proxy

- [ ] SOCKS5 无认证。
- [ ] HTTP CONNECT 无认证。
- [ ] SOCKS5/HTTP 有认证：secret 不在命令行/pi-web/API。
- [ ] custom ProxyCommand disabled 状态。
- [ ] custom ProxyCommand enabled 后可连接可信命令。

### Mixed tabs

- [ ] 同一 dock 中 local + SSH direct + SSH jump 三个 tab。
- [ ] mixed tabs split/drag/close 后 session cleanup 正常。
- [ ] SSH tab error 不影响 local tab。

## 回归风险重点

- `TerminalSessionView` useEffect 依赖新增 kind/profileId 后重复创建 session。
- SettingsConfig 保存完整 terminal config 时丢失旧字段或覆盖 chatgpt/studio/trellis。
- terminal.env 泄漏到 SSH/custom ProxyCommand。
- OpenSSH stderr 把临时路径或 redacted plan 混入用户可见错误；路径可接受，secret 不可接受。
- Windows 下 chmod best-effort 不应导致功能完全不可用，但 UI 应提示权限保护有限。

## 人工评审门禁

- [x] Checker 做 secret boundary review。（静态审查 + dry-run 验证）
- [ ] Checker 做 local terminal regression review。
- [ ] 主会话确认 host key 默认策略。
- [ ] 主会话确认 password/passphrase auto-fill 策略。
- [ ] 主会话确认 custom ProxyCommand 首版是否开放。

## Checker update

- 已运行：`npm run lint`、`node_modules/.bin/tsc --noEmit`、`npm run test:terminal-ssh`，均通过。
- 已静态确认：credential API 不回显 secret、known_hosts 为独立文件、proxy helper/askpass 通过临时 context 文件传 secret、SSH resolve API 返回 redacted plan。
- 尚未覆盖：真实 SSH / 多级 jump / SOCKS5 / HTTP 代理 / mixed tabs 的手工端到端矩阵。
- 阻塞项：profile CRUD 仍未按 design/implement 落成 dedicated route，当前主要依赖 `/api/web-config` 间接保存。
