# Review — Chat 冷启动模型 pin（计划 B）

## Verdict

**Pass（代码门禁通过；手工 H1–H10 为 residual UAT）**

实现完整覆盖计划 B 的客户端主修复 + 服务端 yolk 冷启动兜底，自动单测全绿；未发现需返工的阻断项。手工浏览器场景本环境无法执行，记为 residual，不掩盖代码级结论。

## Findings Fixed

None（检查阶段未改代码）。

## Remaining Findings

### 非阻断 / Residual

1. **Idle destroy 且页面不 reload 时，客户端可能仍跳过 set_model**  
   `liveAgentConfirmedRef` 在 `loadSession(includeState)` 无 live 时会清空，但服务端 10min idle `destroy()` 不主动通知前端。若用户停在同一会话页超过 idle 后再发，且 `desired == lastPinned`，客户端会 skip pin。  
   **缓解**：服务端 `applyWebSessionColdStartDefaults` 会优先恢复 path `model_change`，或 yolk specific；与 UI 通常一致。仅当 recoverable 失败且 yolk 不可用时，仍可能落到 settings 虚空。  
   **建议跟进**（非本轮阻断）：发送前探测 live（get_state）或在 `!agentRunning` 且距上次确认过久时强制 pin。

2. **yolk thinking 在 `withSessionScopedSettingsDefaults` 外调用 `setThinkingLevel`**  
   与现有 Chat `set_thinking_level` 路径一致；若 SDK 内部写 settings thinking 默认，属既有面，非本次引入的 model 默认污染。MODEL-PIN-3 对 provider/model 仍有保护。

3. **手工 H1–H10 未跑**  
   本检查环境无运行中的 pi web + 不一致 settings/yolk 配置，无法浏览器验收。见下表 residual。

### 阻断项对照（checks.md §6）

| # | 阻断项 | 结论 |
| --- | --- | --- |
| 1 | 无 live 首轮仍可能跳过 set_model | **通过** — `liveConfirmed=false` 强制 pin；`loadSession(includeState)` 无 live 清空 baseline |
| 2 | context.model 仍写入 lastPinned | **通过** — 已删除 context→lastPinned；context 仅 seed display/desired |
| 3 | Chat set_model / yolk 兜底写回 settings | **通过** — 均 `withSessionScopedSettingsDefaults`；PIN-3 单测保留 |
| 4 | yolk specific 且无可恢复模型时仍静默 settings 虚空 | **通过（代码）** — `applyWebSessionColdStartDefaults` 走 yolk；客户端仍强制 pin |
| 5 | yolk 覆盖会话 UI 选中 | **通过** — 客户端 unconfirmed 必 pin UI；服务端仅 serverInitial |
| 6 | 自动测试失败 | **通过** — 22/22 |

## 代码审查摘要

### CS-01 `lib/session-model-pin.ts` + 单测

- `shouldPinSessionModel(..., { liveConfirmed: false })` → 有效 desired 总是 pin；省略 options 保持旧 equal 语义。
- `resolveYolkColdStartModel`：specific → model+thinking；piDefault/缺字段 → null。
- `resolveColdStartModelPreference`：recoverable > yolk > sdk。
- 文件头 invariants 与 MODEL-PIN-3 说明齐全。
- 测试新增 8 例，PIN-1..4 全保留。

### CS-02 `hooks/useAgentSession.ts`

- 删除 `contextModel → lastPinned`。
- `liveAgentConfirmedRef` 在 set_model / create / live get_state / agent_end GET 成功时 true；404 / includeState 无 live 时 false。
- `ensureSessionModel` 传 `{ liveConfirmed }`；prompt / steer / follow_up 均 await ensure。
- 展示 snapshot 与 pin baseline 分离；未误清 selected/override。

### CS-03 `lib/rpc-manager.ts`

- `startRpcSession` 在 wrapper.start 后调用 `applyWebSessionColdStartDefaults`。
- 优先级：path `model_change` + `getModel` → yolk specific + thinking → SDK/settings。
- Studio child（header `studioChild`）整段 skip。
- setModel 均 session-scoped；失败 try/catch 降级不阻断创建。
- 新建 `sessionFile===""` 无 recoverable → yolk/piDefault；bootstrap body pin 仍可覆盖。

### CS-04 文档

- `docs/modules/frontend.md` / `library.md` / `architecture/overview.md` 与实现一致：两套默认源职责、冷启动优先级、UI pin 优先、不写 settings。

### 未改 / 边界

- 无 UI 结构变更；`ui.md` 无原型门禁要求。
- 未引入 prompt body model 双保险（范围外）。
- 未写 settings 全局默认；未用 yolk 覆盖 UI desired。

## Verification

| 命令 | 结果 |
| --- | --- |
| `npm run test:session-model-pin` | **Pass** — 22/22（含 CS-01 8 例 + PIN-1..4） |
| `node_modules/.bin/tsc --noEmit` | **Blocked by env** — 本 worktree 未安装 `typescript` / `@types/node`（`node_modules` 基本为空）；全局 tsc 非项目配置。**非本次 diff 引入**。静态阅读实现类型可被 hooks/rpc-manager 直接使用，无 any 逃生。 |
| `npm run lint` | **Blocked by env** — `eslint-config-next` 未安装。**非本次 diff 引入**。 |

### 手工验收（residual UAT）

| # | 期望 | 结果 |
| --- | --- | --- |
| H1 | 冷开历史会话首轮 = UI 模型 | ☐ 待 UAT（代码路径满足） |
| H2 | 发送后选择器仍 = UI | ☐ 待 UAT |
| H3 | idle/清 registry 后再发 | ☐ 待 UAT（见 residual #1） |
| H4 | live 已对齐可跳过 pin | ☐ 待 UAT |
| H5 | 切换后立刻发；settings 不变 | ☐ 待 UAT |
| H6 | 新建会话首条正确 | ☐ 待 UAT（bootstrap 未回归改坏） |
| H7 | 不可用模型错误可见 | ☐ 待 UAT |
| H8 | 无可恢复 + yolk specific 不落 settings 虚空 | ☐ 待 UAT |
| H9 | 可恢复 S 不被 yolk Y 覆盖 | ☐ 待 UAT |
| H10 | piDefault 允许 SDK/settings | ☐ 待 UAT |

## 需求覆盖（R1–R14）

| 需求 | 结论 |
| --- | --- |
| R1 历史首轮 UI 模型 | 通过（代码） |
| R2 context 不冒充 pin | 通过 |
| R3 live 对齐可跳过 | 通过 |
| R4 idle 后必 pin | 部分：reload/includeState 路径通过；纯 idle 无通知见 residual #1 |
| R5 MODEL-PIN-3 | 通过 |
| R6 new/draft | 通过（审计无回归逻辑） |
| R7 pin 失败中止 send | 通过 |
| R8 steer/follow_up | 通过 |
| R9 单测 | 通过 |
| R10–R14 服务端 yolk / 优先级 / 不替代客户端 / piDefault / 隔离 | 通过（代码） |

## nextRecommendedAction

1. 主会话可将任务推进至 **review / ready for user acceptance**（或项目约定的下一状态）。
2. 用户/UAT 至少补跑 **H1、H3、H4、H5、H8、H9**（settings 虚空 ≠ yolk specific 配置）。
3. 可选跟进：idle destroy 客户端感知（非阻断）。
4. **不需要** changes_requested；**不需要** 架构师/UI 返工。
