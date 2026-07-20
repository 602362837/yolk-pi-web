# Brief — Chat 首轮/冷启动未遵从会话选中模型（计划 B）

## 目标

修复 Chat 在**无 live agent**（首开历史会话、idle 10min 销毁后重开、abort 后部分时序）发送时，实际推理模型与 UI 选中模型不一致的严重 bug；并在**计划 B**中追加：服务端冷启动兜底优先 **蛋黄𝝅 `yolk.defaultModel` + thinking**，禁止静默落到 `~/.pi/agent/settings.json` 的虚空默认。

## 产品口径（用户已确认 · 计划 B）

| # | 口径 | 说明 |
| --- | --- | --- |
| P1 | **新建会话** | 遵循蛋黄𝝅 `yolk.defaultModel` + thinking（既有前端种子 + bootstrap pin） |
| P2 | **已有会话（含冷启动）** | 优先 **Chat 会话当前选中模型**（选择器 / 会话 pin） |
| P3 | **Pi `settings.json`** | 留给 CLI/SDK 兼容；**Chat 冷启动不应静默拿它当“会话模型”** |
| P4 | **服务端冷启动兜底** | 当无法从 session 恢复有效模型时，优先蛋黄𝝅默认（模型+思考）；`mode: piDefault` 时才回落到 settings/SDK 默认 |
| P5 | **兜底不替代主修复** | 服务端 yolk 兜底 **不能替代** “prompt 前 pin 到会话选中模型” 的客户端主修复 |
| P6 | **MODEL-PIN-3** | Chat `set_model` **不写回** `settings.json` 全局默认 |
| P7 | **不覆盖用户已选** | **不要**用 yolk 覆盖已有会话用户已选 / UI desired 模型 |

## 用户现象

| 现象 | 说明 |
| --- | --- |
| 首轮/冷启动错模 | 发送后实际使用的不是 Chat 选择器中的模型 |
| “虚空”模型 | 实际模型常来自 `~/.pi/agent/settings.json` 的 `defaultProvider/defaultModel`，**不是** Settings → 蛋黄𝝅 的 `yolk.defaultModel`，也可能不是 path 历史模型 |
| 不可用 | 虚空默认可能已无 auth / 已下线，导致首轮失败或异常 |
| abort/停后再发变好 | 第二轮起会触发 `set_model`，与 UI 对齐 |

## 本机证据（架构师验证）

| 来源 | 值 |
| --- | --- |
| `~/.pi/agent/settings.json` | `AITOB-OAI` / `gpt-5.6-luna` |
| `~/.pi/agent/pi-web.json` → `yolk.defaultModel` | `grok-cli` / `grok-4.5`（`mode: specific`） |

二者不一致，完美复现“虚空模型 ≠ Settings 里指定模型”。

## 根因结论（已验证）

### A. 客户端误把 path `context.model` 当作已 pin（主修复 · 计划 A）

`hooks/useAgentSession.ts` → `loadSession`：

```ts
} else if (!lastPinnedModelRef.current && contextModel) {
  lastPinnedModelRef.current = contextModel;
}
```

`lastPinnedModelRef` 语义本应是：**当前 live agent 上已成功应用的模型**。path `context.model` 来自 JSONL 历史（`buildSessionContext` → pi `buildSessionContext`），**不能**证明 live wrapper 已是该模型。

随后 `ensureSessionModel()` + `shouldPinSessionModel(desired, lastPinned)` 在 desired==context 时**跳过 `set_model`**。

### B. 冷启动默认源是 Pi settings，不是 yolk.defaultModel（主修复 + 计划 B 服务端）

`app/api/agent/[id]/route.ts` 在无 live session 时：

1. `startRpcSession(id, filePath, cwd)` → SDK `createAgentSessionFromServices`
2. **直接** `session.send(body)`（body 常为 `prompt`）

`startRpcSession` **不**根据 UI 选择 pin 模型；也**不**读取 `pi-web.json` 的 yolk 默认。新建会话路径 `createConfiguredEmptyAgentSession` 会在 prompt 前 `set_model`；**重开历史会话路径没有等价步骤**。

SDK 初始模型大致优先级：

1. 会话历史可恢复且有 auth 的模型  
2. 否则 `settings.json` 的 `defaultProvider/defaultModel`  
3. 再否则第一个 available model  

Web UI 的 `yolk.defaultModel` **只**用于新建空会话前端种子，**不**参与 cold start —— **计划 B 要补上服务端兜底**。

### C. idle 销毁后 lastPinned 仍“有效”（主修复 · 计划 A 补充）

`AgentSessionWrapper` idle **10 分钟** `destroy()` 后，客户端**收不到**“agent 已死”事件。此时：

- `lastPinnedModelRef` 仍是上一轮 live 确认过的正确模型  
- `shouldPinSessionModel(desired, lastPinned)` → **false** → 再次跳过 `set_model`  
- cold start 又落到 settings 虚空默认  

因此：**仅删除 context 误 pin 不够**；必须保证“无 live 确认时不得跳过 pin”。

### D. 为何 abort 后再发“变好”

1. 首轮：lastPinned 被 context（或陈旧确认）骗过 → 跳过 pin → 跑 cold-start 默认  
2. `agent_end` / `GET /api/agent` 把 `lastPinned` 更新为**真实跑过的错误模型**  
3. 若 UI desired ≠ 该错误模型 → 第二轮 `ensureSessionModel` 触发 `set_model` → 正确  

## 非根因 / 边界

| 项 | 说明 |
| --- | --- |
| MODEL-PIN-3 | `withSessionScopedSettingsDefaults` 阻止 Chat `set_model` 写回 settings；**应保持**，不是 bug |
| `/api/agent/new` + draft | `createConfiguredEmptyAgentSession` 已在 prompt 前 `set_model`；主 bug 路径是历史会话冷启动；计划 B 兜底与 new 路径对齐“yolk 优先于 settings” |
| 选择器展示 | `resolveChatDisplayModel` 优先 override/pending/live/context，展示可正确而执行错误 |
| 服务端单请求无法知 UI 模型 | cold-start 的 `prompt` body 当前不含 provider/modelId；**主修复仍以客户端 pin 为准**；服务端 yolk 只做“无 session 可恢复模型时”的初始默认替换 |

## 约束（产品/技术）

1. Chat `set_model` **session-scoped**，不写 `settings.json` 全局默认（MODEL-PIN-3）。  
2. **禁止**用 path `context.model` 冒充已 pin。  
3. 冷启动 / idle 销毁后重开：必须在 **prompt/steer/follow_up 前**对齐 UI 选中模型。  
4. 服务端 cold start：session 可恢复模型 > yolk specific > settings/SDK（仅 piDefault）。  
5. yolk 兜底 **不得**覆盖客户端随后 pin 的会话选中模型。  
6. 不重置/覆盖无关用户改动。  
7. 无用户可见页面/交互结构变化 → **不触发 UI 原型门禁**（见 `ui.md`）。

## 修复方向（计划 A + B）

### 计划 A（客户端 pin 语义 · 主修复）

1. **Pin 语义**：`lastPinned` 仅表示“当前 live agent 已确认”；无 live 时清空或视为 unconfirmed。  
2. **ensureSessionModel**：无 live 确认则必须 `set_model`；有 live 且 equal 才可跳过。  
3. **测试**：扩展 `scripts/test-session-model-pin.mjs` 覆盖 cold-start / idle-reopen / context-not-pin。

### 计划 B 增量（服务端 yolk 冷启动兜底）

1. 在 `startRpcSession`（或紧随其后的统一 apply 点）对 **新建/重开** wrapper：  
   - 若 session 可恢复有效模型（JSONL / SDK 已恢复且 auth 可用）→ **保持**，不套 yolk。  
   - 否则若 `yolk.defaultModel.mode === "specific"` → session-scoped `set_model` + 对应 `set_thinking_level`。  
   - 若 `mode === "piDefault"` → 维持 SDK/settings 行为。  
2. 兜底使用 `readPiWebConfig().yolk`；**禁止**写 `settings.json`。  
3. 客户端主修复仍必须存在：无论服务端初始是 session 模型还是 yolk，**无 liveConfirmed 时对 UI desired 强制 set_model**。  
4. 可选纯函数：解析 yolk → fallback model/thinking，便于单测。

详细方案见 [design.md](./design.md)、[implement.md](./implement.md)。

## 未决问题（不阻塞规划；推荐默认）

| # | 问题 | 推荐 |
| --- | --- | --- |
| U1 | idle 后是否“总是 set_model”还是“先 get_state 再决定” | **无 live 确认则总是 pin**（多一次幂等 set_model，可接受） |
| U2 | 是否服务端 prompt 携带 model 双保险 | **v1 不做**；客户端契约 + 服务端 yolk 兜底已足够 |
| U3 | context.model 是否仍用于**展示** | **是**；只禁止用于 pin baseline |
| U4 | 服务端如何判定“session 已有可恢复模型” | 优先读 SessionManager/path context 的 model；若 SDK 已恢复同模型则 no-op；仅当无 path model 或 runtime 解析失败时才 yolk |
| U5 | yolk 模型 auth 不可用时 | 尝试 set 失败则 **保留 SDK 结果并记录/抛错策略与现有 set_model 一致**；不静默改写 settings；客户端后续 pin 仍可能失败可见 |

## 计划对比

| 维度 | 计划 A（原） | 计划 B（用户选定） |
| --- | --- | --- |
| 客户端误 pin | 修 | 修（保留） |
| 无 live 强制 pin | 是 | 是（保留） |
| 服务端 cold-start 默认 | 仍可能 settings 虚空 | **优先 yolk specific + thinking** |
| MODEL-PIN-3 | 保持 | 保持 |
| 用 yolk 改写 settings 全局默认 | 否 | 否 |
| 用 yolk 覆盖会话 UI 选中 | 否 | 否 |
