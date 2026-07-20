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
| E4 | 首轮 startup | first-reply 注入一次；次轮不再 | 自动或日志人工 |
| E5 | startup 不再附带第二份无 query knowledge | 与 design Q2 一致 | 代码审 + 可选自动 |
| E6 | child env `YPI_STUDIO_SUBAGENT_CHILD=1` | extension 早退 | 代码审 / 既有 runner 测 |

## 4. 回归矩阵（自动化 vs 人工）

| # | 场景 | 自动 | 人工 UAT |
| --- | --- | --- | --- |
| G1 | no_task：用户说「用工作室做功能」→ 引导创建任务 | 部分（注入含 no_task 文案可测） | **是** — 真聊一轮 |
| G2 | awaiting_approval：聊天「批准」→ grant → 可 implementing | `test:studio-dag` / approval 测 | **是** — 同轮模型是否继续 |
| G3 | implementing：claim + async subagent + wait | 既有 dag/runtime 测 | **是** — 一条真实子任务 |
| G4 | 子代理上下文含 task docs + knowledge | 代码路径未改可 diff | **是** — 派 architect/implementer 看 child prompt 日志 |
| G5 | knowledge 相关性：用户 prompt 含关键词 vs 空 | 单测 knowledge 函数可选对比 | **是** — 对比改造前后摘要条目 |
| G6 | continuation：`sendUserMessage` / studio-continue | 代码审 input continue | **是** |
| G7 | widget 批准计划 | `test:studio-widget-actions` | **是** — 点浮窗批准 |
| G8 | steer / follow-up 输入 | — | **是** — 流式中断再发 |
| G9 | 历史脏 JSONL 打开 session | strip 单测 | **是** — 打开已知脏 session |
| G10 | Copy / Edit from here | — | **是** |
| G11 | 新消息标题种子 | title 单测 | **是** — 新 session 侧栏标题 |
| G12 | 明暗主题 tag | — | **是** |
| G13 | 无 Studio 的普通聊天 | — | **是** — 无 tag 无回归 |

## 5. 质量门禁

| 命令 | 必须 |
| --- | --- |
| `npm run lint` | 是 |
| `node_modules/.bin/tsc --noEmit` | 是 |
| `npm run test:studio-message-display` | 是（落地后） |
| `npm run test:studio-dag` | 是 |
| `npm run test:studio-widget-actions` | 是 |
| `npm run test:studio-policy` | 是 |

## 6. 重点风险检查（Checker）

1. **双注入是否真的消失**：抓一条新 user JSONL + 同轮 system 诊断（memory/diagnostics 或日志）
2. **knowledge 是否变弱**：同一 prompt 下 knowledge 条目数/命中分不低于改造前（允许去重后总量下降但相关命中不降）
3. **审批竞态**：grant 仍在 agent 读 state 前写入（input 在 before_agent_start 之前 — SDK 顺序）
4. **strip 误伤**：用户粘贴 XML/示例标签
5. **子代理**：diff `buildMemberPrompt` 应为空

## 7. 手工验收脚本（主会话 UAT）

1. 打开含历史脏用户消息的 session → 气泡干净 + `Studio · …` tag → Copy 无标签  
2. 新 session 发普通消息 → JSONL 无 `<ypi-studio-` → 侧栏标题正常  
3. no_task 下请求「用工作室做」→ 模型仍引导创建  
4. 绑定 awaiting_approval 任务 → 回复「确认，开始实现」→ 进入 implementing  
5. implementing 派子代理 → child 有任务上下文  
6. 浮窗批准/续跑路径冒烟  
7. lint/tsc/测试全绿  

## 8. 退出标准

- 上表自动项全绿  
- 人工 UAT G1–G13 关键项通过或记录已知限制  
- 无未解释的能力回退  
