# PRD — 修复 Chat 冷启动模型 pin（计划 B）

## 1. 目标与背景

Chat 会话选择器中的模型必须是该会话**实际推理**所用模型。当前在 live agent 不存在时（打开历史会话后首轮发送、idle 10 分钟销毁后重发），系统会跳过 `set_model`，让 SDK 冷启动落到 `~/.pi/agent/settings.json` 默认模型（本机常为不可用的 `AITOB-OAI/gpt-5.6-luna`），与 UI 选择及 `pi-web.json` 的 `yolk.defaultModel` 均不一致。

**计划 B（用户确认）**在修复客户端 pin 的同时，要求服务端冷启动在**无法从 session 恢复有效模型**时，优先使用蛋黄𝝅默认模型 + 思考等级，而不是 settings 虚空默认。兜底不能替代“prompt 前 pin 到会话选中模型”的主修复，也不能把 Chat 切换写回全局 settings。

背景与根因证据见 [brief.md](./brief.md)。

## 2. 用户价值

- 用户选什么模型，首轮就用什么模型；无需“先停再发”才能纠正。
- 历史会话、idle 后、abort 后行为一致可预期。
- 即使客户端 pin 短暂失败/竞态，冷启动也不应静默落到 CLI 虚空默认（在 yolk specific 配置下）。
- 不把 Chat 切换污染为全局 `settings.json` 默认。
- 新建会话与冷启动对“蛋黄𝝅默认”语义一致。

## 3. 范围

### 3.1 范围内

| ID | 需求 | 验收标准 |
| --- | --- | --- |
| R1 | 打开已有会话（无 live agent），UI 显示模型 M，首次发送必须用 M | 抓包/日志：`prompt` 前存在成功 `set_model` 到 M；assistant/usage 的 provider/model 为 M；不得为 settings 虚空默认（除非 UI 本身就是它） |
| R2 | path `context.model` 仅可参与**展示/desired 解析**，不得写入“已 pin”基线 | `loadSession` 在无 live 时不把 context 写入 `lastPinnedModelRef`；单元测试锁定 |
| R3 | live agent 存在且已是 M 时，发送不重复无意义失败 | 有 live + lastPinned==desired 时 `shouldPin` 为 false；可跳过 set_model |
| R4 | idle destroy 后重开：即使 lastPinned 仍“记得”M，也必须重新 pin | 无 live 确认时 `ensureSessionModel` 必须发出 set_model |
| R5 | Chat set_model 保持 session-scoped（MODEL-PIN-3） | set_model / 服务端 yolk 兜底后 `settings.json` 的 defaultProvider/defaultModel **不变**；现有 PIN-3 测试仍通过 |
| R6 | 新建会话 `/api/agent/new` 与 draft 路径不回归 | 仍通过 create body / bootstrap set_model；首条消息用所选模型；新建种子仍来自 yolk specific |
| R7 | ensureSessionModel 失败时不得 silent 用错模发 prompt | 已有 throw → abort send 行为保持；错误可见 |
| R8 | steer / follow_up 与 prompt 同一 pin 契约 | 现有 ensureSessionModel 调用点一并遵守新语义 |
| R9 | 回归测试覆盖 pin 语义 | `npm run test:session-model-pin` 覆盖 cold-start / context-not-pin / equal-skip-only-when-confirmed |
| R10 | **服务端冷启动兜底优先 yolk**（计划 B） | 无 session 可恢复有效模型且 `yolk.defaultModel.mode=specific` 时，`startRpcSession` 后初始 runtime 模型为 yolk provider/modelId，thinking 对齐 yolk thinking（经模型能力 clamp）；**不得**静默保持 settings 虚空默认 |
| R11 | session 可恢复模型优先于 yolk | path/JSONL 可恢复且 runtime 可解析的模型不被 yolk 覆盖 |
| R12 | yolk 兜底不替代客户端 pin | 无 liveConfirmed 时客户端仍对 UI desired 强制 set_model；最终 prompt 模型 = UI，而不是“永远 yolk” |
| R13 | `yolk.defaultModel.mode=piDefault` | 服务端不注入 yolk 模型；允许回落 SDK/settings（与产品“跟随 Pi 默认”一致） |
| R14 | 服务端兜底写路径隔离 | yolk apply 走 session-scoped set_model（或等价），**不写** settings 全局默认 |

### 3.2 范围外

- **不**改写 `settings.json` 全局默认以匹配 `yolk.defaultModel`（两套默认源职责分离：yolk=Web Chat 默认；settings=CLI/SDK 兼容）。
- 不改模型选择器 UI 布局、搜索、分栏。
- 不做服务端“根据 yolk 强制覆盖已有会话用户已选模型”。
- 不改 Grok/Kiro/Antigravity failover、账号绑定、Studio 子会话模型策略。
- 不重写历史 JSONL / ledger。
- 不强制 set_model 失败时自动降级到另一个模型（保持显式错误）。
- v1 **不做** prompt body 内嵌 model 双保险（除非审批加 scope）。

## 4. 用户故事

1. **历史会话首轮**  
   作为用户，我打开昨天的会话，选择器显示 `grok-cli/grok-4.5`，发送第一条消息后，实际回复必须来自该模型，而不是 settings 里的 `AITOB-OAI/gpt-5.6-luna`。

2. **idle 后重发**  
   作为用户，我离开 Chat 超过 10 分钟再回来发消息，仍应使用当前选择器模型，无需手动重选。

3. **切换后立即发送**  
   作为用户，我切换模型后立刻发送，仍应先 pin 再 prompt（既有串行链不回归）。

4. **设置隔离**  
   作为用户，我在 Chat 里切换模型，不应改变 Settings/CLI 的全局默认模型。

5. **冷启动不进虚空（计划 B）**  
   作为用户，当会话无法恢复历史模型、且我在蛋黄𝝅配置了 specific 默认时，即使客户端 pin 尚未到达，服务端 wrapper 也不应先落到 settings 虚空默认。

6. **会话选中优先于 yolk**  
   作为用户，我在历史会话里选了模型 N，冷启动后发送必须用 N，而不是被 yolk 默认抢走。

## 5. 验收场景（手工）

| # | 前置 | 操作 | 期望 |
| --- | --- | --- | --- |
| H1 | settings 默认 ≠ UI 模型；目标会话无 live | 打开会话 → 确认选择器为 M → 发送 | 首轮使用 M |
| H2 | 同 H1 | 发送成功后 agent_end | 选择器仍显示 M（非历史 assistant 错模覆盖） |
| H3 | 会话 idle 销毁（或手动重启服务清 registry） | 再发 | 再次 pin 到 M，使用 M |
| H4 | 有 live 且已是 M | 再发 | 可无 set_model；仍用 M |
| H5 | Chat 切换到 N 后立刻发送 | 发送 | 使用 N；settings 默认不变 |
| H6 | 新建空会话选 M | 首条 | 使用 M（回归） |
| H7 | set_model 目标不可用 | 发送 | 失败可见，不静默用虚空模型跑完 |
| H8 | **计划 B**：settings 虚空默认 ≠ yolk specific；会话**无可恢复模型**（或恢复失败）且无 UI pin 竞态窗口可观察 | 冷启动创建 wrapper（如仅 get_state / 先 set_model 前的初始态，或临时断开客户端 pin 的受控验证） | 初始 runtime **不是** settings 虚空默认，而是 yolk（或随后被 UI pin 覆盖为会话选中）；settings.json 仍不变 |
| H9 | 会话 path 有可恢复模型 S，yolk 为另一模型 Y，UI 选 S | 冷启动发送 | 用 S；不被 Y 覆盖 |
| H10 | yolk `mode=piDefault` | 无可恢复模型冷启动 | 允许 SDK/settings 行为；客户端 pin 仍保证 UI 模型 |

## 6. 非功能

- 额外成本：冷启动多 1 次客户端 `set_model`；服务端可能多 1 次 yolk set_model + thinking（可接受）。
- 兼容：不改 JSONL schema；不改公开 API 破坏性字段。
- 文档：更新 `docs/modules/frontend.md` / `docs/modules/library.md`（及 overview 一句）中 MODEL-PIN + yolk 冷启动契约。

## 7. 未决问题

见 [brief.md](./brief.md) U1–U5。架构师推荐默认已写入；**不阻塞**进入实现，除非用户在审批时否决推荐。

## 8. 成功度量

- H1–H10 中阻断相关场景全过（至少 H1、H3、H4、H5、H8、H9）。
- `npm run test:session-model-pin`、lint、tsc 通过。
- 无 settings.json 默认被 Chat / yolk 兜底改写的回归。
