# checks

## 需求覆盖检查

- [ ] `package.json` 同时暴露 `ypi` 与 `ypic`，且 `ypi` 现有参数/自动开浏览器行为不回归。
- [ ] `ypic` 默认使用 `process.cwd()` 创建/绑定 session，JSONL header cwd 正确。
- [ ] `ypic` 优先复用已运行 ypi server；无 server 时给出手动启动指引；端口冲突有明确错误。
- [ ] CLI 只提供 chat 内操作和少量控制命令，不实现复杂配置 UI。
- [ ] `/config` 或等价命令能打开 Web 页面进行模型、认证、Studio 成员策略等配置。
- [ ] `/studio-*` slash commands 可通过 CLI 驱动现有 Studio extension。
- [ ] CLI 能提示 plan-review 路径/Web URL，但不绕过用户审批 gate。
- [ ] 文档说明 `ypi` / `ypic` 定位、用法、限制、验证方式。

## 质量检查

- [ ] `bin/ypic.js` 和公共 runner 是 Node 可直接执行的 JS，不依赖未编译 TS。
- [ ] SSE parser 能处理 chunk 边界、空行、多条 event、非 JSON/异常事件。
- [ ] 工具/Studio 事件摘要有字段缺失容错，不输出超大 raw JSON。
- [ ] Ctrl-C / abort / process exit 清理 EventSource/fetch/readline/child process。
- [ ] `ypic` 不自启 server；退出时不管理 server 生命周期，有后台 Studio run 时提示用户改到 Web 查看。
- [ ] 新增 `/api/cli/health` 不泄露 secrets，且 route 文档已同步。
- [ ] 当前 cwd 尚未加入项目时，`ypic` 会自动建立/注册对应 project/space 上下文，且基于 canonical path 去重。

## 自动验证

最低：

```bash
npm run lint
node_modules/.bin/tsc --noEmit
node bin/ypic.js --help
```

如新增测试脚本：

```bash
node scripts/test-ypic-cli.mjs
```

发布前：

```bash
npm pack --dry-run
```

## 手工验收

1. `ypi --port 30141` 仍能启动 Web 并自动打开浏览器。
2. `ypic --port 30141` 在已有 server 时复用，不再启动第二个 server。
3. 无 server 时运行 `ypic`，会给出明确提示，引导用户先手动启动 `ypi`/Web server。
4. 在一个尚未加入项目的目录运行 `ypic`，发送消息后 Web 中可打开同一 session，cwd 匹配，且项目上下文已自动建立/注册。
5. 发送 `/config`，浏览器打开 ypi Web 页面。
6. 发送 `/studio-feature <小目标>`，确认 Studio task 创建/推进，CLI 显示 task/status/plan-review 提示，Web Studio 面板可查看详情。
7. 任务处于 `awaiting_approval` 时，只有用户在 chat 中明确确认后才允许进入实现；查看 `task.json` 中 approval gate/grant 记录。
8. 有 Studio child run 运行时退出 CLI，server 不被误杀并打印可继续查看的 Web URL。

## 回归风险重点

- `ypi` bin 被重构后启动失败或不再自动开浏览器。
- `ypic` 使用直接 SDK 路径导致 Studio extension/approval/usage 与 Web 不一致。
- CLI 首条消息未先连接 SSE，早期响应丢失。
- 端口 30141 被其他服务占用时误以为 ypi server。
- 当前目录自动注册项目时产生重复项目或 pathKey 异常。
- 为了 CLI 配置便利引入 Web deep link/设置弹窗行为变化，从而扩大 UI 范围。
