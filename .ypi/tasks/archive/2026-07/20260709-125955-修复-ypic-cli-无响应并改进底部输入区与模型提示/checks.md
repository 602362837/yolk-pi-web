# checks

## 需求覆盖检查

- [ ] 启动提示包含 `ypic` 身份、cwd、server/version、session、当前模型/thinking、核心命令与 Web 配置入口。
- [ ] `/model` 被 CLI 显式处理，不再作为普通 prompt 静默发送。
- [ ] `/model current/list/<provider>/<modelId>/thinking` 或等效交互可用。
- [ ] 普通输入后立即显示 sending/waiting 状态，并能看到 SSE 流式输出或明确错误。
- [ ] 首条消息前 SSE connected 有等待/超时/警告策略。
- [ ] TTY 下底部输入区固定、与输出分隔、右侧显示当前模型/thinking。
- [ ] 非 TTY / `YPIC_PLAIN=1` / `NO_COLOR` 下 plain fallback 可用，无 ANSI 污染。
- [ ] `/studio-*` 仍透传；Studio approval 不被 CLI 自动批准。
- [ ] 文档更新覆盖新命令、新交互、fallback 与故障排查。

## UI / 审批检查

- [ ] UI 设计员已产出 HTML 原型（fenced `html` 或 task-local `.html`）。
- [ ] 原型覆盖启动、空闲、发送等待、`/model`、错误、fallback 状态。
- [ ] 主会话/用户已审批原型。
- [ ] 实现与审批后的原型一致；偏离处有记录。

## 质量检查

- [ ] `bin/ypic.js` 仍是 CommonJS，且不 import `lib/**` TypeScript。
- [ ] 未新增独立 session store 或 JSONL 格式。
- [ ] 未新增不必要 API；如新增 API 已更新 `docs/modules/api.md`。
- [ ] 模型值使用稳定 `provider/modelId`，不依赖 display name。
- [ ] thinking level 使用 `/api/models` 能力信息，错误可见。
- [ ] 发送、SSE、模型切换、退出路径都清理 timer/listener/readline 状态。
- [ ] 错误信息不泄露 token、API key、完整 env。

## 自动验证

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:ypic-cli
node bin/ypic.js --help
```

## 手工验收

1. 启动 ypi server：`npm run dev`。
2. 新终端运行 `node bin/ypic.js --port 30141`，检查启动提示、底部输入、模型状态。
3. 执行 `/model current`，应显示当前模型/thinking。
4. 执行 `/model list` 或交互选择，能看到可用模型列表。
5. 执行 `/model <provider>/<modelId> high`，成功后状态栏更新；Web 同 session 也能看到模型变化。
6. 输入“帮我看一下一级债动态表头的判定逻辑”，立即出现 waiting/streaming 状态，并最终有 assistant/tool 输出或明确错误。
7. 模拟模型/auth 错误，确认提示 `/config` 而非静默。
8. 运行中输入普通文本应按设计作为 steer 或提示使用 `/follow`；`/abort` 可中断。
9. `/studio-feature ...` 仍能创建/推进 Studio task，awaiting_approval 只提示不自动批准。
10. `YPIC_PLAIN=1 node bin/ypic.js --port 30141` 使用 plain fallback。
11. `node bin/ypic.js "hello" --port 30141` positional message 不丢首条响应。

## 回归风险

- 固定底栏与 readline 冲突导致中文输入、复制粘贴或 resize 异常。
- `/model` 拦截过宽，误伤 `/modelxxx` 或 Studio/prompt slash command。
- 等待 SSE connected 造成无 server/慢网络下新的阻塞。
- 模型切换期间 agent 正在运行导致状态不一致。
- 文档与实际 fallback 行为不一致。
