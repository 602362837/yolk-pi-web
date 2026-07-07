# ui

## 是否需要 UI 设计员

需要，但不阻塞后端契约设计。建议 UI 设计员后续重点原型化：

- Terminal header 的 local/SSH 新建入口。
- SSH Profile/Credential 管理表单。
- Jump chain 可视化与错误提示。
- Secret 脱敏与危险操作确认。
- known_hosts fingerprint 信任流程。

## 现有 UI 边界

`components/TerminalPanel.tsx` 当前已经承担：

- bottom dock collapse/close/fullscreen/resize。
- 多 tab 与 split pane 布局。
- 每个 tab 一个 `TerminalSessionView`，通过 `/api/terminal/sessions` 创建 session，通过 SSE/input/resize route 交互。
- tab 状态只有本地 `cwd`、`shell`、`backend`、`status`、`error`。

新增设计应复用这些能力，不重写 xterm 与 split layout。

## 新增用户入口

### Terminal dock header

建议将现有 `+` 改为下拉或 split button：

- `+ Local Terminal`：保持现有行为，使用当前 workspace `cwd`。
- `+ SSH Profile...`：打开 profile picker。
- `Manage SSH Profiles`：跳转 Settings → Terminal → SSH。

Header 状态展示：

- active local tab：显示 `cwd`、shell/backend、status。
- active SSH tab：显示 `SSH · <profileLabel>`、`<user>@<host>:<port>`、proxy/jump 小徽标、status。

### SSH profile picker

Profile picker 用于快速开 SSH tab：

- 搜索 profile label/host/user。
- 显示连接摘要：`user@host:port`、credential label、jump count、proxy type、known_hosts 状态。
- 缺失 credential / disabled / dangerous custom proxy 未确认时置灰并给出原因。
- 提供 `Open`、`Test`、`Edit`。

### Tab 展示

`TerminalTabState` 应增加 tab kind：

- Local: `Terminal 1` 或用户 rename。
- SSH: 默认 label `SSH: <profileLabel>`。
- tooltip：local 显示 cwd；SSH 显示 profile、target、jump chain、proxy type，不显示 secret。
- status dot 沿用 starting/connected/error；SSH 连接失败在 pane 顶部显示错误 banner。

## Settings → Terminal → SSH 管理

在现有 Terminal section 下新增 SSH 子区块，建议分为三块：

### 1. SSH Profiles

表格字段：

- Label
- Target：`user@host:port`
- Credential：credential label / missing
- Jump：`0`、`jump1 → jump2`
- Proxy：none / socks5 / http / custom
- Known hosts policy/status
- Actions：Open、Test、Edit、Duplicate、Delete

Profile 编辑表单：

- 基础：label、host、port、username、credential。
- 高级：connect timeout、server alive interval、forwardAgent（默认 off）、knownHostsPolicy。
- Jump chain：可增删排序，每一行 host/port/user/credential；拖拽或上/下按钮排序。
- Proxy：none/socks5/http/custom；host/port；proxy credential；custom command textarea。
- 风险提示：custom command、agent forwarding、password auto-fill 均显示黄色/红色 warning。

### 2. Credentials

Credential 列表只显示 summary：

- Label
- Type：agent / identity file / imported private key / password / private key + passphrase / proxy auth
- Username default（如果保存）
- Secret summary：`has private key`、`has password`、`fingerprint SHA256:...`、`updatedAt`
- Used by：profile/jump 引用数
- Actions：Edit metadata、Replace secret、Delete

Credential 编辑原则：

- secret 输入框永远空白占位，不回填已有 secret。
- 保存时如果 secret field 留空，表示不改变已有 secret。
- “Replace secret” 单独按钮，避免误清空。
- 删除被引用 credential 时要求确认，并列出引用 profile。

### 3. Known Hosts

Known hosts UI：

- 展示 dedicated known_hosts 文件路径 label：`~/.pi/agent/terminal/known_hosts`。
- 对 profile 提供 `Scan fingerprint`（best-effort）和 `Trust`。
- 显示 fingerprint：key type、SHA256 fingerprint、source host。
- 允许删除单条 host key。
- 说明：`ssh-keyscan` 只能帮助展示，不等同于可信认证；用户应从可信渠道核对 fingerprint。

## 连接测试交互

Profile `Test` 建议分三档：

1. **Validate**：本地校验 profile/schema/credential 引用，不发网络请求。
2. **Resolve config**：生成脱敏版 SSH 命令/配置预览，检查 `ssh` binary、temp 文件写入权限。
3. **Network test**：可选执行短超时 SSH 测试或 host key scan；不会返回 secret，失败时返回分类错误。

UI 不展示完整临时 config，只展示脱敏摘要；可在 Debug 折叠区显示 redacted OpenSSH options。

## 安全提示文案要点

- `pi-web.json` 保存 profile 与非 secret 配置；私钥、密码、代理密码保存在独立 vault。
- custom ProxyCommand 会在运行 ypi 的本机执行命令，等价于本地 shell 权限；只对可信命令开启。
- Host key 第一次信任前请核对 fingerprint；`accept-new` 方便但可能接受被劫持的首次连接。
- Agent forwarding 默认关闭；开启后远端可请求使用本机 agent。

## 需要原型化的问题

1. Jump chain 使用表格还是链路卡片；长链如何紧凑展示。
2. Credential 被 target/jump/proxy 多处引用时，删除确认信息如何清晰。
3. known_hosts trust flow 是否放在 profile test 结果弹窗中完成。
4. Terminal `+` 下拉是否在移动端/窄屏仍可用。
