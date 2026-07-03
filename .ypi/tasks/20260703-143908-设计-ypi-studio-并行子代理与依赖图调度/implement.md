# implement

## 执行原则

- 先由主会话保存本 implementationPlan 草案，再进入/保持 `awaiting_approval`，等待用户明确确认后才能实现。
- 不绕过 `awaiting_approval -> implementing` approvalGate/approvalGrant。
- 以兼容扩展为主：保留现有单子任务 claim/update 和同步 `ypi_studio_subagent`。
- 先做 server-side pure DAG/scheduler，再做 async runtime，再做 API/UI projection。

## 需先阅读的文件

- `docs/architecture/overview.md`
- `docs/modules/api.md`
- `docs/modules/frontend.md`
- `docs/modules/library.md`
- `docs/standards/code-style.md`
- `lib/ypi-studio-types.ts`
- `lib/ypi-studio-tasks.ts`
- `lib/ypi-studio-extension.ts`
- `lib/ypi-studio-subagent-runtime.ts`
- `lib/ypi-studio-transcripts.ts`
- `lib/ypi-studio-session-link.ts`
- `app/api/studio/tasks/[taskKey]/route.ts`
- `components/YpiStudioPanel.tsx`
- `components/YpiStudioSessionWidget.tsx`
- `components/YpiStudioSubagentTranscript.tsx`
- `components/ChatWindow.tsx`
- `hooks/useAgentSession.ts`

## 实现拆解（人类可读）

| Order | ID | Title | Depends on | Phase | Parallel |
| --- | --- | --- | --- | --- | --- |
| 10 | dag-contracts | 定义 DAG/status/tool 类型契约 | — | contracts | 否 |
| 20 | dag-scheduler-core | 实现 DAG normalize/validate/ready/propagation | dag-contracts | scheduler | 否 |
| 30 | task-tool-api-extensions | 扩展 task 工具/API 的批量 claim/update | dag-scheduler-core | server-api | 可与 async-runtime 并行 |
| 40 | async-runtime | 扩展子代理 runtime registry 和后台 child finalizer | dag-contracts | runtime | 可与 task-tool-api-extensions 并行 |
| 50 | subagent-tool-async | 扩展 ypi_studio_subagent start_async/poll/collect/cancel | dag-scheduler-core, async-runtime | runtime-tool | 否 |
| 60 | api-widget-projection | 扩展 task/session projection 和 run cancel/read API | subagent-tool-async | api-projection | 否 |
| 70 | studio-panel-ui | Studio panel 全量 DAG/status 可见 | api-widget-projection | frontend | 可与 widget-chat-ui 并行 |
| 80 | widget-chat-ui | Widget + Chat async run/progress 展示 | api-widget-projection, subagent-tool-async | frontend | 可与 studio-panel-ui 并行 |
| 90 | docs-and-tests | 文档、测试、验证脚本 | dag-scheduler-core, subagent-tool-async, studio-panel-ui, widget-chat-ui | validation | 否 |
| 100 | manual-rollout-checks | 手工验收和回滚确认 | docs-and-tests | release-check | 否 |

## 机器可读 implementationPlan 草案

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "sourceArtifact": "implement.md",
  "summary": "兼容扩展 YPI Studio：以 subtasks.dependsOn 为 DAG 调度真源，增加批量 ready/claim、异步 subagent runId 生命周期和 UI 全量可见。",
  "strategy": "先稳定 server-side DAG 与 async runtime，再扩展 API projection 和 UI；默认同步行为与 approvalGate 保持兼容。",
  "maxConcurrency": 3,
  "execution": {
    "mode": "mixed",
    "maxParallel": 3,
    "groups": [
      {
        "id": "contracts",
        "title": "类型与契约",
        "relation": "serial",
        "dependencies": [],
        "subtaskIds": ["dag-contracts"]
      },
      {
        "id": "server-core",
        "title": "DAG 调度核心",
        "relation": "serial",
        "dependencies": ["dag-contracts"],
        "subtaskIds": ["dag-scheduler-core"]
      },
      {
        "id": "runtime-and-api",
        "title": "异步 runtime 与工具/API",
        "relation": "parallel",
        "dependencies": ["dag-scheduler-core"],
        "subtaskIds": ["task-tool-api-extensions", "async-runtime"]
      },
      {
        "id": "subagent-async",
        "title": "异步 subagent 工具整合",
        "relation": "barrier",
        "dependencies": ["task-tool-api-extensions", "async-runtime"],
        "subtaskIds": ["subagent-tool-async"]
      },
      {
        "id": "projection",
        "title": "API 与 widget projection",
        "relation": "serial",
        "dependencies": ["subagent-tool-async"],
        "subtaskIds": ["api-widget-projection"]
      },
      {
        "id": "ui-parallel",
        "title": "Panel 与 Chat/Widget UI",
        "relation": "parallel",
        "dependencies": ["api-widget-projection"],
        "subtaskIds": ["studio-panel-ui", "widget-chat-ui"]
      },
      {
        "id": "validation",
        "title": "文档、自动验证、手工验收",
        "relation": "serial",
        "dependencies": ["studio-panel-ui", "widget-chat-ui"],
        "subtaskIds": ["docs-and-tests", "manual-rollout-checks"]
      }
    ]
  },
  "subtasks": [
    {
      "id": "dag-contracts",
      "title": "定义 DAG/status/tool 类型契约",
      "phase": "contracts",
      "order": 10,
      "dependsOn": [],
      "relation": "serial",
      "files": [
        "lib/ypi-studio-types.ts",
        "docs/architecture/overview.md",
        "docs/modules/api.md",
        "docs/modules/library.md"
      ],
      "instructions": [
        "扩展 implementationPlan/implementationProgress 类型，加入 schemaVersion 2、waiting/queued/failed、多 active/runIds、waitingOn/blockedBy、scheduler 元数据。",
        "保留 pending/ready/running/done/blocked/skipped 旧状态兼容；pending 在 UI 语义上等同 waiting。",
        "定义 ypi_studio_subagent action/mode/runId 输入输出契约，但不改变默认同步行为。"
      ],
      "acceptance": [
        "现有 schemaVersion 1 task 类型仍能通过 TypeScript 编译。",
        "新字段均为兼容扩展或通过 normalize 兜底，不要求现有 task.json 迁移。",
        "文档说明 DAG 真源是 subtasks.dependsOn，execution.groups 只用于展示。"
      ],
      "validation": [
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "状态 union 扩展会影响多个 switch/statusTone；需要全仓搜索状态字符串。"
      ],
      "parallelizable": false,
      "localReview": {
        "required": false,
        "reviewer": "checker"
      }
    },
    {
      "id": "dag-scheduler-core",
      "title": "实现 DAG normalize/validate/ready/propagation",
      "phase": "scheduler",
      "order": 20,
      "dependsOn": ["dag-contracts"],
      "relation": "serial",
      "files": [
        "lib/ypi-studio-tasks.ts",
        "scripts/test-ypi-studio-dag.mjs",
        "package.json"
      ],
      "instructions": [
        "在 normalizeImplementationPlan 中支持 schemaVersion 2 的严格 DAG 校验：重复 id、缺失依赖、自依赖、环均报错。",
        "新增 pure helper：selectReadyYpiStudioImplementationSubtasks(plan, progress, limit)、refreshDerivedImplementationDAG、propagateBlockedDependents。",
        "保留 selectNextYpiStudioImplementationSubtask 作为返回首个 ready 的兼容 wrapper。",
        "扩展 counts、activeSubtaskIds、queuedSubtaskIds、nextSubtaskIds，并将 queued/running 计入并发占用。",
        "增加 task 级 in-process mutex，串行化 claim/update/reconcile。"
      ],
      "acceptance": [
        "串行链、并行 fan-out、混合 fan-in/fan-out 都能正确产生 ready batch。",
        "依赖 failed/blocked 后默认阻塞后继节点，不影响无关分支。",
        "旧 pending 计划读取后可继续使用，UI/summary 不丢失。"
      ],
      "validation": [
        "npm run test:studio-dag",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "当前写 task.json 无跨进程锁；首版 mutex 只能覆盖同 Node 进程并发。"
      ],
      "parallelizable": false,
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "task-tool-api-extensions",
      "title": "扩展 task 工具/API 的批量 claim/update",
      "phase": "server-api",
      "order": 30,
      "dependsOn": ["dag-scheduler-core"],
      "relation": "parallel",
      "parallelGroup": "runtime-and-api",
      "files": [
        "lib/ypi-studio-extension.ts",
        "lib/ypi-studio-tasks.ts",
        "lib/ypi-studio-types.ts",
        "app/api/studio/tasks/[taskKey]/route.ts"
      ],
      "instructions": [
        "扩展 ypi_studio_task implementation_next 支持 limit/includeWaitingReasons，但旧调用仍返回单个 next。",
        "新增 claim_implementation_subtasks 或兼容扩展 claim_implementation_subtask(limit/subtaskIds)，批量将 ready 节点置 queued/running。",
        "update_implementation_subtask 支持 queued/failed/waiting、blockedBy、terminationReason。",
        "所有 claim/start/update running/done/failed/blocked 继续要求 task.status=implementing。"
      ],
      "acceptance": [
        "未获 approval 的 awaiting_approval 任务无法 claim 或 start 实现子任务。",
        "批量 claim 不会超过 maxConcurrency。",
        "REST PATCH 与 Pi tool validator 行为一致。"
      ],
      "validation": [
        "npm run test:studio-dag",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "LLM 可能仍按旧流程一次 claim 一个；需更新 promptGuidelines 提醒并行调度循环。"
      ],
      "parallelizable": true,
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "async-runtime",
      "title": "扩展子代理 runtime registry 和后台 child finalizer",
      "phase": "runtime",
      "order": 40,
      "dependsOn": ["dag-contracts"],
      "relation": "parallel",
      "parallelGroup": "runtime-and-api",
      "files": [
        "lib/ypi-studio-subagent-runtime.ts",
        "lib/ypi-studio-extension.ts",
        "lib/ypi-studio-transcripts.ts",
        "lib/rpc-manager.ts",
        "app/api/agent/[id]/route.ts"
      ],
      "instructions": [
        "将 registry handle 扩展为 active async run：taskId、subtaskId、member、parentSessionId、status、progress、promise/result、abort。",
        "抽出 runChildPi 共同 engine，使其可 await 同步结果，也可作为后台 promise finalizer。",
        "后台 finalizer 节流写 task run progress；最终写 succeeded/failed/cancelled/waiting_for_user。",
        "扩展 abortYpiStudioChildRunsForSession：取消进程同时写回 run/subtask 取消状态。",
        "实现 registry 丢失时的 runtime_lost reconcile 设计入口。"
      ],
      "acceptance": [
        "async child 启动后父 execute 可立即返回 runId。",
        "父会话 abort/destroy 会取消当前 session 关联的 async children。",
        "child 结束后即使父会话不 poll，task.json/subagents/transcript 也有最终状态。"
      ],
      "validation": [
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "Next dev hot reload 会清 registry；必须用 runtime_lost 清晰降级。",
        "频繁 task.json 写入可能造成抖动；进展写入必须节流。"
      ],
      "parallelizable": true,
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "subagent-tool-async",
      "title": "扩展 ypi_studio_subagent start_async/poll/collect/cancel",
      "phase": "runtime-tool",
      "order": 50,
      "dependsOn": ["dag-scheduler-core", "async-runtime"],
      "relation": "barrier",
      "files": [
        "lib/ypi-studio-extension.ts",
        "lib/ypi-studio-tasks.ts",
        "lib/ypi-studio-types.ts"
      ],
      "instructions": [
        "扩展 ypi_studio_subagent 参数 action/mode/runId/runIds/cancelReason。",
        "默认无 action/mode 的旧输入保持同步 await 行为。",
        "start_async 校验 task/subtask/claim/approval，记录 runId 与 queued/running run 后立即返回。",
        "poll 返回 task.json + registry + transcript projection；collect 收割完成结果并刷新 DAG；cancel 调用 registry abort 并写取消结果。",
        "implementer 有 implementationPlan 且未传 subtaskId 时继续拒绝执行完整任务。"
      ],
      "acceptance": [
        "同一父会话可连续启动多个 start_async，父工具调用不会等待第一个完成。",
        "runId 持久记录在 task.subagents 与 subtask runIds/lastRunId。",
        "failed/cancelled/waiting_for_user 正确映射到 subtask failed/blocked 并释放/阻塞后继。"
      ],
      "validation": [
        "npm run test:studio-dag",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "工具 schema 变复杂，需保持错误消息清楚，避免 LLM 误用 poll/start。"
      ],
      "parallelizable": false,
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "api-widget-projection",
      "title": "扩展 task/session projection 和 run cancel/read API",
      "phase": "api-projection",
      "order": 60,
      "dependsOn": ["subagent-tool-async"],
      "relation": "serial",
      "files": [
        "lib/ypi-studio-session-link.ts",
        "app/api/sessions/[id]/studio-task/route.ts",
        "app/api/studio/tasks/[taskKey]/route.ts",
        "app/api/studio/tasks/[taskKey]/subagents/[runId]/transcript/route.ts",
        "app/api/studio/tasks/[taskKey]/subagents/[runId]/route.ts"
      ],
      "instructions": [
        "Task detail projection 输出全量 subtasksWithStatus、waitingOn、blockedBy、runsBySubtask、statusCounts。",
        "Widget projection 输出状态计数和所有非终态/失败子任务摘要；done 通过计数表达。",
        "如需要 UI cancel，新增 subagent run route 的 GET/PATCH 或 DELETE；transcript route 保持只读。",
        "Session widget task resolver 在 task 有 queued/running runs 时支持轮询刷新。"
      ],
      "acceptance": [
        "Studio panel 无需自行重新计算复杂 DAG 依赖即可展示 waiting 原因。",
        "Widget 可以同时显示 running/queued/waiting/failed 摘要。",
        "API 不返回完整 artifact body/transcript，保持 bounded projection。"
      ],
      "validation": [
        "node_modules/.bin/tsc --noEmit",
        "手工 GET /api/studio/tasks/[taskKey]?cwd=... 检查 projection"
      ],
      "risks": [
        "Projection 字段增多可能扩大响应；需要 bounded 摘要和 UI 懒加载 transcript。"
      ],
      "parallelizable": false,
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "studio-panel-ui",
      "title": "Studio panel 全量 DAG/status 可见",
      "phase": "frontend",
      "order": 70,
      "dependsOn": ["api-widget-projection"],
      "relation": "parallel",
      "parallelGroup": "ui-parallel",
      "files": [
        "components/YpiStudioPanel.tsx",
        "components/YpiStudioDagView.tsx",
        "lib/ypi-studio-types.ts"
      ],
      "instructions": [
        "Implementation tab 改为总览统计 + 状态泳道/表格 + 子任务详情，默认显示所有子任务。",
        "waiting/pending 行展示 waitingOn 依赖 id/title/status；failed/blocked 行展示 blockedBy、runId、error/blockedReason。",
        "Subagents tab 按 subtask/run 状态分组，显示 queued/running/done/failed/cancelled/waiting_for_user。",
        "保留现有选中子任务详情，不再作为唯一可见入口。"
      ],
      "acceptance": [
        "用户可在一个视图中看到所有 running/queued/waiting/done/failed 子任务。",
        "pending/waiting 的依赖原因清晰可见。",
        "大型任务可滚动/过滤，不出现布局跳动。"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "浏览器手工检查 Studio panel task detail"
      ],
      "risks": [
        "DAG 图过复杂时可能影响可读性；首版以表格/泳道兜底。"
      ],
      "parallelizable": true,
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "widget-chat-ui",
      "title": "Widget + Chat async run/progress 展示",
      "phase": "frontend",
      "order": 80,
      "dependsOn": ["api-widget-projection", "subagent-tool-async"],
      "relation": "parallel",
      "parallelGroup": "ui-parallel",
      "files": [
        "components/YpiStudioSessionWidget.tsx",
        "components/YpiStudioSubagentTranscript.tsx",
        "components/ChatWindow.tsx",
        "components/AppShell.tsx",
        "hooks/useAgentSession.ts"
      ],
      "instructions": [
        "Widget 展示状态计数和所有非终态/失败子任务摘要，并点击定位 Panel。",
        "Subagent transcript/card 支持 async start：显示 runId、queued/running 状态、poll/collect 指引，不把无 final output 当失败。",
        "ChatWindow/AppShell 在当前 Studio task 有 queued/running runs 时短周期刷新 task projection，完成后降频。",
        "保持 display/truncation 只是信息说明，不影响 run severity。"
      ],
      "acceptance": [
        "异步启动多个子代理后，widget/chat 能看到多个 run 同时 running/queued。",
        "已完成/失败状态会在不刷新整页的情况下更新到 widget/panel。",
        "截断说明仍为 neutral display note。"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "浏览器手工启动 mock/真实 Studio task 检查 widget/chat"
      ],
      "risks": [
        "过度轮询会增加请求；需要只在 active queued/running 时启用并降频。"
      ],
      "parallelizable": true,
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "docs-and-tests",
      "title": "文档、测试、验证脚本",
      "phase": "validation",
      "order": 90,
      "dependsOn": ["dag-scheduler-core", "subagent-tool-async", "studio-panel-ui", "widget-chat-ui"],
      "relation": "serial",
      "files": [
        "docs/architecture/overview.md",
        "docs/modules/api.md",
        "docs/modules/frontend.md",
        "docs/modules/library.md",
        "docs/standards/code-style.md",
        "package.json",
        "scripts/test-ypi-studio-dag.mjs"
      ],
      "instructions": [
        "更新架构/API/frontend/library 文档，记录 DAG、async run、UI projection、approval gate 不变。",
        "新增 npm script test:studio-dag，覆盖 serial、parallel、mixed、cycle、failure propagation、concurrency。",
        "确保 test:studio-policy 仍通过。"
      ],
      "acceptance": [
        "文档准确列出新增 tool/API 行为和 UI 模块。",
        "自动测试覆盖关键 ready/blocked/concurrency 规则。",
        "lint、tsc、test:studio-policy、test:studio-dag 全部通过。"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "npm run test:studio-policy",
        "npm run test:studio-dag"
      ],
      "risks": [
        "测试脚本若 import TS 源不便，需沿用现有 mjs 风格或抽纯 JS fixture。"
      ],
      "parallelizable": false,
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "manual-rollout-checks",
      "title": "手工验收和回滚确认",
      "phase": "release-check",
      "order": 100,
      "dependsOn": ["docs-and-tests"],
      "relation": "serial",
      "files": [
        "docs/operations/troubleshooting.md",
        "docs/architecture/overview.md"
      ],
      "instructions": [
        "手工创建包含串行、并行、fan-in/fan-out 的 Studio task，验证 approval 前不能启动，approval 后并发执行。",
        "验证 failed/blocked 传播、cancel、runtime_lost 降级和 retry。",
        "记录回滚方式：停止使用 async mode，旧同步 path 仍可工作。"
      ],
      "acceptance": [
        "手工验收记录覆盖 approval gate、并发启动、UI 全量可见、失败传播、取消。",
        "回滚说明明确且不依赖数据库迁移。"
      ],
      "validation": [
        "手工浏览器验收",
        "API curl/浏览器网络检查"
      ],
      "risks": [
        "真实 child Pi 运行耗时较长，可先用短 prompt 验证。"
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

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:studio-policy
npm run test:studio-dag
```

## 检查门禁

- 所有 implementation subtask mutation 都必须验证主任务处于 `implementing`。
- 所有新状态必须被 UI status tone、summary counts、projection、JSON validator 覆盖。
- `ypi_studio_subagent` 旧输入必须仍同步工作。
- UI 必须能解释 waiting/pending 原因，不能只显示“pending”。
- 失败/取消不能让父会话或 UI 无限等待。
