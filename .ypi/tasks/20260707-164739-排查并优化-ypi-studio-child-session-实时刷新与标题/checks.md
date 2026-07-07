# checks

## 需求覆盖检查

- [ ] 普通 chat 实时刷新链路未回归：`AgentSessionWrapper` + `/api/agent/[id]/events` 正常。
- [ ] SDK child audit tab 无 wrapper 时仍能刷新：child JSONL mtime/size 变化触发 reload。
- [ ] child audit tab 保持只读：无输入框、无 tool/model 控件、POST 非 abort 403。
- [ ] child SSE 不调用 `startRpcSession()`，不加载 YPI Studio / Browser Share web extensions。
- [ ] child 标题优先 Studio task title，badge/tooltip 保留 member/status/run/subtask。

## 自动验证

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:studio-sdk-runner
```

建议补充轻量测试：

- `displayTitleForSession()` child fallback 顺序。
- child title projection 在 task 存在/缺失时的返回值。
- `/api/agent/[id]/events` child header 分支不会调用 `startRpcSession()`（可用 helper 单测或手工断言）。

## 手工验收

1. 创建/运行 YPI Studio SDK child run。
2. 复制 child session id，用 URL 或 Sidebar 单独打开 child session。
3. 观察 child JSONL 持续增长时 UI 消息同步增长；无需父 Chat 可见。
4. child 完成后 header/task run 终态显示，SSE 停止或进入 idle，不反复重连。
5. Sidebar child row 显示任务标题；悬浮/徽标能看出 member/status/run。
6. 普通 chat streaming、agent_end 刷新、fork/navigate_tree 基本功能仍正常。

## 回归风险

- JSONL header rewrite 非原子，reload 需要容忍瞬时 parse error。
- `listAllSessions({ includeStudioChildren: true })` 被 usage 使用；title projection 不应默认增加重 I/O。
- 新 SSE event type 必须只在 child audit 分支使用，避免普通 chat handler 状态混乱。
- task.json 是 Studio 状态权威；若 header status stale，终态识别可能需要后续读取 run status。
