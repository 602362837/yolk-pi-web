# brief

## 任务目标

基于现有 Web Terminal 多 tab / split pane 能力，设计可落地的 SSH 连接能力：

- 支持多个 SSH profile，并允许每个 tab 在 local / SSH profile 之间混合打开。
- 支持可复用 credential，目标机与每级 jump host 可使用不同 credential。
- 支持多级 ProxyJump。
- 支持指定 SOCKS5 / HTTP 代理，以及受控的 custom ProxyCommand。
- 保留当前本地 terminal 行为和 API 兼容性。
- 明确配置与 secret 的存储边界、脱敏、临时文件、known_hosts、ProxyCommand 风险控制。

## 当前实现依据

已阅读并以当前代码为边界：

- `AGENTS.md`
- `docs/modules/frontend.md`
- `docs/modules/api.md`
- `docs/modules/library.md`
- `docs/standards/code-style.md`
- `components/TerminalPanel.tsx`
- `components/SettingsConfig.tsx` 的 Terminal 设置区段
- `lib/terminal-manager.ts`
- `lib/pi-web-config.ts`
- `app/api/terminal/**`
- `app/api/web-config/route.ts`
- `lib/allowed-roots.ts`
- `lib/cwd.ts`

关键现状：

- `TerminalPanel.tsx` 已有多 tab、split pane、rename、关闭确认、SSE 输出、输入/resize 转发；tab 当前只表达本地 `cwd` 与 `sessionId`。
- `POST /api/terminal/sessions` 当前只接收 `{ cwd, cols, rows }` 并创建本地 shell。
- `lib/terminal-manager.ts` 已有统一 `TerminalProcess` 抽象、terminal setting gate、cwd allowed roots 校验、PTY/script/pipe fallback、SSE fan-out、idle cleanup。
- `lib/pi-web-config.ts` 当前把 Web Terminal enablement、shell、env、env assistant 存在 `~/.pi/agent/pi-web.json`；终端 env 明文保存，UI 已提示不要放长期密钥。

## 推荐总方案

采用 OpenSSH 原生命令方案作为首版：后端继续通过 `node-pty` 启动本地进程，但 SSH tab 启动的是系统 `ssh`，由后端为每个 SSH session 生成临时 `ssh_config`、临时 key/askpass/proxy helper 文件，并通过现有 xterm/SSE 通道交互。

理由：

- 与当前 terminal-manager 的进程抽象最兼容。
- OpenSSH 原生支持 PTY、ProxyJump、ProxyCommand、known_hosts、ssh-agent、IdentityFile、系统 SSH 配置习惯。
- 无需在应用内重新实现 SSH 协议、channel、host key 生态。

代价与约束：

- 保存密码/私钥 passphrase 的自动填充需要 `SSH_ASKPASS` helper，跨平台与 OpenSSH 版本存在差异；必须作为受控能力并提供交互式 fallback。
- custom ProxyCommand 本质是执行本机命令，必须默认禁用或强警告，不允许 secret 占位符直接展开到命令行。
- host key 信任必须有专用 known_hosts 文件与可审计 UI，避免静默接受 MITM。

## 产物

本轮只产出 Studio 设计 artifact，不修改生产代码：

- `prd.md`
- `ui.md`
- `design.md`
- `implement.md`（含 `json ypi-implementation-plan` 草案）
- `checks.md`
- `handoff.md`

## 主会话待决策

1. 是否接受“OpenSSH + 临时配置/helper”作为首版架构，而不是引入 `ssh2` 并自实现 SSH channel？
2. SSH 密码 / key passphrase 是否允许保存到本地 secret vault 并由 askpass 自动填充？推荐允许但默认需显式开启，并保留手输 fallback。
3. host key 默认策略选 `ask/manual trust`（推荐）还是 `accept-new`（更省事但 MITM 风险更高）？
4. custom ProxyCommand 是否首版开放？推荐开放但默认 off、profile 级强警告、禁止 secret 注入。
