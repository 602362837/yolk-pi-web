# implement

## 建议执行顺序

| 顺序 | 子任务 | 主要文件 |
| --- | --- | --- |
| 1 | 增加 child audit SSE 分流，禁止 child 走 `startRpcSession()` | `app/api/agent/[id]/events/route.ts` |
| 2 | hook 支持 child audit SSE reload | `hooks/useAgentSession.ts`, `components/ChatWindow.tsx` |
| 3 | 增加 Studio child 标题 projection 与呈现 | `lib/types.ts`, `lib/session-title.ts`, `lib/session-reader.ts`, `app/api/sessions/[id]/route.ts`, `app/api/projects/[projectId]/spaces/[spaceId]/sessions/route.ts`, `components/SessionSidebar.tsx`, `lib/ypi-studio-child-session-runner.ts` |
| 4 | 文档与验证 | `docs/architecture/overview.md`, `docs/modules/api.md`, `docs/modules/frontend.md`, `docs/modules/library.md`, `scripts/test-ypi-studio-sdk-runner.mjs` 或新增 title 测试 |

## 需先阅读的文件

- `docs/architecture/overview.md`
- `docs/modules/api.md`
- `docs/modules/frontend.md`
- `docs/modules/library.md`
- `docs/standards/code-style.md`
- 本任务指定的源码文件。

## Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "summary": "让 YPI Studio SDK child audit session 单独打开时通过只读 JSONL audit SSE 实时刷新，并让 child 标题优先使用 Studio task title。",
  "maxConcurrency": 2,
  "subtasks": [
    {
      "id": "audit-sse-guard",
      "title": "为 child session 增加只读 audit SSE 分流",
      "phase": "api",
      "order": 10,
      "dependsOn": [],
      "files": ["app/api/agent/[id]/events/route.ts"],
      "instructions": [
        "在 resolveSessionPath 后先读取 header；若 header.studioChild 存在，直接返回 read-only audit stream。",
        "child 分支不得调用 startRpcSession，不得创建 ResourceLoader/AgentSessionWrapper。",
        "用 stat mtime/size watch 或 fs.watchFile 检测 JSONL 变化，发送 connected(mode=studio_child_audit)、studio_child_audit_changed、studio_child_audit_end。",
        "保留 heartbeat 和 abort/cancel cleanup；非 child 保持现有普通 agent SSE 行为。"
      ],
      "acceptance": [
        "对 child session 调用 /api/agent/:id/events 不会启动普通 AgentSession。",
        "child JSONL 追加时 SSE 至少发出一次 changed 事件。",
        "child 终态 header 写入后 SSE 发出 end 事件并清理 watcher。"
      ],
      "validation": [
        "curl -N /api/agent/<childId>/events 看到 connected mode=studio_child_audit。",
        "确认日志/断点中 startRpcSession 未被 child SSE 调用。"
      ],
      "risks": ["fs watch 可能重复/抖动；需要 debounce 和 idempotent reload。"],
      "parallelizable": true,
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "client-audit-refresh",
      "title": "useAgentSession 支持 child audit 实时 reload",
      "phase": "frontend",
      "order": 20,
      "dependsOn": ["audit-sse-guard"],
      "files": ["hooks/useAgentSession.ts", "components/ChatWindow.tsx"],
      "instructions": [
        "打开 session.studioChild 且状态 active 时连接 SSE，即使 includeState 没有 rpc wrapper。",
        "收到 studio_child_audit_changed 时调用 loadSession(sid,false) 刷新 messages/tree；失败时保留旧视图。",
        "收到 studio_child_audit_end 后最后 reload，关闭 EventSource，清除 running/phase，并触发 onAgentEnd 刷新列表。",
        "不要为 child 调 loadTools，不要启用 ChatInput/model/tool 控件。"
      ],
      "acceptance": [
        "单独打开 running child tab 能看到消息持续增加。",
        "child tab 保持只读 banner 和禁用输入。",
        "普通 chat 现有 streaming/fork/navigate 行为不变。"
      ],
      "validation": ["手工打开正在运行的 SDK child session tab 验证刷新。"],
      "risks": ["SessionManager.open 读到瞬时半写文件会报错；loadSession 的非 loading 刷新要容错。"],
      "parallelizable": false,
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "child-title-projection",
      "title": "Studio child session 标题优先显示 task title",
      "phase": "title",
      "order": 30,
      "dependsOn": [],
      "files": [
        "lib/types.ts",
        "lib/session-title.ts",
        "lib/session-reader.ts",
        "app/api/sessions/[id]/route.ts",
        "app/api/projects/[projectId]/spaces/[spaceId]/sessions/route.ts",
        "components/SessionSidebar.tsx",
        "lib/ypi-studio-child-session-runner.ts"
      ],
      "instructions": [
        "为 SessionInfo 增加可选 studioChildDisplay projection，包含 taskTitle/subtaskTitle/runSummary。",
        "服务端列表/detail接口对 UI 需要的 child session 从 task.json 解析 display projection；usage 等非 UI 扫描避免强制读取。",
        "displayTitleForSession 对 child 优先 taskTitle，再 run summary/header taskId/session name/firstMessage/id fallback。",
        "SessionSidebar 主标题使用 displayTitleForSession，badge 保留 member/status，tooltip 展示 run/subtask。",
        "runner 初始 session_info 可改为 task title fallback，但不要作为权威来源。"
      ],
      "acceptance": [
        "child row 主标题显示 Studio 任务名称。",
        "任务缺失或旧 child session 仍有稳定 fallback。",
        "普通 session 标题顺序不变。"
      ],
      "validation": ["新增/扩展 title fallback 轻量测试；手工检查 Sidebar child row。"],
      "risks": ["读取 task title 不应拖慢 usage/global session scans；用 option 或 UI route 才启用。"],
      "parallelizable": true,
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "docs-tests-validation",
      "title": "更新文档与验证脚本",
      "phase": "quality",
      "order": 40,
      "dependsOn": ["audit-sse-guard", "client-audit-refresh", "child-title-projection"],
      "files": [
        "docs/architecture/overview.md",
        "docs/modules/api.md",
        "docs/modules/frontend.md",
        "docs/modules/library.md",
        "scripts/test-ypi-studio-sdk-runner.mjs"
      ],
      "instructions": [
        "记录 child audit SSE 是 read-only file-follow，不创建 AgentSession、不注入 Studio orchestration tools。",
        "记录 SessionInfo child title projection 与 fallback。",
        "补充或新增轻量测试覆盖 child header/title fallback。"
      ],
      "acceptance": ["文档描述与实现一致；验证命令通过。"],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "npm run test:studio-sdk-runner",
        "必要时运行新增 title 测试"
      ],
      "risks": ["事件 kind / type 变更要同步搜索所有消费者。"],
      "parallelizable": false,
      "localReview": { "required": true, "reviewer": "checker" }
    }
  ]
}
```

## 验证命令

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:studio-sdk-runner
```

手工验证：

1. 启动一个 SDK child run。
2. 在新 tab/URL 打开 child session。
3. 确认消息列表实时增加，child 完成后停止刷新。
4. 尝试 `POST /api/agent/<childId>` 非 abort 命令仍为 403。
5. 确认 Sidebar child row 主标题为 Studio task title，badge 仍显示 member/status。
