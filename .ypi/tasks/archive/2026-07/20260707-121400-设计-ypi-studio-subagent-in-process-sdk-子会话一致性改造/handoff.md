# handoff

## 本轮返工产物

已针对 checker 阻塞项补齐核心链路：SDK runner、child header 生成、guard 接线、Sidebar/Chat 只读审计入口，并更新文档。

主要代码改动：

- `lib/ypi-studio-child-session-runner.ts`：新增真实 in-process SDK child runner。创建持久 child JSONL，写入 `studioChild` header，继承父 session project/space，接入 `createYpiStudioChildGuardExtension()`，订阅 SDK events 并映射 progress/transcript/run projection，支持 abort/finalize/header terminal status。
- `lib/ypi-studio-extension.ts`：`runner=sdk` 不再抛错；`auto` 优先 SDK，若 SDK preflight 在 prompt 发送前失败则回退 CLI；run/progress/final 真实填充 `runner`、`childSessionId`、`childSessionFile`、`requestAffinity`。
- `app/api/projects/[projectId]/spaces/[spaceId]/sessions/route.ts`：项目空间会话接口默认仍不把 child 当 root，但返回父 session 下可折叠发现的 child rows。
- `app/api/agent/[id]/route.ts`：拒绝对 `studioChild` audit session 发送普通 Chat POST，避免 child 会话被继续为普通 Studio-enabled Chat。
- `components/SessionSidebar.tsx`：child sessions 以 Studio audit row 形式嵌套在父会话下，显示 member/status/run 信息。
- `components/ChatWindow.tsx`：打开 child session 时显示只读审计提示，并禁用输入区。
- `docs/modules/api.md`、`docs/modules/frontend.md`、`docs/modules/library.md`：更新实际 SDK runner、session API、Sidebar/Chat 行为说明。

## 验证

已运行并通过：

```bash
node_modules/.bin/tsc --noEmit
npm run lint
npm run test:studio-policy
npm run test:studio-dag
```

`npm run test:studio-dag` 仍有 Node experimental loader warning，但测试通过。

## 剩余风险

- 尚未执行真实 provider SDK child run smoke；需要在可用模型/auth 环境中启动一次 `runner=sdk` Studio run，检查 child JSONL header、task run metadata、wait/cancel 和 Sidebar/只读视图。
- SDK event shape 可能随 pi 版本变化；当前 mapper 兼容常见 `agent_*`、`message_*`、`tool_execution_*` 事件。
- `bash` 直接改 `.ypi/tasks/**/task.json` 仍只能 best-effort 阻断；根本防线仍是父会话 approval gate、review 和验证。

## 需要主会话决定

- 是否现在安排真实 SDK Studio child run smoke test。
- `auto` 模式的 SDK preflight 失败是否保持回退 CLI，或在下一版切换为强提示用户显式选择。
