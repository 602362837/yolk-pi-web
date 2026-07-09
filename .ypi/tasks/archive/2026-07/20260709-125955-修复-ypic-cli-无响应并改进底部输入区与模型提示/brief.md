# brief

## 任务概述

用户反馈 `ypic` 进入 CLI chat 后存在三类问题：

1. 启动提示不足：需要明确这是 `ypic` 终端聊天入口，并包含 Web 端已有的关键提示/能力入口。
2. 输入区体验不足：需要固定在终端最下方、与上文输出分隔；右侧显示当前生效模型；支持 `/model` 选择模型与 thinking level。
3. 严重可用性问题：`/model` 无响应，普通输入如“帮我看一下一级债动态表头的判定逻辑”也表现为无响应。

## 已阅读材料

- `README.md`：`ypic` 定位、用法、限制。
- `docs/architecture/overview.md`：`ypic` 复用 Web API 的运行流、AgentSession/SSE/Studio 不变量、UI 原型门禁要求。
- `docs/modules/api.md`：`/api/cli/health`、`/api/agent/draft`、`/api/agent/[id]`、`/api/agent/[id]/events`、`/api/models` 契约。
- `docs/modules/frontend.md` / `docs/modules/library.md`：Web ChatInput 的模型/thinking 控件、`ypic` CommonJS/HTTP 边界。
- `docs/deployment/README.md`：npm runtime 与 `ypic` 手工验收说明。
- `bin/ypic.js`：CLI 参数、启动提示、SSE 解析、渲染器、命令分发、readline loop。
- `lib/rpc-manager.ts`：`set_model`、`set_thinking_level`、`prompt`/`steer`/`follow_up` 命令处理。
- `app/api/agent/**`、`app/api/models/route.ts`：CLI 可复用的服务端能力。
- `hooks/useAgentSession.ts`、`components/ChatInput.tsx`：Web 模型选择、thinking level、发送流程参考。

## 当前架构摘要

`ypic` 是 `bin/ypic.js` 中的 CommonJS 终端客户端，不直接 import `lib/**` TypeScript。它复用运行中的 ypi Web server：

```text
ypic
  -> GET /api/cli/health
  -> GET/POST /api/projects
  -> POST /api/agent/draft
  -> GET /api/agent/:id/events  (手写 SSE parser)
  -> POST /api/agent/:id        (prompt / steer / follow_up / abort / set_model 等)
```

当前 CLI 用 `readline` 的普通 `> ` prompt，没有真正的底部固定输入框；`/model` 未被 CLI 命令分发显式处理，未知 slash command 会作为普通 prompt 发送给 agent。

## 根因范围判断

- `/model` 无响应的直接根因范围明确：`bin/ypic.js` 没有 `/model` 命令实现，也没有调用 `/api/models` 加载模型列表或调用 `set_model` / `set_thinking_level` 的交互路径。
- 普通输入无响应的高概率根因范围：当前发送流程缺少“已提交/等待模型/SSE 已连接”可见状态；`handleLine()` 在 `sendAgentCommand()` 返回前没有稳定底部状态反馈，且 `connectSse()` 是异步 fire-and-forget，没有等待 `connected` 后再允许发送，首条/早期输入存在竞态与不可见卡顿风险。
- 仍需实现员用 `YPIC_DEBUG=1` 和端到端手工 smoke 确认是否还存在服务端 preflight、模型认证或 SSE 断连导致的真实 hang。

## 规划结论

本任务涉及用户可见终端交互结构变化，触发 UI 原型门禁。进入实现前需要 UI 设计员基于现有项目产出 HTML 原型并获得主会话/用户审批。
