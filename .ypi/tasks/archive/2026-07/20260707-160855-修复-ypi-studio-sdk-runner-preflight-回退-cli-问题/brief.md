# Brief

修复 YPI Studio subagent SDK runner 在 `auto` 模式下因 preflight 失败回退 CLI 的问题。

已确认根因：`runYpiStudioSdkChildSession()` 在 `SessionManager.create()` 后立刻对 `childSessionFile` 调用 `writeSessionHeader()`，但 Pi SDK 此时尚未创建 JSONL 文件，导致 `ENOENT`。`auto` 因 preflight 失败回退 CLI，用户环境若未安装 CLI 会有严重可用性风险；同时 usage rollup 无法纳入 Studio child session。
