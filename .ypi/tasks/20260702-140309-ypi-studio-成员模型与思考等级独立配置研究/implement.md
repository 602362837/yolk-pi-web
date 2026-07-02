# Implement — 建议实现步骤

## 需先阅读的文件

- `docs/modules/frontend.md`
- `docs/modules/api.md`
- `docs/modules/library.md`
- `docs/architecture/overview.md`
- `lib/pi-web-config.ts`
- `lib/ypi-studio-extension.ts`
- `lib/ypi-studio-types.ts`
- `lib/ypi-studio-tasks.ts`
- `components/SettingsConfig.tsx`
- `components/YpiStudioSubagentTranscript.tsx`
- `components/YpiStudioPanel.tsx`
- `hooks/useAgentSession.ts`
- `app/api/web-config/route.ts`

## 执行步骤

1. **扩展配置类型**
   - 在 `lib/pi-web-config.ts` 增加 `PiWebStudioConfig` 与 `PiWebConfig.studio`。
   - 默认值加入 `studio.defaultPolicy` 和四个默认成员策略。
   - 增加 normalize / validate / write patch 支持。
   - `PiWebConfigPatch` 增加 `studio?: unknown`。
   - `app/api/web-config/route.ts` PUT body 类型同步增加 `studio`。

2. **实现策略解析 helper**
   - 在 `lib/ypi-studio-extension.ts` 引入 `readPiWebConfig()`。
   - 新增 `resolveStudioMemberPolicy(input, member, ctx, getThinkingLevel)`，返回 model/thinking 的 CLI 参数、展示 label 和来源。
   - `specific` 模型解析为 `${provider}/${modelId}`；`followMain` 使用 `ctx.model.provider` / `ctx.model.id`；`piDefault` / `unset` 不传 CLI 参数。
   - thinking 为 `inherit` 时优先用 `pi.getThinkingLevel?.()`，拿不到则不传 CLI 参数并展示 `inherit` / `default`。

3. **改造 child Pi 启动**
   - 将 `buildPiArgs(input)` 改为 `buildPiArgs(resolved)`。
   - 使用 `--model` 与 `--thinking` 分离参数。
   - `runChildPi()` 的 `spawn(... env ...)` 增加 `TRELLIS_SUBAGENT_CHILD: "1"`。
   - `buildMemberPrompt()` 增加 YPI-only / ignore Trellis 规则。

4. **写入并返回实际元数据**
   - `runningRun` 写入 `model`、`thinking`、可选 `modelSource`、`thinkingSource`。
   - 初始 `onUpdate`、`progressPayload()`、最终 `details.run` 都包含相同元数据。
   - `appendYpiStudioSubagentTranscriptItem()` 的 assistant item model 使用 resolved label。
   - `lib/ypi-studio-types.ts` / `lib/ypi-studio-tasks.ts` 如采用 source 字段，则补类型与 normalize。

5. **Settings UI**
   - `components/SettingsConfig.tsx`：`SettingsSection` 增加 `studio`，load/save state 增加 `studio` / `savedStudio`。
   - 增加 Studio section nav 项。
   - 新增默认策略和四成员策略表单，复用 `ModelPolicySelect`、`ThinkingSelect`、`Field`。
   - dirty 比较包含 `studioConfigsEqual()`。

6. **Chat 展示**
   - `components/YpiStudioSubagentTranscript.tsx`：扩展 projection source 字段。
   - 折叠 header 增加 model/thinking chips；展开 Meta title 展示来源。
   - 保持从 input/progress/final 合并，但 progress/final 应覆盖 input。

7. **文档更新**
   - `docs/modules/library.md`：更新 `pi-web-config`、`ypi-studio-extension`、types/tasks 描述。
   - `docs/modules/frontend.md`：更新 SettingsConfig 和 YpiStudioSubagentTranscript 描述。
   - `docs/modules/api.md`：更新 `web-config` 配置范围。

## 验证命令

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

建议手工验证：

1. Settings → Studio 中设置 architect 为指定模型 + high thinking，保存后刷新仍保留。
2. 创建/继续 YPI Studio 任务，派发 architect，不在工具入参传 model/thinking。
3. 主 Chat 的 `ypi_studio_subagent` 折叠头和展开 Meta 显示指定模型与 high。
4. `.ypi/tasks/<task>/task.json` 的 subagents 最新 run 记录包含实际 model/thinking。
5. child transcript 不出现 Trellis SessionStart / workflow-state / `task.py current` 约束。
6. 显式工具入参传入另一 model/thinking 时覆盖 Settings。
7. 未配置 Studio 时行为兼容：可运行，显示 followMain 或 Pi default，不报错。

## 检查门禁

- 不修改成员 Markdown 职责文本，除非只补充 UI 提示或可选说明。
- 不把本机模型 ID 写入 `.ypi/agents/*.md`。
- 不影响 Trellis 普通工具和 Trellis 设置页。
- 不影响非 Studio 工具调用展示。

## 回滚方案

- 若配置/UI 有问题，可移除 `studio` section 的 Settings UI，保留后端默认 followMain/inherit，不影响旧任务读取。
- 若 Trellis 隔离误伤，只回滚 child env 的 `TRELLIS_SUBAGENT_CHILD`；YPI 子进程仍可运行，但会恢复 Trellis 注入风险。
