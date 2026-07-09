# implement

## 执行前门禁

本任务已触发 UI 原型门禁。实现前必须先由 `ui-designer` 产出 HTML 原型并获得主会话/用户审批。未审批前不要修改生产代码。

## 需先阅读的文件

1. `AGENTS.md`
2. `README.md`
3. `docs/architecture/overview.md`
4. `docs/modules/api.md`
5. `docs/modules/library.md`
6. `docs/deployment/README.md`
7. `bin/ypic.js`
8. `scripts/test-ypic-cli.mjs`
9. `lib/rpc-manager.ts` 中 `AgentSessionWrapper.send()`
10. `app/api/agent/[id]/route.ts`、`app/api/agent/[id]/events/route.ts`、`app/api/models/route.ts`
11. `components/ChatInput.tsx`、`hooks/useAgentSession.ts`（参考 Web 模型/thinking 行为）

## 建议实现顺序

| ID | 阶段 | 子任务 | 可并行 | 依赖 |
| --- | --- | --- | --- | --- |
| S1 | UI approval | 获取 UI HTML 原型与审批记录 | 否 | - |
| S2 | Diagnose | 增加/使用 CLI 调试路径定位普通输入无响应 | 否 | S1 |
| S3 | Model command | 实现模型数据加载与 `/model` 命令 | 部分 | S1 |
| S4 | Send/SSE reliability | 修复首条/普通输入等待与错误反馈 | 部分 | S2 |
| S5 | Terminal frame | 实现 TTY 底部固定输入和状态栏，plain fallback | 否 | S1,S3,S4 |
| S6 | Docs/tests | 更新测试、文档和手工验收清单 | 是 | S3,S4,S5 |

## Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "subtasks": [
    {
      "id": "S1-ui-prototype-approval",
      "title": "UI 原型与审批门禁",
      "phase": "planning",
      "order": 1,
      "dependsOn": [],
      "files": [
        ".ypi/tasks/20260709-125955-修复-ypic-cli-无响应并改进底部输入区与模型提示/ui.md",
        ".ypi/tasks/20260709-125955-修复-ypic-cli-无响应并改进底部输入区与模型提示/plan-review.md"
      ],
      "instructions": "指派 UI 设计员产出 HTML 原型，覆盖启动、空闲、发送等待、/model、错误和 plain fallback 状态；获得用户/主会话审批后才能实现。",
      "acceptance": [
        "ui.md 包含 fenced html 或 task-local .html 链接",
        "plan-review.md 记录审批状态",
        "主会话明确批准进入实现"
      ],
      "validation": ["人工检查 UI 原型和审批记录"],
      "risks": ["未审批直接实现会违反 Studio UI 门禁"],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "S2-diagnose-unresponsive-path",
      "title": "定位普通输入无响应路径",
      "phase": "diagnose",
      "order": 2,
      "dependsOn": ["S1-ui-prototype-approval"],
      "files": ["bin/ypic.js", "lib/rpc-manager.ts", "app/api/agent/[id]/events/route.ts", "app/api/agent/[id]/route.ts"],
      "instructions": "用 YPIC_DEBUG=1 和本地 ypi server 复现普通输入；记录 health、draft、SSE connected、POST prompt preflight、agent_start/message_update/agent_end 的时间线。必要时在 CLI 增加 debug timing，但避免输出 secrets。",
      "acceptance": [
        "明确无响应发生在 CLI 命令分发、POST/preflight、SSE 连接、还是模型/auth 错误",
        "用户可见错误路径不再静默"
      ],
      "validation": ["YPIC_DEBUG=1 node bin/ypic.js --port 30141", "手工发送用户提供的中文 prompt"],
      "risks": ["真实根因可能依赖本机模型/auth 配置，需把配置错误转成可见提示而不是猜测"],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "S3-model-command",
      "title": "实现 /model 模型与 thinking 选择",
      "phase": "implementation",
      "order": 3,
      "dependsOn": ["S1-ui-prototype-approval"],
      "files": ["bin/ypic.js", "scripts/test-ypic-cli.mjs"],
      "instructions": "新增 /api/models 加载、当前 agent state 同步、/model current/list/provider-model/thinking/交互选择；调用 POST /api/agent/:id 的 set_model 与 set_thinking_level；running 时禁止或明确提示。",
      "acceptance": [
        "/model 不再作为 prompt 发送",
        "/model current 显示当前 provider/model/thinking",
        "/model <provider>/<modelId> <thinking> 成功切换并更新状态栏",
        "模型不存在或 thinking 不支持时给出明确错误"
      ],
      "validation": ["node scripts/test-ypic-cli.mjs", "手工 /model current/list/直接切换"],
      "risks": ["模型名称包含斜杠或 provider display name 搜索需避免误解析；以 provider/modelId 为稳定值"],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "S4-sse-send-reliability",
      "title": "修复发送与 SSE 可见状态",
      "phase": "implementation",
      "order": 4,
      "dependsOn": ["S2-diagnose-unresponsive-path"],
      "files": ["bin/ypic.js", "scripts/test-ypic-cli.mjs"],
      "instructions": "让 connectSse 暴露 connected promise/状态；首条消息前等待 connected 或超时警告；发送前立即设置 sending/waiting_model；POST/preflight/SSE error 统一进入状态与输出。",
      "acceptance": [
        "普通输入后立即有可见 sent/waiting 状态",
        "SSE 未连接、断开、POST 失败均有可见错误",
        "positional message 与交互首条消息都不丢早期事件"
      ],
      "validation": ["node scripts/test-ypic-cli.mjs", "手工 ypic \"hello\"", "手工交互输入中文 prompt"],
      "risks": ["等待 connected 不能永久阻塞；必须有超时和继续策略"],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "S5-terminal-frame",
      "title": "TTY 底部固定输入区与状态栏",
      "phase": "implementation",
      "order": 5,
      "dependsOn": ["S3-model-command", "S4-sse-send-reliability"],
      "files": ["bin/ypic.js", "scripts/test-ypic-cli.mjs"],
      "instructions": "按已审批 HTML 原型实现 TerminalFrame/PlainFrame。TTY 下使用 ANSI/readline 光标控制绘制历史输出、分隔线、底部输入和右侧模型；非 TTY、NO_COLOR、YPIC_PLAIN 使用 plain fallback。",
      "acceptance": [
        "输入区固定底部且与输出分隔",
        "右侧/状态栏持续显示当前模型与 thinking",
        "窗口 resize 后可重绘",
        "plain fallback 输出无 ANSI 污染"
      ],
      "validation": ["手工 TTY resize", "YPIC_PLAIN=1 node bin/ypic.js --help", "非 TTY/管道模式 smoke"],
      "risks": ["readline 与手动 ANSI 交互容易闪烁或打乱中文输入法；需优先保证可用和 fallback"],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "S6-docs-tests-validation",
      "title": "补充测试、文档与验收",
      "phase": "validation",
      "order": 6,
      "dependsOn": ["S3-model-command", "S4-sse-send-reliability", "S5-terminal-frame"],
      "files": ["README.md", "docs/deployment/README.md", "docs/architecture/overview.md", "scripts/test-ypic-cli.mjs", "package.json"],
      "instructions": "更新 ypic 文档、/model 用法、plain fallback、故障排查；扩展 test:ypic-cli；运行最低验证。若未新增 API，不改 docs/modules/api.md。",
      "acceptance": [
        "文档说明 /model 和底部输入行为",
        "测试覆盖新增纯函数/解析逻辑",
        "lint、tsc、test:ypic-cli 通过"
      ],
      "validation": ["npm run lint", "node_modules/.bin/tsc --noEmit", "npm run test:ypic-cli", "node bin/ypic.js --help"],
      "risks": ["完整端到端依赖本机 server/model/auth，需单列手工验收记录"],
      "parallelizable": true,
      "localReview": true
    }
  ]
}
```

## 验证命令

最低自动验证：

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:ypic-cli
node bin/ypic.js --help
```

手工 smoke：

```bash
npm run dev
YPIC_DEBUG=1 node bin/ypic.js --port 30141
# 交互中测试：/model current、/model list、/model <provider>/<model> high、普通中文 prompt、/abort、/quit
```

## 检查门禁

- UI HTML 原型和审批记录存在。
- `/model` 不被误发给 agent。
- 普通输入不再静默；等待、流式、错误都有可见反馈。
- TTY frame 可关闭/降级。
- 不改变 `ypi`、服务端 JSONL、Studio approval gate。
