# 计划审批书：修复 Chat 冷启动未遵从会话选中模型（计划 B）

## 审批结论请求

请审阅本计划。**批准前任务不得进入实现**；批准后由主会话指派 **implementer**，并按 [implement.md](./implement.md) DAG 执行。

本任务 **无 UI 原型门禁**（见 [ui.md](./ui.md)），审批焦点是行为契约、计划 B 增量与实现范围。

## 计划 B 相对计划 A 的增量（必读）

用户明确选择 **计划 B** = **计划 A 全部保留** + **服务端冷启动兜底优先蛋黄𝝅**。

| 维度 | 计划 A | 计划 B（本次） |
| --- | --- | --- |
| 客户端误 pin / 无 live 强制 pin | ✅ | ✅ 保留 |
| MODEL-PIN-3（不写 settings） | ✅ | ✅ 保留 |
| 服务端 cold-start 默认 | 仍可能 settings 虚空 | **session 可恢复 > yolk specific+thinking > settings/SDK** |
| 用 yolk 覆盖会话 UI 选中 | 否 | **否**（客户端 pin 仍是主修复） |
| 用 yolk 写回 settings 全局默认 | 否 | **否** |
| 子任务 | CS-01..03 | **CS-01..04**（新增服务端 CS-03，docs→CS-04） |

### 产品口径（已写入 PRD）

1. **新建会话**：蛋黄𝝅 `yolk.defaultModel` + thinking  
2. **已有会话**：优先 Chat 会话当前选中模型  
3. **settings.json**：CLI/SDK 兼容；Chat 冷启动不静默当会话模型  
4. **服务端兜底**：无法恢复 session 模型时优先 yolk（specific）；`piDefault` 才回落 settings  
5. **兜底不替代** prompt 前 pin 到会话选中模型  

## 目标与范围

修复：无 live agent 时发送误用 SDK/`settings.json` 默认模型；并避免冷启动静默落到虚空 settings（在 yolk specific 配置下）。

- 背景与根因：[brief.md](./brief.md)  
- 需求与验收：[prd.md](./prd.md)  
- 技术设计：[design.md](./design.md)  
- 实现 DAG：[implement.md](./implement.md)  
- 检查清单：[checks.md](./checks.md)  
- UI 门禁：[ui.md](./ui.md)

### 范围内

- 客户端 pin 语义修正 + 单测  
- 服务端 `startRpcSession` 冷启动策略（session > yolk > settings）  
- 文档一句/短段  
- 保持 MODEL-PIN-3 session-scoped  

### 范围外

- 用 yolk **写回** `settings.json` 全局默认  
- 用 yolk **覆盖** 已有会话用户已选模型  
- 模型选择器 UI 改版  
- 服务端 prompt 内嵌 model 双保险（可选增强，默认不做）  
- Studio 子会话 / failover 协议重写  

## 根因结论（已对照代码与本机配置）

1. **客户端误 pin**：`loadSession` 把 path `context.model` 写入 `lastPinned` → 跳过 `set_model`。  
2. **冷启动默认源错误**：`startRpcSession` → SDK 初始模型来自会话可恢复模型或 **`settings.json`**，**不是** `yolk.defaultModel`。本机 settings=`AITOB-OAI/gpt-5.6-luna`，yolk=`grok-cli/grok-4.5`。  
3. **idle destroy** 后 lastPinned 仍“有效”会再次跳过 pin。  
4. **abort 后再发变好**：agent_end 更新 lastPinned 为真实错模后第二次才 pin。  

## 方案摘要

| 层 | 做法 |
| --- | --- |
| 客户端 pin | `lastPinned` = live 已确认；context 只展示/desired；无 liveConfirmed 强制 set_model |
| 服务端兜底 | recoverable session model → 保持；否则 yolk specific + thinking；piDefault → SDK/settings |
| 隔离 | 所有 Chat/yolk set_model 走 `withSessionScopedSettingsDefaults` |
| 优先级终局 | **UI desired（客户端 pin）> serverInitial（session/yolk/sdk）** |
| 测试 | 扩展 `npm run test:session-model-pin` |

## UI 审批门禁

**不触发。** 详见 [ui.md](./ui.md)。可选 Settings 静态说明一句，不强制 HTML 原型。

## 实施 DAG 摘要

| 顺序 | ID | 子任务 | 依赖 |
| ---: | --- | --- | --- |
| 1 | MODEL-PIN-CS-01 | pin + yolk 解析纯函数与单测 | — |
| 2 | MODEL-PIN-CS-02 | 修 `useAgentSession` 冷启动/idle 基线 | 01 |
| 3 | MODEL-PIN-CS-03 | 服务端 startRpcSession 冷启动兜底 | 01 |
| 4 | MODEL-PIN-CS-04 | 文档 + lint/tsc/测试 | 02, 03 |

机器可读计划：[implement.md](./implement.md)（`schemaVersion: 2`，4 子任务）。

## 检查与验收

自动：

```bash
npm run test:session-model-pin
node_modules/.bin/tsc --noEmit
npm run lint
```

手工：PRD H1–H10（至少 H1、H3、H4、H5、H8、H9）。完整清单：[checks.md](./checks.md)。

## 风险与回滚

- 误判 live → 多余 set_model：独立 `liveAgentConfirmedRef`。  
- 误清 UI selection：只清 pin/confirmed。  
- yolk 覆盖历史 session 模型：recoverable 优先 + H9。  
- yolk 覆盖 UI 选中：客户端强制 pin + H1。  
- 破坏 settings 隔离：PIN-3 + withSessionScoped。  
- Studio child 误套 yolk：header 跳过。  
- 回滚：还原 hook + pin helper + rpc-manager/helper + 测试 + 文档；无迁移。  

## 推荐产品/技术决策（请确认或否决）

1. **无 live 确认时强制 pin**（即使 lastPinned 字符串等于 desired）。  
2. **服务端冷启动**：session 可恢复 > yolk specific+thinking > settings（仅 piDefault 或 yolk 失败）。  
3. **v1 不做**服务端 prompt 携带 model 双保险。  
4. **不统一** settings 与 yolk 为单一全局源（职责分离）。  
5. **无 UI 门禁**，直接审行为计划。  
6. yolk apply 失败时 **降级保留 SDK 结果** 不阻断 session 创建；客户端 pin 失败仍中止 send。  

## 请确认

若同意根因、计划 B 增量、四子任务 DAG、检查清单与上述决策，请明确回复 **批准**；否则指出需修改点。批准前保持 `awaiting_approval`，**禁止**进入 `implementing`。
