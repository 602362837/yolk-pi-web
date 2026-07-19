# Implement：浮窗决策 CTA → Chat Send 续推 + 工作中禁用

## 0. 视觉硬约束（用户确认 · 实现前门禁）

1. **不改现有浮窗 UI**：布局、色板、决策区/rail/验收区/预览区样式以生产 `YpiStudioSessionWidget` + 现网 CSS 为唯一权威。
2. 任务内 [`studio-widget-chat-send-continue-prototype.html`](studio-widget-chat-send-continue-prototype.html) **不是**视觉稿；**禁止**按该 HTML 还原/重画组件。
3. 允许：`disabled` / `title` / `aria-*`、toast 文案、Chat 多一条用户消息（现有气泡）、行为接线（PATCH 后 `handleSend`）。
4. 用户明确批准 Hybrid B 行为方案后，主会话保存 schemaVersion 2 plan 并合法进入 `implementing` 才可 claim/dispatch；不得提前实现。

## 1. 执行总览

| 顺序 | 子任务 id | 标题 | 可并行 |
| --- | --- | --- | --- |
| 1 | CONT-HELPER-01 | pure 引导词 builder + needsChatContinue | 是（与 docs 可并行） |
| 2 | CONT-WIRE-02 | ChatWindow 暴露 handleSend → AppShell → Widget props | 否（依赖产品契约，建议先于 UI） |
| 3 | CONT-WIDGET-03 | Widget busy 禁用 + PATCH 后 onComposeSend + toast | 依赖 01+02 |
| 4 | CONT-SERVER-04 | 去掉 route request_plan_changes 主路径 server wake | 可与 03 并行（推荐 A） |
| 5 | CONT-DOCS-TEST-05 | 文档 + 单测 + lint/tsc | 依赖 01–04 |

**maxConcurrency：2**  
**schemaVersion：2**

## 2. 优先阅读（实现员）

1. 本任务 [prd.md](prd.md)、[design.md](design.md)、[ui.md](ui.md)、[checks.md](checks.md) — 尤其 ui.md §0 视觉硬约束
2. HTML 文件仅作交互场景 checklist（非视觉）：[studio-widget-chat-send-continue-prototype.html](studio-widget-chat-send-continue-prototype.html)
3. 前序保全：归档任务 `20260716-174251` 的 prd/design（A–F）
4. 源码：
   - `components/YpiStudioSessionWidget.tsx`（`handleDecisionAction`、`TaskCard` disabled、accept handlers）
   - `components/AppShell.tsx`（`chatAgentRunning`、`YpiStudioSessionWidget` 挂载 ~1878）
   - `components/ChatWindow.tsx`（`handleSend` 解构与 props）
   - `hooks/useAgentSession.ts`（`handleSend`、`ensureSessionModel`、`agentRunning`）
   - `app/api/studio/tasks/[taskKey]/route.ts`（`bestEffortContinueAfterWidgetRequestPlanChanges`）
   - `lib/ypi-studio-session-link.ts`（continuation helpers）
   - `lib/rpc-manager.ts`（`studio_user_action` / `scheduleStudioFollowUp` — 勿拆子任务续推）
5. 规范：`docs/standards/code-style.md`、`docs/modules/frontend.md`

## 3. 人类可读子任务表

| id | phase | 做什么 | 验收要点 |
| --- | --- | --- | --- |
| CONT-HELPER-01 | foundation | 新建 pure helper | 单测覆盖三种 kind；无 HTML/URL |
| CONT-WIRE-02 | wiring | Chat→AppShell→Widget 传 send + agentRunning | 类型通过；unmount 清句柄 |
| CONT-WIDGET-03 | ui-logic | busy + 续推 + toast | 矩阵 6 行；二次 lock 检查 |
| CONT-SERVER-04 | server | 删 route best-effort 主路径 | request_changes 仍写库；无双发 |
| CONT-DOCS-TEST-05 | verify | docs + tests + lint/tsc | Checks 清单绿 |

## 4. 机器可读 Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "taskId": "20260718-192856-任务浮窗决策-cta-改为-chat-send-续推并在工作中禁用",
  "title": "任务浮窗决策 CTA 改为 Chat Send 续推并在工作中禁用",
  "maxConcurrency": 2,
  "execution": {
    "groups": [
      {
        "id": "foundation",
        "title": "Pure helper",
        "subtaskIds": ["CONT-HELPER-01"]
      },
      {
        "id": "wiring-ui",
        "title": "Chat wiring + widget behavior",
        "subtaskIds": ["CONT-WIRE-02", "CONT-WIDGET-03"]
      },
      {
        "id": "server-docs",
        "title": "Server path + docs/tests",
        "subtaskIds": ["CONT-SERVER-04", "CONT-DOCS-TEST-05"]
      }
    ]
  },
  "subtasks": [
    {
      "id": "CONT-HELPER-01",
      "title": "新增 ypi-studio-widget-continue pure helper",
      "phase": "foundation",
      "order": 1,
      "dependsOn": [],
      "parallelizable": true,
      "localReview": true,
      "files": [
        "lib/ypi-studio-widget-continue.ts",
        "scripts/test-ypi-studio-widget-continue.mjs",
        "package.json"
      ],
      "instructions": [
        "新建 lib/ypi-studio-widget-continue.ts：导出 ypiStudioWidgetActionNeedsChatContinue(kind) 与 buildYpiStudioWidgetChatContinuePrompt(input)。",
        "needsChatContinue 仅对 approve_plan / request_plan_changes / approve_improvement_plan 为 true；start_user_acceptance 与未知 kind 为 false。",
        "引导词语义锁定 PRD §3.2：中文说明 + bullet（taskId/action/revision/improvementId/feedbackSummary/reason）；feedback 截断 ≤200；总长建议 ≤4000。",
        "禁止输出 HTML 标签、http(s) endpoint、任意用户路径。",
        "新增 scripts/test-ypi-studio-widget-continue.mjs（或并入 test-ypi-studio-widget-actions.mjs）：assert 三种 prompt 子串与 needs* 矩阵。",
        "package.json 增加 npm script test:studio-widget-continue（若独立文件）。",
        "不修改 React 组件。"
      ],
      "acceptance": [
        "纯函数无副作用；tsc 可解析。",
        "单测覆盖 true/false kind 与 prompt 必含字段。",
        "prompt 不含 <html 与 http://"
      ],
      "validation": [
        "node --loader ./scripts/ts-extension-loader.mjs --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/test-ypi-studio-widget-continue.mjs",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "与 rpc-manager 内 server continuation 文案重复但路径不同——保持语义对齐即可，勿 import rpc-manager（环依赖）。"
      ]
    },
    {
      "id": "CONT-WIRE-02",
      "title": "ChatWindow/AppShell 暴露 compose send 与 agentRunning",
      "phase": "wiring",
      "order": 2,
      "dependsOn": [],
      "parallelizable": true,
      "localReview": true,
      "files": [
        "components/ChatWindow.tsx",
        "components/AppShell.tsx",
        "components/YpiStudioSessionWidget.tsx"
      ],
      "instructions": [
        "ChatWindow Props 增加 onComposeSendReady?: (send: ((message: string) => void | Promise<void>) | null) => void。",
        "在 handleSend 稳定后 useEffect 注册 onComposeSendReady(handleSend)；cleanup 传 null。",
        "AppShell 用 useRef 或 useState 保存 composeSend；ChatWindow 回调写入。",
        "YpiStudioSessionWidget 已有挂载点传入 agentRunning={chatAgentRunning} 与 onComposeSend={composeSend}。",
        "不要把业务引导词写进 AppShell；不要扩展 ChatInputHandle 作为主方案。",
        "注意：ChatWindow 随 selectedSession 重挂载时必须更新/清空句柄，避免指向已卸载 session 的 handleSend。"
      ],
      "acceptance": [
        "类型完整；无 any 泄漏。",
        "会话切换后 onComposeSend 指向当前会话。",
        "widget 在无 Chat 时 onComposeSend 可为 undefined。"
      ],
      "validation": [
        "node_modules/.bin/tsc --noEmit",
        "npm run lint"
      ],
      "risks": [
        "stale closure：必须依赖 handleSend 更新 effect。",
        "新会话 isNew 时 handleSend 仍可用——续推一般发生在已绑定 session，保持与手动发送一致即可。"
      ]
    },
    {
      "id": "CONT-WIDGET-03",
      "title": "Widget：busy 禁用 + PATCH 后 Chat 续推 + toast",
      "phase": "ui-logic",
      "order": 3,
      "dependsOn": ["CONT-HELPER-01", "CONT-WIRE-02"],
      "parallelizable": false,
      "localReview": true,
      "files": [
        "components/YpiStudioSessionWidget.tsx",
        "app/globals.css"
      ],
      "instructions": [
        "Props 增加 agentRunning?: boolean；onComposeSend?: (message: string) => void | Promise<void>。",
        "agentRunningRef 镜像 prop，供 confirm 返回后二次检查。",
        "interactionLocked = agentRunning || Boolean(acceptingKey)（及既有 acceptingInFlightRef）。",
        "TaskCard：决策按钮、改进验收、主验收 disabled 条件并入 interactionLocked；agentRunning 时 title/aria 说明「Chat 正在工作，请稍后再试」。",
        "handleDecisionAction：confirm 后若 locked → info toast return；PATCH 成功后 onTaskChanged；若 needsChatContinue(kind) 则 build prompt 并 await onComposeSend；catch → partial toast，不回滚。",
        "handleAcceptImprovement / handleAcceptMainTask：PATCH 前同样 lock 检查；disabled 同步；不调用 onComposeSend。",
        "修正 approve_* 成功 toast：区分 Send ok / fail（PRD/UI 文案）。",
        "start_user_acceptance 保持无 Send。",
        "quick preview 默认不因 agentRunning 禁用（与 UI 推荐一致）。",
        "CSS：若需 .is-agent-locked 可加，优先复用 :disabled。",
        "taskId：从 candidate.task.id 取；prompt 用 id 而非仅 key。"
      ],
      "acceptance": [
        "动作矩阵 6 行行为正确。",
        "agentRunning 时无法触发 PATCH（disabled + 二次检查）。",
        "续推类成功后 Chat 路径被调用一次。",
        "Send 失败不 fetch 回滚。",
        "保全 A–F：rail/preview/accept 结构仍在。"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "手工：dev 下点批准/改计划/改进批准/进入验收/主验收 + 工作中禁用"
      ],
      "risks": [
        "handleSend 在 agentRunning 时直接 return：续推前必须再读 ref。",
        "toast API 无 warning tone 时用 info + 明确 partial 文案。"
      ]
    },
    {
      "id": "CONT-SERVER-04",
      "title": "降级 request_plan_changes 的 server best-effort 主路径",
      "phase": "server",
      "order": 4,
      "dependsOn": [],
      "parallelizable": true,
      "localReview": true,
      "files": [
        "app/api/studio/tasks/[taskKey]/route.ts",
        "lib/ypi-studio-session-link.ts",
        "lib/rpc-manager.ts"
      ],
      "instructions": [
        "推荐选项 A：删除 route 成功分支对 bestEffortContinueAfterWidgetRequestPlanChanges 的调用；保留 import 删除后的干净依赖。",
        "在 session-link 的 bestEffortContinue* / build*Continuation 注释标注：非 widget 主路径；保留供测试或紧急回滚。",
        "不要删除 studio_user_action 命令处理或 scheduleStudioUserActionContinuation（可能仍被其他调用）。",
        "不要改 approve_plan / approve_improvement 写库 helper。",
        "不要改 studio_autocontinue 子任务续推。",
        "若测试脚本断言 route 调用 best-effort，更新断言为「不调用」或改为单测 helper 本身。"
      ],
      "acceptance": [
        "request_plan_changes PATCH 仍 200 且状态 planning/revision+1。",
        "route 成功路径无 getRpcSession/send studio_user_action。",
        "helper 单测若存在仍可通过。"
      ],
      "validation": [
        "npm run test:studio-widget-actions",
        "npm run test:studio-dag"
      ],
      "risks": [
        "若有外部依赖 server wake：产品已确认 Chat 为主路径；回滚可恢复一行调用。"
      ]
    },
    {
      "id": "CONT-DOCS-TEST-05",
      "title": "文档、回归测试与质量门禁",
      "phase": "verify",
      "order": 5,
      "dependsOn": ["CONT-HELPER-01", "CONT-WIRE-02", "CONT-WIDGET-03", "CONT-SERVER-04"],
      "parallelizable": false,
      "localReview": true,
      "files": [
        "docs/modules/frontend.md",
        "docs/modules/api.md",
        "docs/modules/library.md",
        "docs/architecture/overview.md",
        "scripts/test-ypi-studio-widget-actions.mjs",
        "scripts/test-ypi-studio-widget-continue.mjs",
        "package.json"
      ],
      "instructions": [
        "更新 frontend.md：Widget props agentRunning/onComposeSend；busy；PATCH+Send；toast partial。",
        "更新 api.md：request_plan_changes 不再 best-effort server wake 为主路径。",
        "更新 library.md：新 helper；session-link continuation 标注。",
        "更新 overview.md 中 widget decision 续推一句。",
        "扩展 widget-actions 测试：needsChatContinue 矩阵（若未在 continue 测试覆盖）。",
        "跑 lint、tsc、test:studio-widget-actions、test:studio-main-accept、新 continue 测试、相关 dag 冒烟。",
        "对照 checks.md 勾选；不 commit。"
      ],
      "acceptance": [
        "文档与实现一致。",
        "自动验证全绿。",
        "保全 A–F 无回归描述漏洞。"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "npm run test:studio-widget-actions",
        "npm run test:studio-main-accept",
        "npm run test:studio-widget-continue"
      ],
      "risks": [
        "文档漏更导致后续 agent 仍按 server wake 实现。"
      ]
    }
  ]
}
```

## 5. 建议实现顺序（串行视图）

1. CONT-HELPER-01  
2. CONT-WIRE-02（可与 01 并行）  
3. CONT-SERVER-04（可与 01/02 并行）  
4. CONT-WIDGET-03  
5. CONT-DOCS-TEST-05  

## 6. 验证命令

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:studio-widget-actions
npm run test:studio-main-accept
npm run test:studio-widget-continue   # 若新增
npm run test:studio-dag              # 冒烟 continuation 相关
```

手工（dev `npm run dev`）：

1. awaiting_approval：批准 → transcript 引导词 + 流式  
2. 需要修改 → planning + 引导词  
3. 改进计划批准 → 实例引导词  
4. start_user_acceptance → 无新引导词  
5. 结果验收 → 无新引导词  
6. agent 运行中按钮 disabled  
7. mock Send 失败 → 状态已变 + partial toast  

## 7. 评审门禁

- 用户已批 plan-review / HTML 原型  
- 实现员不扩大 scope（不改 grant 算法、不改 rail）  
- checker 按 [checks.md](checks.md)  

## 8. 回滚

- 还原 Widget 续推分支与 props  
- 恢复 route best-effort 一行  
- 删除 pure helper（可选）  
- 无 DB/task.json 迁移  
