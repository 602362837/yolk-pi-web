# Design — Chat 冷启动模型 pin（计划 B）

## 1. 方案摘要

**计划 A（主修复）**：把 `lastPinnedModelRef` 的语义收紧为 **“当前 live AgentSession 上已确认生效的模型”**。`loadSession` 无 live 时禁止用 path `context.model` 填充 lastPinned；`ensureSessionModel` 采用 **无 live 确认则必须 pin**，使 cold start 在 `prompt` 前被 session-scoped `set_model` 纠正到 **UI 选中模型**。

**计划 B（增量）**：在服务端 `startRpcSession` 创建 wrapper 后，若 **session 无法恢复有效模型**，且 `pi-web.json` 的 `yolk.defaultModel.mode === "specific"`，则用 **session-scoped** `set_model` + `set_thinking_level` 对齐蛋黄𝝅默认，**禁止**静默停留在 `settings.json` 虚空默认。`mode === "piDefault"` 时才回落 SDK/settings。

**不变**：

- 不把 Chat `set_model` 写回 `settings.json`（MODEL-PIN-3）。
- 不用 yolk 覆盖已有会话用户 UI 选中模型（客户端 pin 优先于服务端初始默认）。
- 不把 `yolk.defaultModel` 写成全局 settings 默认。

## 2. 影响模块与边界

| 模块 | 变更 | 边界 |
| --- | --- | --- |
| `hooks/useAgentSession.ts` | loadSession pin baseline；ensureSessionModel 冷启动强制 pin；live 死亡清空 confirmed | 不改消息流、SSE、usage |
| `lib/session-model-pin.ts` | 扩展 shouldPin（liveConfirmed）；可选 yolk fallback 纯函数 | 无 React 依赖 |
| `lib/rpc-manager.ts` | `startRpcSession` 后 apply 冷启动模型策略（session 恢复 > yolk > settings） | 不改 idle 10min 本身；不改 MODEL-PIN-3 包裹 |
| `lib/agent-session-bootstrap.ts` | 可选：新建空会话与 startRpcSession 兜底去重/对齐；body 显式 model 仍优先 | 不破坏 new/draft 已有 pin |
| `lib/pi-web-config.ts` | **只读** `readPiWebConfig().yolk`；不改 schema（除非文档注释） | 不写 settings |
| `scripts/test-session-model-pin.mjs` | pin + 可选 yolk-fallback 解析用例 | 不测真实 SDK |
| `docs/modules/frontend.md` / `library.md` / overview 一句 | 语义 | 不扩长文 |
| `app/api/agent/[id]/route.ts` | **v1 默认可不改**（逻辑进 startRpcSession 则 route 自动受益）；可选注释契约 | 仍信任客户端 pin 顺序 |
| Studio / failover | **不改** | 子会话只读 audit |

## 3. 当前错误数据流

```
打开历史会话 (无 live)
  loadSession
    liveModel = null
    lastPinned ← context.model   // BUG: 假 pin
  用户发送
    ensureSessionModel
      desired = M
      shouldPin(M, lastPinned=M) = false  // 跳过
    POST /api/agent/:id { type: prompt }
      startRpcSession → SDK model = settings default V (虚空)
      prompt on V
```

idle 后 lastPinned 仍可能 = M → 再次跳过 pin → 再落 V。

## 4. 目标数据流（计划 A + B）

### 4.1 有 UI 选中 / path 展示模型 M（主路径）

```
打开历史会话 (无 live)
  loadSession
    lastPinned = null（不写 context）
    display/desired 可用 context 或 override = M
  用户发送
    ensureSessionModel
      liveConfirmed = false → must set_model(M)
    POST set_model(M)     // 可能 cold-start wrapper
      startRpcSession
        SDK 可能先落 session 恢复模型 S 或 yolk Y 或 settings V
        applyColdStartFallback：若有 S 保持 S；否则 Y；piDefault 才 V
        然后 set_model(M) 覆盖为 UI
    POST prompt → 使用 M
```

### 4.2 无可恢复 session 模型 + yolk specific（计划 B 兜底窗口）

```
startRpcSession(open history without recoverable model)
  createAgentSessionFromServices → 可能短暂 V
  applyWebColdStartModelPolicy:
    no recoverable S
    yolk.mode=specific → set_model(Y) + set_thinking_level(Y.thinking)
  // wrapper 初始为 Y，不是 V
  // 客户端若 desired=M 仍会 pin 到 M
```

### 4.3 有可恢复 session 模型 S

```
startRpcSession
  SDK 或 path 指示 S 且 runtime 可解析
  apply：不套 yolk（即使 Y ≠ S）
  客户端 pin 到 UI desired（通常 ≈ S 或用户改选 N）
```

## 5. Pin 语义契约（计划 A · 核心）

### 5.1 定义

| 概念 | 含义 | 来源 |
| --- | --- | --- |
| **desired** | UI 希望使用的模型 | `resolveDesiredSessionModel`：override → newSession → pending → live → context |
| **display** | 选择器展示 | `resolveChatDisplayModel`：override → pending → live → context |
| **confirmedPin (`lastPinned`)** | 当前 **live** agent 已成功 set_model / create pin / get_state 确认 | 仅 live 路径写入 |
| **serverInitial** | wrapper 创建后、客户端 pin 前的 runtime 模型 | session 恢复 > yolk specific > settings/SDK |

### 5.2 写入 lastPinned 的合法来源

允许：成功 set_model；create body pin；includeState/GET live model；agent_end 后 live model。  
禁止：path `context.model` 单独冒充；仅 UI 赋值（未 set_model 成功）。

### 5.3 shouldPin 规则

```ts
export function shouldPinSessionModel(
  desired: SessionModelRef | null | undefined,
  lastPinned: SessionModelRef | null | undefined,
  options?: { liveConfirmed?: boolean },
): desired is SessionModelRef {
  if (!desired?.provider || !desired?.modelId) return false;
  if (options && options.liveConfirmed === false) return true;
  return !sessionModelsEqual(desired, lastPinned);
}
```

省略 `options` 时保持旧 equal 比较（兼容）；`useAgentSession` **必须**传明确 live 状态。

### 5.4 live 确认

推荐 `liveAgentConfirmedRef`：仅 set_model 成功 / create 成功 / get_state running+model / agent_end 且 GET 到 model 时 true；`loadSession` 无 live、GET running false、404 时 false。  
`ensureSessionModel`：`shouldPin(desired, lastPinned, { liveConfirmed: liveAgentConfirmedRef.current })`。

实现要点：

1. 删除 `else if (!lastPinned && contextModel) lastPinned = contextModel`。  
2. `includeState` 且无 liveModel → `lastPinned = null` 且 confirmed=false。  
3. 展示用 `liveSessionModel` 可保留 previous snapshot；**pin baseline 必须清空**。  
4. 只清 pin/confirmed，不清 selected/override。

## 6. 服务端冷启动策略（计划 B · 核心）

### 6.1 优先级（严格）

| 序 | 来源 | 条件 | 动作 |
| ---: | --- | --- | --- |
| 1 | **Session 可恢复模型** | path/JSONL（SessionManager / `buildSessionContext` 的 model）存在，且 `modelRuntime.getModel(provider, id)` 可解析 | **保持** SDK 已恢复结果；若 SDK 落错而 path 有 S，则 session-scoped set_model(S)（可选加固）；**不**套 yolk |
| 2 | **蛋黄𝝅 yolk.defaultModel** | `mode === "specific"` 且 provider/modelId 可解析 | session-scoped `set_model` + `set_thinking_level`（thinking 用 yolk.thinking / defaultThinkingLevel，并按模型能力 clamp） |
| 3 | **Pi settings / SDK 默认** | yolk `mode === "piDefault"`，或 yolk specific 解析失败 | 保持 `createAgentSessionFromServices` 结果（settings 兼容路径） |

> **无论 1/2/3 结果如何**，客户端无 liveConfirmed 时仍对 UI desired 强制 set_model（计划 A）。服务端兜底只缩短“错模窗口”并避免无 pin 路径的虚空默认。

### 6.2 推荐实现落点

**首选**：`lib/rpc-manager.ts` → `startRpcSession` 在 `createAgentSessionFromServices` + wrapper.start 之后、return 之前调用：

```ts
await applyWebSessionColdStartDefaults(wrapper, {
  sessionFile, // 空串 = 新会话
  sessionManager,
});
```

**职责拆分建议**（降低 rpc-manager 膨胀）：

| 函数 | 位置 | 职责 |
| --- | --- | --- |
| `resolveYolkColdStartModel(config)` | `session-model-pin.ts` 或小型 `lib/web-session-model-defaults.ts` | 纯函数：yolk → `{ provider, modelId, thinking } \| null`（piDefault → null） |
| `resolveSessionRecoverableModel(sessionManager)` | 同上或 session-reader 轻封装 | 从 session 读 path model（若可得） |
| `applyWebSessionColdStartDefaults(wrapper, ctx)` | `rpc-manager` 或 bootstrap 旁 | 编排：recoverable? → yolk? → no-op；set 时走 withSessionScopedSettingsDefaults |

### 6.3 与新建会话 bootstrap 的关系

`createConfiguredEmptyAgentSession` 今日流程：

1. `startRpcSession(temp, "", cwd, tools)`  
2. 若 body 有 provider/modelId → set_model  
3. 若 thinking → set_thinking_level  

计划 B 后：

- 若 create body **已带** model：body pin 仍优先；startRpcSession 内 yolk 兜底可能先于 body pin 执行——**可接受**（随后 body pin 覆盖）；或 apply 检测到 empty session 且调用方将 pin 时 skip（优化，非必须）。  
- 若 create body **未带** model 且 yolk specific：startRpcSession 兜底即可把空会话初始设为 yolk（与前端种子一致）。  
- **不要**在 bootstrap 再写一份冲突逻辑导致 double-write 到 settings。

### 6.4 Thinking

| 场景 | thinking |
| --- | --- |
| session 可恢复且 context 有 thinkingLevel | 优先保持 SDK/session 恢复；不强制 yolk thinking |
| yolk specific 兜底 | 应用 `yolk.defaultModel.thinking`（或 derived `defaultThinkingLevel`），经 `clampThinkingLevelToSupported` 若有 supported 列表 |
| 客户端后续 set_model | 既有 handleModelChange clamp 逻辑保留；本任务不强制扩展 ensureThinking，除非 cold-start 仅 pin 模型导致 thinking 错位且可测复现 |

### 6.5 判定 “session 可恢复模型” 的实现建议

按成本：

1. **P0**：读 `sessionManager` / 已打开 session 的 leaf context model（与 `buildSessionContext` / pi context 一致）。  
2. 若存在 `{provider, modelId|id}` 且 `wrapper.inner.modelRuntime.getModel` 非空 → 视为 recoverable。  
3. 若 SDK 创建后 `inner.model` 已等于 recoverable → no-op。  
4. 若 path 无 model → 进入 yolk 分支。  
5. **不要**把 “SDK 当前 model === settings 默认” 误判为 recoverable session 模型。

空 sessionFile（新建）：无历史 model → 直接 yolk/piDefault 分支。

### 6.6 失败策略

| 失败 | 行为 |
| --- | --- |
| yolk 模型 not found | 记录 warning；保留 SDK 结果；**不**写 settings；客户端 pin 仍可能成功/失败可见 |
| set_model throw | 与现有 Chat set_model 一致向上抛（若在 startRpcSession 内 catch 需文档化）；推荐：兜底失败不阻断 session 创建，避免“整个 cold start 挂死”，但日志可观测 |
| auth 不可用 | 模型对象可能仍存在；实际 prompt 失败由既有错误路径处理 |

**架构师推荐**：`applyWebSessionColdStartDefaults` 内 yolk apply **try/catch 降级**（创建仍成功），避免 startRpcSession 硬失败；客户端 pin 失败仍 throw 中止 send（计划 A）。

## 7. API / 文件契约

### 7.1 客户端 → `POST /api/agent/:id`

| 顺序 | type | 说明 |
| --- | --- | --- |
| 1 | `set_model` | cold start 时创建 wrapper（含服务端兜底）并 pin 到 UI |
| 1b | `set_thinking_level` | 既有切换模型路径；本任务不强制每 prompt 都发 |
| 2 | `prompt` / `steer` / `follow_up` | 必须在 1 成功后 |

### 7.2 `set_model` 服务端

保持 `withSessionScopedSettingsDefaults` + `modelRuntime.getModel`。  
Cold start 第一次 set_model 可能先 startRpcSession（含 yolk 兜底）再 setModel 覆盖——短窗口无 prompt，可接受。

### 7.3 可选 hardening（范围外默认）

prompt body 携带 provider/modelId 由 route 在 cold start 强制 pin。v1 **不做**。

## 8. 兼容性

- 旧 JSONL：只读 context.model 展示；pin 行为变更；服务端 recoverable 优先。  
- settings：Chat/yolk 兜底均不写回。  
- yolk：新建种子 + **冷启动兜底**；不覆盖会话 UI。  
- Studio 子会话：不走用户 Chat pin；startRpcSession 若被子会话复用需确认是否应 skip yolk——**审计**：Studio child runner 若走独立 `createAgentSessionFromServices` 则本改不影响；若复用 `startRpcSession`，应对 studioChild header **跳过 yolk 用户默认**或保持 follow 策略（实现时读 header.studioChild，**推荐 skip 用户 yolk 以免污染子会话策略**）。  
- PIN-3 测试扩展而非破坏。

## 9. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 清空 lastPinned 过激 → 每次 set_model | 多余 RPC | liveConfirmed 后 skip；单测 equal-skip |
| 仅修 context 不修 idle | 10min 复发 | confirmed 清空 |
| yolk 覆盖 session 历史模型 | 错模 | recoverable 优先；单测/H9 |
| yolk 覆盖 UI 选中 | 错模 | 客户端强制 pin；H1 |
| startRpcSession 对 Studio child 套 yolk | 子会话策略错 | studioChild skip |
| 兜底写 settings | 污染全局 | withSessionScoped；PIN-3 测试 |
| 双 set_model（yolk + UI） | 多余 RPC | 可接受；后续可优化 equal skip |
| 误判 recoverable | 仍落虚空或错保 | 严格 path model + getModel |

## 10. 回滚

1. 还原 hook / session-model-pin / rpc-manager（+ 新 helper 文件）/ 测试 / 文档。  
2. 无数据迁移。  

## 11. 实现员必读文件

1. `hooks/useAgentSession.ts` — loadSession / ensureSessionModel / handleSend / agent_end / handleModelChange  
2. `lib/session-model-pin.ts`  
3. `lib/rpc-manager.ts` — startRpcSession、set_model、idle  
4. `lib/agent-session-bootstrap.ts`  
5. `lib/pi-web-config.ts` — yolk.defaultModel 类型与 readPiWebConfig  
6. `lib/session-reader.ts` — buildSessionContext.model  
7. `app/api/agent/[id]/route.ts`  
8. `scripts/test-session-model-pin.mjs`  
9. `docs/modules/frontend.md`、`library.md`  
10. 本任务 brief/prd/checks  

## 12. 与既有 MODEL-PIN 工作的关系

| 编号 | 状态 | 本任务 |
| --- | --- | --- |
| MODEL-PIN-1 | pure helpers + ensure 串行 | 扩展 shouldPin liveConfirmed |
| MODEL-PIN-2 | 展示优先 live/override | 保持 |
| MODEL-PIN-3 | settings 隔离 | **禁止破坏**；yolk 兜底也必须隔离 |
| MODEL-PIN-4 | thinking clamp | yolk thinking 复用 clamp |
| **MODEL-PIN-CS-*** | 本任务 | 冷启动客户端 + 服务端 yolk |

子任务 ID：`MODEL-PIN-CS-01`…`04`。
