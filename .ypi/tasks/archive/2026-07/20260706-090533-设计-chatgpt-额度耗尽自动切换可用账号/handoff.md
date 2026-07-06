# Handoff — ChatGPT 额度耗尽自动切换可用账号

## 实现摘要

- 修复 YPI Studio 当前 session 绑定恢复问题：`lib/ypi-studio-tasks.ts` 不再无条件忽略 `pi_process_*` runtime pointer。
- 新增 `chatgpt.autoFailover` 配置，默认关闭，并接入 `pi-web.json` normalize/validate/patch。
- Settings → ChatGPT 新增“额度耗尽时自动切换可用账号”开关（MVP 只暴露 enabled）。
- 新增 `lib/chatgpt-account-failover.ts`：
  - 仅支持 `openai-codex`。
  - 只识别明确 quota/usage exhausted assistant error；普通 transient 429/rate-limit 不触发切号。
  - 使用 `globalThis` 进程级 mutex/cooldown 状态。
  - 在 agent run 开始前捕获 `triggerAccountId`，加锁后重读 active account；若已被其他 session 从 A 切走，则返回 `already_switched_by_other_session` 并只重试，不继续 B→C 级联切换。
  - 根据缓存/实时 quota 选择下一个可用 saved account。
  - 激活账号后触发 live RPC auth reload。
- `lib/rpc-manager.ts` 在 `AgentSessionWrapper` 中给 pi `AgentSession` 的 post-run retry 点安装 failover hook：在 `_runAgentPrompt` 开始前捕获本轮触发账号，在 pi 原始 post-run retry/compaction 逻辑返回 false 后再尝试 failover；成功切换或发现其他 session 已切换时移除错误 assistant message 并继续当前 agent run 一次。
- `hooks/useAgentSession.ts` 最小处理 `chatgpt_account_failover` 事件，在现有 retry info UI 中显示轻量提示。
- 更新 `docs/modules/api.md`、`docs/modules/frontend.md`、`docs/modules/library.md`。

## 关键保护

- 默认关闭：`DEFAULT_PI_WEB_CONFIG.chatgpt.autoFailover.enabled = false`。
- 防并发：`lib/chatgpt-account-failover.ts` 的进程级 lock 串行化 account switch。
- 防级联：agent run 开始前捕获触发账号，加锁后/激活前双重检查 active 是否仍是 trigger account。
- 防无限循环：每个 wrapper 维护 turn budget，默认最多 1 次 failover retry / 1 次 account switch。
- 不自动消费 reset credits。

## 验证

已运行：

```bash
npm install
npm install --include=dev
npm run lint
node_modules/.bin/tsc --noEmit
```

结果：`npm run lint` 与 `tsc --noEmit` 均通过。安装依赖时 npm 报告既有 peer dependency warning 与 audit vulnerabilities，未自动执行 `npm audit fix`。

检查员首轮 review 发现并已修复：

1. 触发账号不能在拿锁前现读；已改为在 `_runAgentPrompt` 开始前捕获并传入 failover。
2. 普通 transient 429/rate-limit 不应触发切号；已将错误识别收窄为明确 quota/usage exhausted。
3. failover 不应抢在 pi 内置 retry/compaction 前；已改为先调用原始 post-run 逻辑，只有其返回 false 时再尝试 failover。
