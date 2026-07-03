# Implement

## 执行步骤

1. **抽取策略解析**
   - 新增 `lib/ypi-studio-policy.ts`。
   - 从 `lib/ypi-studio-extension.ts` 移出 `resolveStudioModel/resolveStudioThinking/resolveStudioMemberPolicy`。
   - 增加 canonical member id、config parse diagnostics、fallback chain、warnings。
   - `ypi_studio_subagent` tool guideline 加一句：不要主动传 `model/thinking`，除非用户明确要求覆盖 Settings。

2. **接入 policy diagnostics**
   - `lib/ypi-studio-extension.ts` 使用 `readPiWebConfigForApi()` 而不是只用 `readPiWebConfig()`，以保留 `exists/parseError`。
   - running/final `YpiStudioTaskSubagentRun` 写入 `policy`，并继续写兼容字段 `model/thinking/modelSource/thinkingSource`。
   - progress/final `details.run` 带 `policy` 和聚合后的 `warnings`。

3. **实现 child progress 状态机**
   - 在 `runChildPi` 内维护 `phase/eventCount/outputChars/tokens/tps/currentTool/firstTokenAt/lastTokenAt`。
   - 解析 `message_update` delta；无 delta 时用 message content diff；`message_end` 用 final assistant text 修正 token 估算。
   - `tool_execution_start/end` 切换 `running_tool/waiting_model`。
   - `extension_ui_request` 切换 `waiting_for_user`。
   - finish/abort/error 切换 `finished`。
   - `progressPayload()` 输出新 `progress` shape。

4. **更新共享类型**
   - `lib/ypi-studio-types.ts` 增加 policy/progress 类型。
   - 扩展 `YpiStudioTaskSubagentRun`、`YpiStudioLiveRunOverlay`。
   - `hooks/useAgentSession.ts` 仅保留边界为 unknown，但让 `ToolExecutionProgress` 可承载新 details。

5. **前端 normalizer 与 UI**
   - 可选新增 `lib/ypi-studio-live-progress.ts`，统一解析 `details.run.progress/policy`。
   - `components/YpiStudioSubagentTranscript.tsx`：
     - 增加 `debugExpanded/rawExpanded/fullFinalExpanded/showPrompt` state。
     - Header 展示 phase/tokens/tps/currentTool/warning。
     - Expanded 默认 summary + compact items。
     - Debug/raw 二级开关。
   - `components/ChatWindow.tsx`：live overlay 提取新字段。
   - `components/YpiStudioSessionWidget.tsx`：live member run 显示 phase 与 t/s。
   - `components/SettingsConfig.tsx`：更新 Studio priority/fallback 文案。

6. **文档**
   - 更新 `docs/modules/library.md`、`docs/modules/frontend.md`、`docs/architecture/overview.md`。

## 需先阅读的文件

- `docs/standards/code-style.md`
- `docs/modules/library.md`
- `docs/modules/frontend.md`
- `docs/architecture/overview.md`
- `lib/pi-web-config.ts`
- `lib/ypi-studio-extension.ts`
- `lib/ypi-studio-types.ts`
- `components/SettingsConfig.tsx`
- `components/YpiStudioSubagentTranscript.tsx`
- `hooks/useAgentSession.ts`
- `components/ChatWindow.tsx`
- `components/YpiStudioSessionWidget.tsx`

## 验证命令

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

不要直接运行 `next build`。

## 手工验证场景

1. **toolInput 覆盖 Settings**
   - Settings 将 architect 配成模型 A。
   - 手动让 `ypi_studio_subagent(member=architect, model=B)` 执行。
   - 预期：child 用 B；header/source 显示 `toolInput`；warning/diagnostic 明确覆盖 Settings。

2. **memberConfig 生效**
   - Settings 将 checker 配成 specific 模型 C、thinking high。
   - 执行 `member=checker` 且不传 model/thinking。
   - 预期：child args 带 C/high；UI source 为 memberConfig。

3. **member unset -> defaultPolicy**
   - 将 implementer model 设为 unset，defaultPolicy 设 specific D。
   - 执行 implementer。
   - 预期：模型 D；diagnostics fallbackChain 包含 memberConfig(unset) -> defaultPolicy。

4. **followMain unavailable -> piDefault**
   - 构造无法读取 `ctx.model` 的场景或通过单元/fixture 调 resolver。
   - 预期：不传 `--model`；warning `follow_main_model_unavailable`。

5. **member id canonicalize**
   - 执行 `member=Architect`。
   - 预期：读取 `.ypi/agents/architect.md` 和 `studio.members.architect`；diagnostic 记录 normalized。

6. **Transcript summary/debug**
   - 跑一个含工具调用的 Studio member。
   - 默认折叠 header 不刷屏。
   - 展开默认只显示 compact summary。
   - Debug 显示 status/stderr/prompt；Raw 显示 JSON。

7. **Phase/tps**
   - 运行中观察 phase 从 starting/waiting_model/streaming/running_tool/finished 变化。
   - streaming 时出现 tokens 和 t/s；running_tool 时显示当前 tool。
   - child 发 interactive request 时显示 waiting_for_user。

## 检查门禁

- 不改变 production code 以外的用户无关文件。
- 不修改 YPI Studio approval gate 语义。
- 不把完整 transcript body 注入 session widget 或默认 Chat 展开态。
- 不在 diagnostics 中暴露过长 prompt / full config；只给 path label、source、fallback、warning。
- 所有新增字段 optional，旧 task/transcript 可正常渲染。

## 回滚方案

- 若 policy resolver 出问题：回滚 `lib/ypi-studio-policy.ts` 接入，保留原 inline resolver。
- 若 UI 过于复杂：保留 header metrics，回滚 debug/raw 分层到原 transcript 渲染。
- 若 t/s 估算不准：隐藏前端 t/s，仅保留 phase；后端执行不受影响。
