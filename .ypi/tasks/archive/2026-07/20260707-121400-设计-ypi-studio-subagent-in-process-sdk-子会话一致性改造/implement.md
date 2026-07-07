# implement

## 执行步骤

1. 先做小而安全的 CLI fallback 修复，解除 PATH 依赖。
2. 定义 child session header / SessionInfo / run metadata 契约。
3. 新增 SDK child runner，与现有 CLI runner 并存，通过 config/feature flag 选择。
4. 将 SDK events 映射到现有 progress/transcript/runtime/wait/cancel。
5. 加强 child 隔离：不注入 Studio tools，阻断递归工具，保持 approval gate 只在父 session 生效。
6. 扩展 session-reader/API/Sidebar/Studio Panel 展示 child session，默认隐藏或折叠。
7. 补模型/thinking/affinity diagnostics、兼容迁移、测试与文档。

## 需先阅读的文件

- `docs/architecture/overview.md`
- `docs/modules/api.md`
- `docs/modules/library.md`
- `docs/modules/frontend.md`
- `docs/integrations/README.md`
- `node_modules/@earendil-works/pi-coding-agent/docs/sdk.md`
- `node_modules/@earendil-works/pi-coding-agent/docs/session-format.md`
- `node_modules/@earendil-works/pi-coding-agent/docs/json.md`
- `node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
- `lib/rpc-manager.ts`
- `lib/ypi-studio-extension.ts`
- `lib/ypi-studio-subagent-runtime.ts`
- `lib/ypi-studio-transcripts.ts`
- `lib/ypi-studio-policy.ts`
- `lib/ypi-studio-tasks.ts`
- `lib/session-reader.ts`
- `components/SessionSidebar.tsx`

## 人类可读子任务表

| id | phase | title | deps | parallel |
| --- | --- | --- | --- | --- |
| `cli-bundled-fallback` | safety | 修复 CLI fallback 路径解析 | - | 是 |
| `child-session-contract` | contract | 定义 child session/header/run 类型契约 | - | 是 |
| `sdk-runner-core` | runtime | 新增 SDK child session runner | child-session-contract | 否 |
| `sdk-progress-runtime` | runtime | SDK event → progress/transcript/wait/cancel | sdk-runner-core | 否 |
| `child-guard-approval` | safety | 递归工具隔离与 approval gate 防护 | sdk-runner-core | 是 |
| `session-reader-sidebar` | ui-api | session-reader/API/Sidebar child 展示 | child-session-contract | 是 |
| `policy-affinity` | model | 模型/thinking 与 request affinity diagnostics | sdk-runner-core | 是 |
| `migration-config` | rollout | 兼容旧 run、runner config、fallback 策略 | sdk-progress-runtime, child-guard-approval | 否 |
| `tests-docs-rollout` | validation | 测试、文档、手工验收 | all | 否 |

## Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "sourceArtifact": "implement.md",
  "summary": "将 YPI Studio subagent 从 CLI spawn 迁移到 in-process SDK child session，同时保留 CLI fallback、旧 transcript 兼容、approval gate 和默认隐藏的 child session 历史。",
  "strategy": "先安全修 CLI fallback，再建立 child session 契约和 SDK runner；UI/API 与策略诊断可并行；最后灰度、测试和文档收口。",
  "maxConcurrency": 3,
  "scheduler": {
    "mode": "dag",
    "strategy": "ready_fifo",
    "failFast": false,
    "defaultFailurePolicy": "block_dependents"
  },
  "execution": {
    "mode": "mixed",
    "maxParallel": 3,
    "groups": [
      {
        "id": "safe-start",
        "title": "安全起步",
        "relation": "parallel",
        "dependencies": [],
        "subtaskIds": ["cli-bundled-fallback", "child-session-contract"]
      },
      {
        "id": "sdk-core",
        "title": "SDK runner 核心",
        "relation": "serial",
        "dependencies": ["child-session-contract"],
        "subtaskIds": ["sdk-runner-core", "sdk-progress-runtime"]
      },
      {
        "id": "parallel-hardening",
        "title": "安全、UI/API、策略并行增强",
        "relation": "parallel",
        "dependencies": ["sdk-runner-core"],
        "subtaskIds": ["child-guard-approval", "session-reader-sidebar", "policy-affinity"]
      },
      {
        "id": "rollout",
        "title": "兼容迁移与验证",
        "relation": "serial",
        "dependencies": ["sdk-progress-runtime", "child-guard-approval", "session-reader-sidebar", "policy-affinity"],
        "subtaskIds": ["migration-config", "tests-docs-rollout"]
      }
    ]
  },
  "subtasks": [
    {
      "id": "cli-bundled-fallback",
      "title": "修复 bundled CLI fallback 路径解析",
      "phase": "safety",
      "order": 10,
      "dependsOn": [],
      "files": [
        "lib/ypi-studio-extension.ts",
        "package.json",
        "docs/operations/troubleshooting.md"
      ],
      "instructions": [
        "将 resolvePiCli() 改为优先解析本项目依赖中的 @earendil-works/pi-coding-agent/dist/cli.js，可用 require.resolve 或 getPackageDir，而不是只依赖 npm_config_prefix/PATH。",
        "保留 PATH 中 pi 作为最后 fallback。",
        "不要改变默认 --mode json -p --no-session 行为；这是 SDK runner 前的快速安全修复。"
      ],
      "acceptance": [
        "无全局 pi 时仍可通过 node <local cli.js> 启动旧 CLI runner。",
        "已有全局 pi 环境行为不变。",
        "stderr/JSON event cap 与现有 runChildPi 行为不变。"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "手工临时移除 PATH pi 后启动一个 Studio architect run"
      ],
      "risks": [
        "require.resolve 在打包发布环境中路径不同；需覆盖 npm package 安装后的 ypi 场景。"
      ],
      "parallelizable": true,
      "localReview": { "required": false, "reviewer": "checker" }
    },
    {
      "id": "child-session-contract",
      "title": "定义 Studio child session/header/run 类型契约",
      "phase": "contract",
      "order": 20,
      "dependsOn": [],
      "files": [
        "lib/types.ts",
        "lib/ypi-studio-types.ts",
        "docs/architecture/overview.md",
        "docs/modules/library.md"
      ],
      "instructions": [
        "扩展 SessionHeader/SessionInfo optional studioChild，包含 parentSessionId、taskId、runId、member、subtaskId、runner、visibility、status、createdAt/finishedAt。",
        "扩展 YpiStudioTaskSubagentRun optional runner/childSessionId/childSessionFile/requestAffinity。",
        "文档明确 task.json 是 workflow/run 状态权威，child JSONL 是审计和 affinity 载体。"
      ],
      "acceptance": [
        "旧 session header 和旧 task run 缺失新字段时类型与读取兼容。",
        "新字段不会要求迁移已有 .ypi task。",
        "设计文档说明 standard parentSession 与 studioChild.parentSessionId 的区别。"
      ],
      "validation": [
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "Pi SessionManager 类型不包含自定义 header 字段；实现需通过安全 header patch 并确保未知字段不破坏读取。"
      ],
      "parallelizable": true,
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "sdk-runner-core",
      "title": "新增 in-process SDK child session runner",
      "phase": "runtime",
      "order": 30,
      "dependsOn": ["child-session-contract"],
      "files": [
        "lib/ypi-studio-child-session-runner.ts",
        "lib/ypi-studio-extension.ts",
        "lib/rpc-manager.ts",
        "lib/session-project-link.ts"
      ],
      "instructions": [
        "新增 runner abstraction，使 ypi_studio_subagent 可选择 cli/sdk。",
        "SDK runner 使用 SessionManager.create(root, undefined, { parentSession: parentSessionFile }) 创建持久 child session。",
        "创建后 patch header 写 studioChild，并继承父 session projectId/spaceId。",
        "使用 DefaultResourceLoader 创建 child profile，但不注入 createYpiStudioExtension/createBrowserShareExtension。",
        "调用 createAgentSession()，设置 session name，执行 session.prompt(childPrompt)，terminal 后 dispose。"
      ],
      "acceptance": [
        "一个 SDK child run 会生成一个可解析 JSONL session file。",
        "child header 正确关联 parentSession/taskId/runId/member/subtaskId。",
        "同步 ypi_studio_subagent 仍返回最终 output，async mode 仍立即返回 runId。"
      ],
      "validation": [
        "node_modules/.bin/tsc --noEmit",
        "手工启动 architect sync run 并检查 child session JSONL header"
      ],
      "risks": [
        "同进程 SDK child 共享 Node 进程资源，必须确保 dispose/abort 不影响父 session。"
      ],
      "parallelizable": false,
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "sdk-progress-runtime",
      "title": "SDK events 映射 progress/transcript/runtime/wait/cancel",
      "phase": "runtime",
      "order": 40,
      "dependsOn": ["sdk-runner-core"],
      "files": [
        "lib/ypi-studio-child-session-runner.ts",
        "lib/ypi-studio-subagent-runtime.ts",
        "lib/ypi-studio-transcripts.ts",
        "lib/ypi-studio-extension.ts",
        "app/api/studio/tasks/[taskKey]/subagents/[runId]/route.ts"
      ],
      "instructions": [
        "将现有 CLI parseLine 逻辑抽成 event-object mapper，直接消费 AgentSession.subscribe() events。",
        "保持 phase/tokens/tps/currentTool/itemsPreview/warnings/display/terminationReason 字段语义不变。",
        "runtime handle 增加 childSessionId/childSessionFile/runner，并支持 abort 回调调用 AgentSession.abort()。",
        "finalizer 写 task.subagents、transcript meta、studioChild header terminal 状态，并 unregister runtime。",
        "ypi_studio_wait/poll/collect/cancel 对 SDK 与 CLI run 使用同一 projection。"
      ],
      "acceptance": [
        "SDK child streaming 时 Chat tool live update 与旧 CLI runner 等价。",
        "取消 SDK child run 后 task.json/transcript/runtime/header 均为 cancelled 或一致 terminal 状态。",
        "runtime_lost reconciliation 对 SDK run 仍可降级为 failed(runtime_lost)。"
      ],
      "validation": [
        "node_modules/.bin/tsc --noEmit",
        "手工启动 async run 后 ypi_studio_wait 等待 terminal",
        "手工取消 running SDK child run"
      ],
      "risks": [
        "SDK events 没有 CLI stdout header 行；实现需补一条 child session created status item。"
      ],
      "parallelizable": false,
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "child-guard-approval",
      "title": "递归工具隔离与 approval gate 防护",
      "phase": "safety",
      "order": 50,
      "dependsOn": ["sdk-runner-core"],
      "files": [
        "lib/ypi-studio-child-session-runner.ts",
        "lib/ypi-studio-extension.ts",
        "lib/ypi-studio-tasks.ts",
        "docs/architecture/overview.md"
      ],
      "instructions": [
        "新增 child guard extension：阻断 ypi_studio_task/ypi_studio_subagent/ypi_studio_wait/Browser Share action tools，以及已知 Trellis subagent tools。",
        "不要使用 process.env 作为 SDK child 隔离机制；改用显式 ResourceLoader/profile。",
        "child run 不写 task.contextIds，不记录 approvalGrant，不注册 continuation callback。",
        "可选阻断 edit/write 到 .ypi/tasks/**/task.json；bash 命令做 best-effort 文本检测。",
        "确认 claim/start/update 实现子任务仍只允许 task.status=implementing。"
      ],
      "acceptance": [
        "child session 中 Studio tools 不可用或调用被 block。",
        "awaiting_approval 状态下 child 无法启动 implementer 或写 approvalGrant。",
        "父 session continuation payload 使用 parentSessionId，不使用 childSessionId。"
      ],
      "validation": [
        "npm run test:studio-dag",
        "node_modules/.bin/tsc --noEmit",
        "手工让 child 尝试调用/提及 ypi_studio_task，确认不可执行"
      ],
      "risks": [
        "bash 对 task.json 的直接写入难以完全阻断；需依赖 prompt、guard best-effort 和 checker review。"
      ],
      "parallelizable": true,
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "session-reader-sidebar",
      "title": "session-reader/API/Sidebar 支持默认隐藏和父级折叠 child session",
      "phase": "ui-api",
      "order": 60,
      "dependsOn": ["child-session-contract"],
      "files": [
        "lib/session-reader.ts",
        "lib/session-project-link.ts",
        "app/api/sessions/route.ts",
        "app/api/projects/[projectId]/spaces/[spaceId]/sessions/route.ts",
        "app/api/sessions/[id]/route.ts",
        "components/SessionSidebar.tsx",
        "components/ChatWindow.tsx"
      ],
      "instructions": [
        "listAllSessions 读取 header.studioChild，并支持默认过滤 child root。",
        "Project space sessions route 默认 sessions 排除 child，额外返回 child counts/map 供 Sidebar 展开。",
        "SessionSidebar 父 session 行展示 Studio child count/status badge；展开后显示 child rows。",
        "child session 打开为只读审计视图，ChatInput 禁用并提示回到父 session 继续。",
        "legacy exact-cwd 未分配列表排除 studioChild，避免污染普通项目历史。"
      ],
      "acceptance": [
        "创建多个 child sessions 后普通项目历史不会新增多个 root 会话。",
        "父 session 下可看到折叠 Studio child 列表和 running/done/failed 标记。",
        "直接打开 child session 可读但不能作为普通主 Chat 继续。"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "浏览器手工检查 Sidebar 展开/隐藏/只读"
      ],
      "risks": [
        "现有 fork child tree 与 Studio child tree 需避免视觉混淆。"
      ],
      "parallelizable": true,
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "policy-affinity",
      "title": "模型/thinking 策略与 request affinity diagnostics",
      "phase": "model",
      "order": 70,
      "dependsOn": ["sdk-runner-core"],
      "files": [
        "lib/ypi-studio-policy.ts",
        "lib/ypi-studio-child-session-runner.ts",
        "lib/ypi-studio-types.ts",
        "components/YpiStudioSubagentTranscript.tsx"
      ],
      "instructions": [
        "保持 resolveYpiStudioMemberPolicy precedence 不变。",
        "SDK runner 用 parent ctx.modelRegistry 解析 policy.modelArg；找不到时 warning 并 fallback Pi default。",
        "传递 policy.thinkingArg 到 createAgentSession thinkingLevel。",
        "run/header 记录 requestAffinity：parentSessionId、childSessionId、providerSessionIdSource=childSessionId、model/thinking source。",
        "UI 展示 SDK child session 与 affinity note，避免误以为完全复用父 provider session id。"
      ],
      "acceptance": [
        "followMain 下 child 使用主 Chat provider/model。",
        "memberConfig/toolInput override warning 与现有行为一致。",
        "run projection 能解释父/子 session fingerprint 差异。"
      ],
      "validation": [
        "npm run test:studio-policy",
        "node_modules/.bin/tsc --noEmit",
        "手工切换不同 member policy 后启动 child run"
      ],
      "risks": [
        "某些 provider 资源按 sessionId 缓存；child 独立 sessionId 是隔离设计而非缺陷。"
      ],
      "parallelizable": true,
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "migration-config",
      "title": "兼容旧 run、runner config 与 fallback 策略",
      "phase": "rollout",
      "order": 80,
      "dependsOn": ["sdk-progress-runtime", "child-guard-approval", "session-reader-sidebar", "policy-affinity"],
      "files": [
        "lib/pi-web-config.ts",
        "components/SettingsConfig.tsx",
        "lib/ypi-studio-extension.ts",
        "lib/ypi-studio-tasks.ts",
        "docs/deployment/README.md",
        "docs/operations/troubleshooting.md"
      ],
      "instructions": [
        "新增 studio.subagents.runner 配置：auto/sdk/cli，首版推荐 auto。",
        "auto 仅在 SDK session 创建和 prompt 发送前失败时回退 CLI；已启动模型请求后不重复执行。",
        "旧 task.subagents 无 runner/childSessionId 时继续按 legacy transcript 展示。",
        "发布说明写明 running CLI child 不迁移，新 run 才按新配置。",
        "Settings 可选暴露 runner 调试开关；若 UI 太重，可先只文档配置。"
      ],
      "acceptance": [
        "旧任务详情和 transcript route 完全可读。",
        "配置 runner=cli 可回滚到旧 runner。",
        "配置 runner=sdk 可强制无 CLI 路径执行。"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "手工读取旧 task 与新 SDK task"
      ],
      "risks": [
        "auto fallback 若边界不清会重复执行 child prompt；必须只在 preflight 前回退。"
      ],
      "parallelizable": false,
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "tests-docs-rollout",
      "title": "测试、文档与手工验收收口",
      "phase": "validation",
      "order": 90,
      "dependsOn": ["cli-bundled-fallback", "child-session-contract", "sdk-runner-core", "sdk-progress-runtime", "child-guard-approval", "session-reader-sidebar", "policy-affinity", "migration-config"],
      "files": [
        "docs/architecture/overview.md",
        "docs/modules/api.md",
        "docs/modules/frontend.md",
        "docs/modules/library.md",
        "docs/integrations/README.md",
        "docs/operations/troubleshooting.md",
        "scripts/test-ypi-studio-policy.mjs",
        "scripts/test-ypi-studio-dag.mjs",
        "package.json"
      ],
      "instructions": [
        "更新架构/API/frontend/library 文档，记录 child session header、hidden sidebar behavior、SDK runner、fallback、affinity。",
        "补充测试覆盖 policy resolve、session-reader child filtering、runtime cancel/finalizer 可 mock 的纯函数部分。",
        "手工跑真实 Studio architect/checker/implementer async run，检查 wait/cancel/header/sidebar。",
        "记录回滚 runbook：runner=cli、隐藏 child sessions、清理 runtime_lost。"
      ],
      "acceptance": [
        "自动验证通过：lint、tsc、studio-policy、studio-dag。",
        "手工验收覆盖无全局 pi、SDK child run、Sidebar 隐藏/展开、approval gate、cancel/wait。",
        "文档足以让后续维护者理解 parent/child session 与 task.json 权威边界。"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "npm run test:studio-policy",
        "npm run test:studio-dag",
        "手工浏览器验收"
      ],
      "risks": [
        "真实 provider 行为难以完全 mock；必须至少做一次手工 SDK child run。"
      ],
      "parallelizable": false,
      "localReview": { "required": true, "reviewer": "checker" }
    }
  ]
}
```

## 验证命令

规划阶段不运行代码验证。实现阶段每个相关子任务至少运行：

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:studio-policy
npm run test:studio-dag
```

## 检查门禁

- 未获用户确认前不得进入 `implementing`。
- 实现员每个子任务必须说明 changed files、validation、remaining risks。
- 检查员必须重点复核：child 是否能获得 Studio tools、approval gate 是否仍不可绕过、Sidebar 是否默认不污染项目历史。
