# Studio 上下文注入收敛：Chat 折叠展示 + system 单通道（保留 knowledge 与子代理）

- Task: 20260718-195741-studio-上下文注入收敛-chat-折叠展示-system-单通道-保留-knowledge
- Workflow: feature-dev
- Archived task: .ypi/tasks/archive/2026-07/20260718-195741-studio-上下文注入收敛-chat-折叠展示-system-单通道-保留-knowledge
- Archived at: 2026-07-19T11:24:24.717Z
- Tags: studio, feature-dev

## Summary
## Status - 规划产物已写满（brief / prd / ui / design / implement / checks / plan-review + HTML） - **未改生产代码** - **未** `commit` / `push` / `merge` - Task state 仍可能显示 `intake`：子代理环境缺少 Studio 工具，无法 `update_implementation_plan` / `transition` ## Artifacts produced 目录：`.ypi/tasks/20260718-195741-studio-上下文注入收敛-chat-折叠展示-system-单通道-保留-knowledge/` | File | Notes | | --- | --- | | brief.md | 问题与证据 | | prd.md | R1–R17 + 范围 | | design.md | AS-IS/TO-BE、契约、风险 | | implement.md | SCI-01…06 DAG + ypi-implementation-plan JSON | | checks.md | 全覆盖矩阵 | | ui.md | UI 门禁说明 | | sci-user-message-prototype.html | L0 HTML 原型 | | plan-review.md | 用户审批入口 | ## Validation run - 源码与 Pi `extensions.md` 已对照阅读 - 未跑 lint/tsc（无代码改动） ## Remaining risks 1. UI 原型未经独立 ui-designer 流程（环境阻塞） 2. implementationPlan 未写入 task.json（需主会话 tool） 3. 用户尚未批 Q1–Q4 默认决策 ## Decisions needed from main session 1. 保存 implementationPlan 并 transition → **…

## Reusable knowledge
### handoff.md

# Handoff — architect (SCI planning)

## Status

- 规划产物已写满（brief / prd / ui / design / implement / checks / plan-review + HTML）
- **未改生产代码**
- **未** `commit` / `push` / `merge`
- Task state 仍可能显示 `intake`：子代理环境缺少 Studio 工具，无法 `update_implementation_plan` / `transition`

## Artifacts produced

目录：`.ypi/tasks/20260718-195741-studio-上下文注入收敛-chat-折叠展示-system-单通道-保留-knowledge/`

| File | Notes |
| --- | --- |
| brief.md | 问题与证据 |
| prd.md | R1–R17 + 范围 |
| design.md | AS-IS/TO-BE、契约、风险 |
| implement.md | SCI-01…06 DAG + ypi-implementation-plan JSON |
| checks.md | 全覆盖矩阵 |
| ui.md | UI 门禁说明 |
| sci-user-message-prototype.html | L0 HTML 原型 |
| plan-review.md | 用户审批入口 |

## Validation run

- 源码与 Pi `extensions.md` 已对照阅读  
- 未跑 lint/tsc（无代码改动）

## Remaining risks

1. UI 原型未经独立 ui-designer 流程（环境阻塞）  
2. implementationPlan 未写入 task.json（需主会话 tool）  
3. 用户尚未批 Q1–Q4 默认决策  

## Decisions needed from main session

1. 保存 implementationPlan 并 transition → **awaiting_approval**  
2. 请用户批 plan + HTML  
3. 若用户不接受 architect HTML → 派 **ui-designer**（建议 grok-cli/grok-4.5 + thinking high）  
4. 批准后按 maxConcurrency=2 claim SCI-01 → 并行 SCI-02/SCI-03  

## Do not

- 在用户批准前 implementing  
- 弱化审批 / 子代理 / knowledge query

### review.md

# Review — Studio Context Integrity（SCI）

**Task:** `20260718-195741-studio-上下文注入收敛-chat-折叠展示-system-单通道-保留-knowledge`  
**Reviewer:** checker  
**Scope:** SCI-01…06 implementation gate (PRD / Design / Checks / UI)  
**Verdict:** **Pass**

## Summary

L0 (Chat strip + compact tag) and L1 (system single-channel injection) match the approved design. Core no-regression requirements hold: approval side-effect retained, knowledge query uses `event.prompt`, `buildMemberPrompt` / child guard unchanged, title strip present, automation matrix green. Docs updated. Residual risk is human UAT only (G1–G13), not an implementation blocker.

## Findings Fixed

None (checker did not change production code).

## Remaining Findings

### Blocking

None.

### Non-blocking / residual

| # | Item | Severity | Notes |
| --- | --- | --- | --- |
| N1 | Manual UAT G1–G13 not run in this env | residual | Dirty session UI, Copy/Edit, same-turn chat approval → implementing, real subagent, widget, steer/follow-up, light/dark, clean chat. Required before user_acceptance close. |
| N2 | Pre-existing `npm run lint` errors outside SCI | residual | `ChatMinimap.tsx` (preserve-manual-memoization), `TrellisWorkflowVisualizer.tsx` (Date.now purity + memoization). SCI files clean. Do not treat as SCI regression. |
| N3 | Historical dirty user JSONL still in model context | accepted | Design/PRD: no migration; L0 only strips display. |
| N4 | User-authored complete forged closed tags strip | accepted edge | Documented U6b / design: full-block rule; partial half-open preserved. |
| N5 | Live browser visual parity vs HTML prototype | residual UAT | Class names / showTag logic / CSS tokens align with `ui.md` + prototype; pixel UAT still human. |

## Acceptance checklist (code + auto)

### L1 injection (`lib/ypi-

### checks.md

# Checks — Studio Context Integrity（SCI）

## 1. 需求覆盖

| 需求 | 检查 | 方式 |
| --- | --- | --- |
| R1–R3 干净气泡 | 脏/净消息渲染 | 自动 strip 单测 + 人工 UI |
| R4–R6 tag | status 解析与展示 | 单测 + 人工 UI |
| R7–R9 Copy/Edit | displayText 路径 | 代码审 + 人工 |
| R10 新 JSONL 干净 | input 无 transform | 自动 extension + 人工抓 JSONL |
| R11 审批同轮 | record 仍调用 | 自动 spy + dag 回归 |
| R12 标题 | seed strip | 单测/title |
| R13–R15 system 注入 | before_agent_start | 自动 + 人工编排 |
| R16 子代理 | buildMemberPrompt 未改 | diff 审 + 人工派发 |
| R17 widget/continuation | 无回归 | widget 测试 + 人工 |
| N1–N5 非功能 | 纯函数/无迁移/lint/tsc | 自动 |

## 2. 单元：strip/parse 纯函数

脚本：`npm run test:studio-message-display`（SCI-01/05）

| # | 用例 | 期望 |
| --- | --- | --- |
| U1 | 无标签纯文本 | displayText=raw；hadInjection=false；无 tag |
| U2 | 仅 state 块 + 用户句在前 | 去掉 state；保留用户句；status 解析 |
| U3 | state + knowledge 相邻 | 两块皆剥；status 来自 state |
| U4 | 多块重复 state | 全部完整块移除 |
| U5 | 半截开标签无闭合 | 不删除用户正文关键句；confidence partial 或保守全文策略符合 design |
| U6 | 用户正文讨论 `` <ypi-studio-state> `` 作为代码说明但无合法闭合注入结构 | 不误伤（按实现的完整块规则） |
| U7 | 用户正文含 “ypi-studio-state” 字面无尖括号 | 不 strip |
| U8 | `Status: no_task` | studioStatus=no_task；tag `Studio · no_task` |
| U9 | `Task: x (implementing)` | studioStatus=implementing |
| U10 | 仅 knowledge 无 state | hadInjection=true；status=context；tag `Studio · context` |
| U11 | 首尾空白/多余空行 | displayText 规整但不丢段 |
| U12 | 空字符串 | 安全返回 |
| U13 | formatYpiStudioMessageTag(null) | 空或调用方不显示 |
| U14 | first-reply / context 标签 | 可剥离 |

## 3. Extension 行为

| # | 用例 | 期望 | 方式 |
| --- | --- | --- | --- |
| E1 | input 正常文本 | 不调用 transform 拼接；返回 continue | 自动 |
| E2 | input 在 awaiting_approval +「确认，开始实现」 | 仍调用 recordYpiStudioUserApproval | 自动 spy + `test:studio-dag` |
| E3 | before_agent_start | systemPrompt 含 state；buildStudioState 第三参为 event.prompt | 自动 |
| E4 | 首轮 startup | fir

### design.md

# Design — Studio Context Integrity（SCI）

## 1. 方案摘要

将 Studio 主会话上下文从 **user transform + system 双注入** 收敛为：

```
input:  副作用 only（审批 grant）→ continue（user JSONL 干净）
before_agent_start: 唯一注入 → systemPrompt += startup?(once) + buildStudioState(root, key, event.prompt) + rule
Chat L0: 纯函数 strip 历史脏 user 文本 → 干净气泡 + compact status tag
Child:  buildMemberPrompt 不变
```

核心原则：**写入干净、展示剥离、模型侧 system 单通道刷新、能力不回退。**

## 2. 现状数据流（AS-IS）

```
User types text
  → pi.on("input")
      → recordYpiStudioUserApproval(root, key, text)   // keep
      → transform text = user + "\n\n" + buildStudioState(root, key, text)  // pollutes JSONL
  → agent run
  → pi.on("before_agent_start")
      → systemPrompt = base + startup?(once) + buildStudioState(root, key)  // NO query
      → LLM sees state twice (user + system); knowledge query only on user side
  → Chat renders full user JSONL content (injection visible)
```

证据：

- `lib/ypi-studio-extension.ts` ~2783–2809
- `buildStudioState` ~303–351（tags: `ypi-studio-state` + nested/adjacent knowledge via `getYpiStudioKnowledgeContextForPrompt` → `ypi-studio-knowledge`）
- `startupContext` ~353–366（`ypi-studio-context` + knowledge + `ypi-studio-first-reply`）
- SDK: `docs/extensions.md` `before_agent_start.event.prompt` / `input` actions

## 3. 目标数据流（TO-BE）

```
User types text
  → pi.on("input")
      → recordYpiStudioUserApproval(root, key, text)
      → { action: "continue" }   // no transform
  → JSONL user message = clean user text
  → pi.on("before_agent_start")
      → promptQuery = event.prompt ?? ""
      → systemPrompt = base
          + (first time for key ? startupContextWithoutKnowledge : "")
          + buildStudioState(root, key, promptQuery)
          + orchestration rule
  → LLM sees latest state + knowledge(query=prompt) once per tur

### implement.md

# Implement — Studio Context Integrity（SCI）

## 1. 执行原则

- **先 L0 纯函数 + UI，再 L1 extension**，或 L0/L1 在文件不重叠时可并行（maxConcurrency=2）
- **禁止**在未取得用户对 plan + HTML 原型批准前改生产代码（本文件仅规划）
- 实现员不得弱化审批、子代理、knowledge query
- 每项完成后跑对应 validation；全量结束后 lint + tsc + 相关 studio 测试

## 2. 优先阅读（实现前）

| 顺序 | 文件 | 原因 |
| --- | --- | --- |
| 1 | [design.md](design.md) / [prd.md](prd.md) / [checks.md](checks.md) / [ui.md](ui.md) | 契约与验收 |
| 2 | `sci-user-message-prototype.html` | UI 视觉与 DOM 结构 |
| 3 | `lib/ypi-studio-extension.ts`（`buildStudioState` / `startupContext` / `input` / `before_agent_start` / `buildMemberPrompt`） | L1 核心 |
| 4 | `components/MessageView.tsx`（`UserMessageView`） | L0 挂载点 |
| 5 | `lib/session-title.ts`、`hooks/useAgentSession.ts`（title seed） | 标题不污染 |
| 6 | `lib/ypi-studio-tasks.ts`（`recordYpiStudioUserApproval` / `getYpiStudioKnowledgeContextForPrompt`） | 勿改语义，只调用 |
| 7 | Pi `docs/extensions.md`（`input` / `before_agent_start`） | SDK 契约 |
| 8 | `docs/modules/library.md` / `frontend.md` / `architecture/overview.md` | 文档同步 |
| 9 | `scripts/test-ypi-studio-dag.mjs` 等 | 回归样板 |

## 3. 人类可读子任务表

| ID | Phase | 标题 | dependsOn | 并行 |
| --- | --- | --- | --- | --- |
| SCI-01 | foundation | 抽取 strip/parse 纯函数模块 | — | 可与 SCI-02 规划并行，实现上先落地 |
| SCI-02 | L1 | extension：input continue + system 单通道 + prompt query + startup 去重 | SCI-01（仅若 title/shared 常量复用；逻辑上可并行，计划依赖 SCI-01 以共享标签常量） | 与 SCI-03 文件不重叠 → 可并行 |
| SCI-03 | L0 | UserMessageView + CSS compact tag | SCI-01 | 与 SCI-02 并行 |
| SCI-04 | polish | session title strip + 边界对齐 | SCI-01 | 可与 SCI-03 串/并：依赖 SCI-01 |
| SCI-05 | test | 单元/extension 自动化测试 | SCI-01, SCI-02 | 依赖 L1 与纯函数 |
| SCI-06 | docs+verify | 文档 + 全量验证 + 手工清单 | SCI-02, SCI-03, SCI-04, SCI-05 | 收尾 |

**建议并发：** maxConcurrency = 2  
**首轮可同时 claim：** SCI-01 单独先做；完成后 SCI-02 + SCI-

## Source artifacts
- handoff.md
- review.md
- checks.md
- design.md
- implement.md
- prd.md
- brief.md
- ui.md
- plan-review.md
