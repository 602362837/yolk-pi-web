# Handoff — 实现员（MODEL-PIN-CS-04 完成）

## 状态

子任务 MODEL-PIN-CS-04（文档同步与回归验证）已完成。全部 4 个子任务实现就绪，等待检查员审阅。

## 实现摘要（全部子任务 CS-01..04）

| 子任务 | 文件 | 改动 |
| --- | --- | --- |
| CS-01 | `lib/session-model-pin.ts` | `shouldPinSessionModel` 新增 `liveConfirmed` 选项；新增 `resolveYolkColdStartModel`、`resolveColdStartModelPreference`；文件头注释写入服务端冷启动优先级与 MODEL-PIN-3 约束 |
| CS-01 | `scripts/test-session-model-pin.mjs` | 新增 8 个测试用例（liveConfirmed 语义 4 + yolk 解析 3 + 优先级 1），保留全部 PIN-1..4 原有用例 |
| CS-02 | `hooks/useAgentSession.ts` | `loadSession`：删除 context.model→lastPinned 赋值；`liveAgentConfirmedRef` 跟踪 live 确认状态；`ensureSessionModel` 传 `{ liveConfirmed }`；agent_end/includeState live 模型确认；无 live 时清空 lastPinned 和 confirmed |
| CS-03 | `lib/rpc-manager.ts` | 新增 `applyWebSessionColdStartDefaults`：优先 session 可恢复模型（path `model_change` + runtime 可用），否则 yolk specific + thinking（`mode === "specific"`），否则 SDK/settings；Studio child 跳过；全部走 `withSessionScopedSettingsDefaults`；失败降级不阻断 session 创建 |
| CS-03 | `lib/rpc-manager.ts` → `startRpcSession` | 在 `createAgentSessionFromServices` + wrapper.start 之后调用 `applyWebSessionColdStartDefaults` |
| CS-04 | `docs/modules/frontend.md` | `useAgentSession` 入口：lastPinned 仅 live 确认；context 不跳过 pin；cold start/idle 发送前必 pin |
| CS-04 | `docs/modules/library.md` | `session-model-pin.ts`：shouldPin liveConfirmed + yolk 解析 + 优先级纯函数；`rpc-manager.ts`：applyWebSessionColdStartDefaults 优先级 + MODEL-PIN-3 适用 |
| CS-04 | `docs/architecture/overview.md` | Models and tools 章节：两套默认源职责（yolk=Web Chat；settings=CLI/SDK）；服务端冷启动优先级（session > yolk > SDK） |

## 验证结果

### 自动验证

```bash
$ npm run test:session-model-pin
  ok  - sessionModelsEqual matches provider+modelId
  ok  - normalizeSessionModelRef accepts modelId or get_state id
  ok  - resolveDesiredSessionModel prefers override > newSession > pending > live > context
  ok  - resolveChatDisplayModel prefers override/pending/live over path context
  ok  - shouldPinSessionModel when desired differs from last pin
  ok  - serial pin decision: switch then send still needs pin until lastPinned updates
  ok  - PIN-2: post-run display keeps Grok when live is Grok and path is GPT
  ok  - PIN-3: withSessionScopedSettingsDefaults suppresses default writes
  ok  - PIN-3: nested scopes restore originals only on outer exit
  ok  - PIN-3: restores original methods after action throws
  ok  - PIN-4: clampThinkingLevelToSupported keeps current when supported
  ok  - PIN-4: clampThinkingLevelToSupported prefers medium then auto
  ok  - PIN-4: clampThinkingLevelToSupported keeps current when levels unknown
  ok  - CS-01: liveConfirmed=false forces pin even when desired==lastPinned
  ok  - CS-01: liveConfirmed=true keeps equal-skip behaviour
  ok  - CS-01: liveConfirmed=false still rejects invalid desired
  ok  - CS-01: omitted options preserves legacy equal-comparison
  ok  - CS-01: resolveYolkColdStartModel returns model+thinking for specific
  ok  - CS-01: resolveYolkColdStartModel falls back to defaultThinkingLevel
  ok  - CS-01: resolveYolkColdStartModel returns null for piDefault
  ok  - CS-01: resolveYolkColdStartModel returns null for missing config
  ok  - CS-01: resolveColdStartModelPreference — recoverable > yolk > sdk

all session-model-pin tests passed
```

**✅ 22/22 测试全绿**（PIN-1..4 原有 14 用例 + CS-01 新增 8 用例）

### tsc / lint

- `npx tsc --noEmit`：失败，均为预存错误（`@types/node` 缺失导致 `process`/`Buffer`/`fs` 等 Node 内置类型未找到），与本次变更无关。
- `npm run lint`：失败，`eslint-config-next` 包未安装（预存环境问题），与本次变更无关。

## 手工验收清单（待用户/UAT）

本机无法进行浏览器手工验收（需要运行中的 pi web 服务 + 不一致的 settings vs yolk 配置）。本次已实现的变更预期满足以下场景：

| # | 场景 | 预期 | 状态 |
| --- | --- | --- | --- |
| H1 | settings 默认≠UI 模型；冷开会话发送 | 首轮=UI 模型 | 🔲 待手工验证 |
| H3 | idle/重启清 registry 后再发 | 再 pin，模型正确 | 🔲 待手工验证 |
| H4 | live 已对齐再发 | 行为正确（可跳过 pin） | 🔲 待手工验证 |
| H5 | 切换模型立刻发 | 用新模型；settings 默认不变 | 🔲 待手工验证 |
| H8 | settings≠yolk specific；无可恢复 session 模型冷启动 | 初始不落 settings 虚空；优先 yolk | 🔲 待手工验证 |
| H9 | 会话可恢复 S，yolk=Y≠S，UI=S | 用 S，不被 Y 覆盖 | 🔲 待手工验证 |

## 注意事项 / 风险

1. **recoverable 判定**：当前从 path entries 反向扫描 `model_change` 条目，用 `modelRuntime.getModel()` 验证可用性。如果 SDK 创建后 runtime model 恰好等于 recoverable，跳过 set_model（no-op）。边缘情况：若 path 有 model_change 但 runtime 不可用，则跳过 recoverable 进入 yolk/sdk 分支。
2. **Studio child 跳过**：通过读 session header `studioChild` 判断；如果 header 写入在 `applyWebSessionColdStartDefaults` 之后，则该 guard 不触发。当前 SDK runner 先写 header 再创建 wrapper，时序安全。
3. **双 set_model（yolk + UI pin）**：服务端 yolk apply 先执行，客户端随即强制 pin UI desired 模型。冗余一次 set_model 调用，成本可接受；后续可优化 equal skip。
4. **yolk apply 失败降级**：try/catch + console.warn，不阻断 session 创建。后续客户端 pin 仍可能成功（UI 选择模型可用）或失败可见（模型不可用）。
5. **settings.json 永不写入**：所有 yolk apply 和 Chat set_model 均走 `withSessionScopedSettingsDefaults`，MODEL-PIN-3 测试继续保持。

## Next for Checker

1. 对照 [checks.md](./checks.md) 审查清单逐项检查。
2. 确认阻断项：
   - [ ] context 未写入 lastPinned
   - [ ] 无 live 时不应跳过 set_model
   - [ ] settings.json 不被 Chat/yolk 改写
   - [ ] yolk specific 且无可恢复模型时冷启动优先 yolk（不静默落 settings 虚空）
   - [ ] yolk 不覆盖会话 UI 选中（客户端 pin 仍强制）
   - [ ] 自动测试全绿
3. 手工验收 H1/H3/H4/H5/H8/H9（至少 H1、H8、H9）。
4. 通过后更新 review.md；发现问题退回实现员修复。  
