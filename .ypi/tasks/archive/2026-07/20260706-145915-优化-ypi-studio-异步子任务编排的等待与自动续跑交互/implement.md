# Implement：分阶段实现计划草案

> 规划产物，不进入实现。主会话应先让用户确认 PRD/Design/Implementation Plan，再保存 `implementationPlan` 并进入 `awaiting_approval`；实现必须等后续用户明确批准后启动。

## 建议实现顺序

| Order | ID | Phase | Title | Depends on | Parallel |
| --- | --- | --- | --- | --- | --- |
| 10 | `types-orchestrator-contract` | contract | 增加 orchestrator 类型、持久化与 projection 合约 | - | 否 |
| 20 | `extract-subagent-runner` | backend | 抽出 Studio child run runner，复用 prompt/progress/transcript 逻辑 | `types-orchestrator-contract` | 可与服务设计局部并行 |
| 30 | `orchestrator-service` | backend | 新增 implementation orchestrator service 与 tick/terminal callback | `types-orchestrator-contract`, `extract-subagent-runner` | 否 |
| 40 | `tool-api-control` | backend-api | 增加 tool/API start/pause/resume/cancel/status 控制面 | `orchestrator-service` | 否 |
| 50 | `chat-widget-status` | frontend | Chat/Session Widget 表达后台态、等待态、需要关注态 | `types-orchestrator-contract`, `tool-api-control` | 可与 Panel 并行 |
| 60 | `studio-panel-controls` | frontend | Studio Panel Implementation tab 增加 orchestrator 卡片和控制 | `types-orchestrator-contract`, `tool-api-control` | 可与 Chat/Widget 并行 |
| 70 | `docs-tests-validation` | validation | 更新文档、补充测试/手工验收，跑 lint/tsc | 全部 | 否 |

## 需先阅读的文件

- `docs/architecture/overview.md`
- `docs/modules/api.md`
- `docs/modules/frontend.md`
- `docs/modules/library.md`
- `docs/standards/code-style.md`
- `lib/ypi-studio-extension.ts`
- `lib/ypi-studio-tasks.ts`
- `lib/ypi-studio-types.ts`
- `lib/ypi-studio-subagent-runtime.ts`
- `lib/rpc-manager.ts`
- `components/AppShell.tsx`
- `components/ChatWindow.tsx`
- `components/YpiStudioSessionWidget.tsx`
- `components/YpiStudioPanel.tsx`
- `app/api/studio/tasks/[taskKey]/route.ts`
- `app/api/sessions/[id]/studio-task/route.ts`

## Machine-readable implementation plan draft

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "updatedAt": "2026-07-06T00:00:00.000Z",
  "sourceArtifact": "implement.md",
  "summary": "为 YPI Studio implementationPlan 增加受控自动续跑 orchestrator：approval 后按 DAG/maxConcurrency 自动派发单 subtask implementer runs，并在 Chat/Widget/Panel 明确显示后台态和需要关注态。",
  "strategy": "先落后端状态契约和 runner/orchestrator，再开放 tool/API 控制，最后补 UI 状态与验证。MVP 必须在用户批准后默认自动跑完整个 implementationPlan，并在实现完成后自动进入 checking 派发 checker；只有失败、等待用户或检查发现必须人工决策时进入 needs_attention。",
  "maxConcurrency": 2,
  "scheduler": {
    "mode": "dag",
    "strategy": "ready_fifo",
    "failFast": true,
    "defaultFailurePolicy": "block_dependents"
  },
  "execution": {
    "mode": "mixed",
    "maxParallel": 2,
    "groups": [
      {
        "id": "contract",
        "title": "状态契约",
        "relation": "serial",
        "dependencies": [],
        "subtaskIds": ["types-orchestrator-contract"]
      },
      {
        "id": "backend-core",
        "title": "后端核心自动续跑",
        "relation": "serial",
        "dependencies": ["types-orchestrator-contract"],
        "subtaskIds": ["extract-subagent-runner", "orchestrator-service", "tool-api-control"]
      },
      {
        "id": "frontend-status",
        "title": "前端状态表达",
        "relation": "parallel",
        "dependencies": ["tool-api-control"],
        "subtaskIds": ["chat-widget-status", "studio-panel-controls"]
      },
      {
        "id": "validation",
        "title": "验证和文档",
        "relation": "barrier",
        "dependencies": ["chat-widget-status", "studio-panel-controls"],
        "subtaskIds": ["docs-tests-validation"]
      }
    ]
  },
  "subtasks": [
    {
      "id": "types-orchestrator-contract",
      "title": "增加 orchestrator 类型、持久化与 projection 合约",
      "phase": "contract",
      "description": "定义 implementation orchestrator 的 optional 持久化状态和 projection，确保旧任务兼容。",
      "order": 10,
      "dependsOn": [],
      "relation": "serial",
      "files": [
        "lib/ypi-studio-types.ts",
        "lib/ypi-studio-tasks.ts",
        "lib/ypi-studio-session-link.ts"
      ],
      "instructions": [
        "新增 YpiStudioImplementationOrchestratorState / projection 类型，字段必须 optional 兼容旧任务。",
        "在 task detail 与 widget projection 中派生 mode/status/attention/activeRunIds/readySubtaskIds/blockedSubtaskIds/canStart/canPause/canResume。",
        "持久化建议放在 task.meta.implementationOrchestrator，不改变旧 implementationProgress 必填结构。",
        "旧任务缺失字段时显示 manual/idle。"
      ],
      "acceptance": [
        "GET studio task detail 对旧任务仍成功返回。",
        "新 projection 能表达 auto_running、paused、needs_attention、completed。",
        "TypeScript 类型无 any 泄漏，字段命名与现有 YPI Studio 类型风格一致。"
      ],
      "validation": [
        "node_modules/.bin/tsc --noEmit",
        "npm run lint"
      ],
      "risks": [
        "normalizer 丢弃未知字段导致状态不持久；需在 meta 层读写并测试。",
        "projection 太大影响 widget；widget 只携带 compact 字段。"
      ],
      "parallelizable": false,
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "extract-subagent-runner",
      "title": "抽出 Studio child run runner",
      "phase": "backend",
      "description": "将 ypi_studio_subagent 内部 child Pi 启动、prompt 构建、transcript/progress 逻辑抽到可复用 lib。",
      "order": 20,
      "dependsOn": ["types-orchestrator-contract"],
      "relation": "serial",
      "files": [
        "lib/ypi-studio-extension.ts",
        "lib/ypi-studio-subagent-runtime.ts",
        "lib/ypi-studio-subagent-runner.ts",
        "lib/ypi-studio-transcripts.ts",
        "lib/ypi-studio-policy.ts"
      ],
      "instructions": [
        "新增 lib/ypi-studio-subagent-runner.ts，导出 build prompt、start run、project run 的复用函数。",
        "保留 ypi_studio_subagent 现有 sync/async/poll/collect/cancel 行为，只改为调用 runner。",
        "child handle 增加 managedBy: chat | studio-orchestrator，并支持 onFinal schedule continuation callback。",
        "不要改变 transcript clipping / waiting_for_user / stderr/runtime limits 的语义。"
      ],
      "acceptance": [
        "现有同步 architect/implementer/checker delegation 行为不变。",
        "async start 仍立即返回 run projection，poll/collect 仍可用。",
        "runner 可由 orchestrator 在无 tool_call 上下文时启动单 subtask implementer。"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "手动运行一个同步 ypi_studio_subagent 和一个 async start/poll"
      ],
      "risks": [
        "抽取时破坏 onUpdate/progress 事件；需保留 tool adapter 回调。",
        "import cycle；runner 不应 import extension。"
      ],
      "parallelizable": false,
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "orchestrator-service",
      "title": "新增 implementation orchestrator service 与 tick/terminal callback",
      "phase": "backend",
      "description": "实现 process-global continuation registry、tick lock、DAG dispatch、terminal callback、watchdog 和 runtime_lost reconciliation。",
      "order": 30,
      "dependsOn": ["types-orchestrator-contract", "extract-subagent-runner"],
      "relation": "serial",
      "files": [
        "lib/ypi-studio-orchestrator.ts",
        "lib/ypi-studio-tasks.ts",
        "lib/ypi-studio-subagent-runtime.ts",
        "lib/rpc-manager.ts"
      ],
      "instructions": [
        "新增 start/pause/resume/cancel/status/tick/notifyRunTerminal 函数。",
        "tick 内必须重读 task detail、持有 per-task lock、检查 generation，使用现有 claim/update/record run helper。",
        "派发前计算 running+queued slots，不超过 maxConcurrency。",
        "失败、waiting_for_user、runtime_lost、manual validation、no_ready_with_unfinished 均进入 needs_attention 并停止派发；全部实现子任务完成后自动 transition 到 checking 并派发 checker。",
        "orchestrator-managed child run 不因 AgentSessionWrapper idle destroy 被误杀；显式 pause/cancel 才终止。"
      ],
      "acceptance": [
        "A->B/C DAG 中 A 成功后自动派发 B/C，无需用户输入。",
        "重复 tick 不产生重复 run。",
        "失败 run 后不继续派发依赖 subtask，并写入 attention。",
        "session_destroy 不终止 auto-run；用户 pause/cancel 可终止。"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "新增或扩展轻量 Studio scheduler/orchestrator 测试（如无测试框架则抽纯函数测试）"
      ],
      "risks": [
        "后台进程泄漏；必须有 registry cleanup 和 cancel path。",
        "跨进程重启只能 runtime_lost，MVP 不做 durable queue。",
        "并发锁错误可能造成状态丢失。"
      ],
      "parallelizable": false,
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "tool-api-control",
      "title": "增加 tool/API 自动续跑控制面",
      "phase": "backend-api",
      "description": "开放 ypi_studio_task actions 和 Studio task PATCH action，让主 session 与 UI 可启动/暂停/恢复/取消/查询 orchestrator。",
      "order": 40,
      "dependsOn": ["orchestrator-service"],
      "relation": "serial",
      "files": [
        "lib/ypi-studio-extension.ts",
        "app/api/studio/tasks/[taskKey]/route.ts",
        "app/api/studio/tasks/[taskKey]/subagents/[runId]/route.ts",
        "docs/modules/api.md"
      ],
      "instructions": [
        "为 ypi_studio_task 增加 implementation_autorun_start/status/pause/resume/cancel actions。",
        "为 task PATCH 增加同名 action 分支，复用 allowed roots/cwd 校验。",
        "错误结果必须可读：approval_required、task_not_implementing、no_plan 等。",
        "保留现有 poll/collect contract；可选 autoContinue 只作为兼容桥。"
      ],
      "acceptance": [
        "未 approval/未 implementing 时 start 不创建 run。",
        "Panel PATCH 能暂停/恢复 orchestrator。",
        "API docs 更新描述新 action 与 projection。"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "手工 curl/PATCH start-pause-resume-status"
      ],
      "risks": [
        "API action 名称过多；需在 UI 和 promptGuidelines 保持一致。",
        "错误时若部分写入状态会困住任务；操作需尽量原子化。"
      ],
      "parallelizable": false,
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "chat-widget-status",
      "title": "Chat 与 Session Widget 表达后台自动续跑状态",
      "phase": "frontend",
      "description": "将主 agentRunning 与 Studio background state 分离，让用户明确当前是等待/后台运行/需要关注。",
      "order": 50,
      "dependsOn": ["types-orchestrator-contract", "tool-api-control"],
      "relation": "parallel",
      "files": [
        "components/AppShell.tsx",
        "components/ChatWindow.tsx",
        "components/YpiStudioSessionWidget.tsx",
        "lib/ypi-studio-session-link.ts"
      ],
      "instructions": [
        "AppShell 的 Studio polling 条件加入 orchestrator working/needs_attention。",
        "Chat 区域增加 Studio background banner 或状态条：auto_running、manual_async_running、paused、needs_attention、completed。",
        "Chat input placeholder 提示后台运行中可等待或输入干预；普通 agentRunning false 不等于 Studio 已停止。",
        "Widget 显示 orchestrator badge、active/ready/blocked counts、attention message。"
      ],
      "acceptance": [
        "agentRunning=false 但 orchestrator auto_running 时，Chat 明确显示后台运行中。",
        "needs_attention 优先显示原因和打开 Studio 面板入口。",
        "Widget 轮询能看到 active runs 和 completed/paused 状态变化。"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "浏览器手工验收 Chat 状态文案"
      ],
      "risks": [
        "状态条过多干扰聊天；文案需短且可折叠。",
        "轮询过快增加负载；仅 working/needs_attention 时加快。"
      ],
      "parallelizable": true,
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "studio-panel-controls",
      "title": "Studio Panel 增加 orchestrator 状态卡片和控制",
      "phase": "frontend",
      "description": "在 Tasks detail/Implementation tab 展示自动续跑控制面、attention 原因和控制按钮。",
      "order": 60,
      "dependsOn": ["types-orchestrator-contract", "tool-api-control"],
      "relation": "parallel",
      "files": [
        "components/YpiStudioPanel.tsx",
        "lib/ypi-studio-types.ts"
      ],
      "instructions": [
        "Implementation tab 顶部增加自动续跑卡片，显示 mode/status/maxConcurrency/lastTick/active/ready/blocked/attention。",
        "任务列表增加 自动续跑中/已暂停/需要关注/实现完成待检查 chip。",
        "按钮根据 canStart/canPause/canResume/canCancel 显隐；操作走 PATCH action。",
        "failed/blocked/run transcript 链接复用现有 Subagents tab/route。"
      ],
      "acceptance": [
        "用户可从 Panel 用人话操作：开始后台推进、先停一下、继续跑、取消正在跑的任务。",
        "needs_attention 展示关联 subtask/run 和推荐下一步。",
        "旧任务没有 orchestrator 字段时 UI 不报错。"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "浏览器手工验收 Panel controls"
      ],
      "risks": [
        "按钮和 workflow gate 语义冲突；后端必须最终拒绝非法 start。",
        "面板刷新时布局抖动；遵循现有 background refresh 模式。"
      ],
      "parallelizable": true,
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "docs-tests-validation",
      "title": "文档、测试与人工验收",
      "phase": "validation",
      "description": "更新 docs/modules 与 architecture 说明，补充自动续跑测试和关键浏览器人工验收。",
      "order": 70,
      "dependsOn": ["chat-widget-status", "studio-panel-controls"],
      "relation": "barrier",
      "files": [
        "docs/architecture/overview.md",
        "docs/modules/api.md",
        "docs/modules/frontend.md",
        "docs/modules/library.md",
        "docs/standards/code-style.md",
        "package.json"
      ],
      "instructions": [
        "更新 YPI Studio invariants：approval gate、orchestrator lifecycle、managedBy abort 语义。",
        "更新 API/frontend/library module maps。",
        "新增或扩展测试脚本覆盖 DAG readiness、maxConcurrency、failure attention、旧任务兼容。",
        "运行 lint、tsc、相关 Studio 测试，并记录手工验收。"
      ],
      "acceptance": [
        "文档描述与实现一致。",
        "lint、tsc 通过。",
        "手工场景：自动续跑 happy path、实现完成后自动进入 checking、失败 needs_attention、停止/继续、未 approval start 拒绝。"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "npm run test:studio-policy",
        "新增测试命令（如实现了）"
      ],
      "risks": [
        "没有完整测试框架；尽量将 scheduler/orchestrator 决策抽纯函数测试。",
        "文档遗漏导致未来 agent 误用手动 poll/collect。"
      ],
      "parallelizable": false,
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    }
  ]
}
```

## 验证命令

最小验证：

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:studio-policy
```

若新增专门测试脚本，补充到 `docs/standards/code-style.md` 并在最终检查中运行。

## 评审门禁

- 已确认产品口径：用户批准开始实现后默认后台自动推进；实现完成后自动进入 checking；面向用户使用“先停一下/继续跑/取消正在跑的任务”等人话，不暴露 Abort 等内部术语。
- 后端必须先有非法状态拒绝测试，再接 UI controls。
- UI 文案必须明确区分主 Chat 回合结束与 Studio 后台仍在运行。
- 不得引入绕过 `awaiting_approval` 的快捷路径。

## 回滚方案

- 将 `implementation_autorun_*` actions 隐藏/禁用，保留已有手动 `poll/collect`。
- 新增 orchestrator 字段为 optional，不需要迁移旧 task。
- 如后台 runner 出现问题，可将 active orchestrator 标为 `paused/needs_attention`，不影响已有 task artifact 和 subagent transcript。
## 修正后的实现原则

本任务不应大规模替换现有 Studio 状态机。实现应采用主 Chat continuation loop：

- 主 Chat 在派发并行子任务后进入 `waiting_for_studio_children` 运行态，不进入 stopped/idle。
- 子任务完成后唤醒同一主 session，由主 session 继续执行 `collect -> update subtask -> implementation_next -> claim/dispatch -> checking/completed`。
- Studio workflow 状态机仍由主 session 通过现有 transition/update API 推进，避免子任务或独立后台服务绕过门禁。
- UI 文案使用“正在等待并行子任务”“后台仍在工作”“需要你处理”，不使用内部 runtime 术语。
