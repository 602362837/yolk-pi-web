# handoff

## 本轮完成

完成 reopened 子任务 `profile-api-validation`：补齐 dedicated SSH profile CRUD routes，确保 create/update 在 API 边界拒绝 secret 字段，并保留现有 profile test route 行为。此前 `tests-docs-security-review` 的文档、安全边界检查、轻量 dry-run 测试脚本和验证也已完成。

## 变更文件

- `scripts/test-terminal-ssh-config.mjs` — 新增 Web Terminal SSH config/security dry-run 检查，覆盖 `terminal.ssh` 默认值、profile secret 字段拒绝、credential summary 脱敏、known_hosts HostKeyAlias、OpenSSH config/redacted plan、ProxyCommand 门禁、proxy helper secret 边界和 temp cleanup 假设。
- `package.json` — 新增 `npm run test:terminal-ssh` 脚本。
- `app/api/terminal/ssh/credentials/route.ts` — 补齐 credential summary list/create API，create 接收 secret 但只返回 summary。
- `app/api/terminal/ssh/credentials/[id]/route.ts` — 补齐 credential summary get/update/delete API，删除被引用 credential 返回 references。
- `lib/terminal-ssh-profiles.ts` — 新增 dedicated profile CRUD helper，校验 target/jump/proxy/options，递归拒绝 private key/password/passphrase/proxy password 等 secret 字段，并通过 `pi-web.json` 只保存非 secret profile 配置。
- `app/api/terminal/ssh/profiles/route.ts` — 新增 profile list/create API，create 只返回非 secret profile。
- `app/api/terminal/ssh/profiles/[id]/route.ts` — 新增 profile read/update/delete API，update 复用 route-level validation，delete 不触碰 credential vault。
- `app/api/terminal/ssh/profiles/[id]/test/route.ts` — 补齐 profile validate/resolve 预检 API，resolve 仅返回 redacted launch plan。
- `docs/architecture/overview.md` — 新增 Web Terminal SSH architecture/security boundary：`pi-web.json` 非 secret、vault、临时文件、known_hosts、custom ProxyCommand。
- `docs/operations/troubleshooting.md` — 新增 SSH terminal 排障、vault/known_hosts/temp cleanup/ProxyCommand 注意事项。
- `docs/standards/code-style.md` — 记录 `test:terminal-ssh` 轻量脚本。
- `docs/modules/api.md` — 记录 dedicated profile CRUD routes。
- `docs/modules/library.md` — 记录 `lib/terminal-ssh-profiles.ts`。

## 验证

- `npm run lint` — 通过。
- `node_modules/.bin/tsc --noEmit` — 通过。
- `node scripts/test-terminal-ssh-config.mjs` / `npm run test:terminal-ssh` — 通过。

## 安全 Review 结论

- Dedicated profile API 路径：`lib/terminal-ssh-profiles.ts` 对 create/update payload 递归拒绝 `privateKey/privateKeyPem/password/passphrase/proxyPassword`，并只返回 `TerminalSshProfile` 非 secret 字段。
- `pi-web.json` 路径：`lib/pi-web-config.ts` 对 `terminal.ssh.profiles` 递归拒绝 `privateKey/privateKeyPem/password/passphrase/proxyPassword`，默认 `terminal.ssh.enabled=false`、`allowCustomProxyCommand=false`、`defaultKnownHostsPolicy=ask`、`applyTerminalEnvToSsh=false`。
- Vault/API 路径：credential secrets 存 `~/.pi/agent/terminal-secrets/`，API 返回 `TerminalCredentialSummary`/`has*` flags；新增 credential routes 不回显 secret。
- Runner 路径：OpenSSH 命令行只传 `-F <temp-config> <alias>`；proxy auth 与 askpass secret 经 0600 temp context/helper；redacted plan 不含 secret 值。
- UI 路径：Terminal tab/picker 使用 profile id/label/target summary；credential editor secret 输入框不回填。
- ProxyCommand：默认禁用，要求全局开关 + profile acknowledgement；校验拒绝 control chars 与 `{{secret:*}}`。
- known_hosts：使用 dedicated `~/.pi/agent/terminal/known_hosts`，默认策略 `ask`，文档说明 `ssh-keyscan` 仅辅助展示。

## 剩余风险 / 主会话决策

- 未进行真实 SSH、多级跳板、SOCKS5/HTTP 代理的端到端手工连接矩阵；当前脚本为 dry-run/source-boundary 检查。
- 本地文件 vault 不是加密 keychain；如安全要求提高需后续接 OS keychain。
- Password/passphrase askpass 仍依赖 OpenSSH/平台，需保留手输 fallback。
- custom ProxyCommand 是否首版向用户开放、host key `ask` 是否最终确认，仍需主会话/产品确认。
