# Design — 成员模型 / thinking 策略与 Trellis 隔离

## 现状数据流

- `lib/rpc-manager.ts` 在 Web 创建的每个 AgentSession 中注入 `createYpiStudioExtension(cwd)`；因此 `ypi_studio_task`、`ypi_studio_subagent` 和 `/studio-*` 命令总是可用。
- `components/ToolPanel.tsx` 的 `subagent` preset 激活 `ypi_studio_subagent`；`default/full` 只激活 `ypi_studio_task`。
- `lib/ypi-studio-extension.ts`：
  - `ypi_studio_subagent` 工具 schema 已有 `member`、`prompt`、`taskId`、`model`、`thinking`。
  - `normalizeSubagentInput()` 只读取入参；没有读取 `pi-web.json` 或成员配置。
  - `buildPiArgs()` 仅在入参提供 `model` / `thinking` 时传给 child `pi --mode json -p --no-session`；未提供时 child 使用 Pi CLI 默认，不会稳定表达“继承主会话”。
  - subagent run 的 `model` / `thinking` 只保存入参值；实时 progress `details.run` 当前不带 `model` / `thinking`。
  - child env 只有 `YPI_STUDIO_SUBAGENT_CHILD=1`，会让 YPI Studio 扩展早退，但不会让项目本地 Trellis 扩展早退。
- `lib/ypi-studio-tasks.ts` / `lib/ypi-studio-types.ts` 已在 `YpiStudioTaskSubagentRun` 中支持 `model?: string`、`thinking?: string`，可直接承载展示值。
- `components/YpiStudioSubagentTranscript.tsx`：
  - 从 tool input、progress details、final result details 合并 `run.model` / `run.thinking`。
  - 展开面板已有 Model / Thinking 元信息，但折叠头未突出显示；运行中如果 progress 不带元数据，只能看到入参或 default。
- `hooks/useAgentSession.ts` 保存通用 `toolProgressById`，Studio transcript 组件可直接消费 `tool_execution_update` 的 `partialResult.details.run`。
- Settings 现有 Trellis/Terminal 子配置已定义并复用了 `PiWebSubagentModelRef`、`PiWebSubagentRunPolicy`、`ModelPolicySelect`、`ThinkingSelect`，适合抽象复用。

## 推荐数据模型

在 `lib/pi-web-config.ts` 增加 YPI Studio 配置，复用现有模型策略类型：

```ts
export type PiWebStudioMemberId = "architect" | "ui-designer" | "implementer" | "checker" | string;

export interface PiWebStudioConfig {
  defaultPolicy: PiWebSubagentRunPolicy;
  members: Record<PiWebStudioMemberId, PiWebSubagentRunPolicy>;
}
```

推荐默认值：

```json
{
  "studio": {
    "defaultPolicy": {
      "model": { "mode": "followMain" },
      "thinking": "inherit"
    },
    "members": {
      "architect": { "model": { "mode": "followMain" }, "thinking": "inherit" },
      "ui-designer": { "model": { "mode": "followMain" }, "thinking": "inherit" },
      "implementer": { "model": { "mode": "followMain" }, "thinking": "inherit" },
      "checker": { "model": { "mode": "followMain" }, "thinking": "inherit" }
    }
  }
}
```

理由：

- `pi-web.json` 是本机用户配置，适合保存本机模型 ID；`.ypi/agents/*.md` 保持项目可移植的角色定义。
- 与 Trellis subagent / Terminal env assistant 使用同一策略结构，减少校验、UI 和展示重复。
- 默认 followMain/inherit 保持历史兼容；“可独立配置”由 Settings 提供，不强制改变旧用户行为。

可选扩展（非 MVP）：支持 `.ypi/agents/*.md` frontmatter `modelPolicy` 作为项目建议值，但优先级低于 `pi-web.json`，避免破坏本机配置。

## 策略解析契约

新增内部解析结果类型，供启动、记录、展示统一使用：

```ts
interface ResolvedStudioRunPolicy {
  modelArg?: string;          // 传给 CLI 的 --model；例如 "anthropic/claude-sonnet-4"
  modelLabel: string;         // UI / task.json 展示；例如 "anthropic/claude-sonnet-4" 或 "Pi default"
  modelSource: "toolInput" | "memberConfig" | "defaultPolicy" | "followMain" | "piDefault" | "unset";
  thinkingArg?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  thinkingLabel: string;      // UI 展示；例如 "high" / "Pi default" / "inherit"
  thinkingSource: "toolInput" | "memberConfig" | "defaultPolicy" | "followMain" | "piDefault" | "unset";
}
```

优先级：

1. `ypi_studio_subagent` 工具入参 `model` / `thinking`。
2. `pi-web.json` `studio.members[member]`。
3. `pi-web.json` `studio.defaultPolicy`。
4. `followMain`：从 `ctx.model` 得到 `provider/id`；thinking 从 `pi.getThinkingLevel?.()` 或已有主会话状态读取。
5. `piDefault` / `unset`：不传 CLI 参数，展示为 `Pi default` 或 `default`。

启动参数建议改为分离参数：

```ts
const args = ["--mode", "json", "-p", "--no-session"];
if (resolved.modelArg) args.push("--model", resolved.modelArg);
if (resolved.thinkingArg) args.push("--thinking", resolved.thinkingArg);
```

避免当前 `model:thinking` 拼接对 Bedrock ARN、带冒号模型 ID 或用户显式 shorthand 产生歧义。

## 后端影响模块

- `lib/pi-web-config.ts`
  - 增加 `PiWebStudioConfig`、默认值、normalize、validate、patch 支持。
  - `PiWebConfigPatch`、`writePiWebConfigPatch()` 支持 `studio` section。
- `app/api/web-config/route.ts`
  - PUT body 类型增加 `studio?: unknown`。
- `lib/ypi-studio-extension.ts`
  - 读取 `readPiWebConfig()`。
  - 新增 `resolveStudioMemberPolicy(member, input, ctx, getThinkingLevel)`。
  - `buildPiArgs()` 接收 resolved policy，而不是原始 input。
  - `runningRun`、progress payload、final `run` 都写入 `model: resolved.modelLabel`、`thinking: resolved.thinkingLabel`，并可加 `modelSource` / `thinkingSource`。
  - transcript assistant item 的 `model` 使用 resolved model label。
  - child `spawn` env 增加 `TRELLIS_SUBAGENT_CHILD: "1"`，并可保留 `YPI_STUDIO_SUBAGENT_CHILD: "1"`。
  - `buildMemberPrompt()` 增加“忽略 Trellis workflow/task 指令”的成员运行规则。
- `lib/ypi-studio-types.ts`
  - 可选扩展 `YpiStudioTaskSubagentRun`：`modelSource?: string`、`thinkingSource?: string`。
  - 若保持最小改动，可以不扩展类型，只用现有 `model` / `thinking` 展示；推荐扩展以便排查来源。
- `lib/ypi-studio-tasks.ts`
  - `normalizeTaskRecord()` 读取新可选字段，保持旧 task.json 兼容。

## 前端影响模块

- `components/SettingsConfig.tsx`
  - `SettingsSection` 增加 `studio`。
  - 新增 Studio 设置页：默认策略 + 四个默认成员卡片/表格。
  - 复用 `ModelPolicySelect` 和 `ThinkingSelect`；成员列表固定为 `architect/ui-designer/implementer/checker`，后续可扩展自定义成员。
  - save dirty 比较包含 `studioConfigsEqual()`。
- `components/YpiStudioSubagentTranscript.tsx`
  - `StudioRunProjection` 可加 `modelSource` / `thinkingSource`。
  - 折叠头显示 `model · thinking` chip，例如 `architect · Running · model: anthropic/claude... · thinking: high`。
  - 展开 Meta 保持 Model / Thinking，并新增 Source 或 title tooltip。
- `components/YpiStudioPanel.tsx`
  - 非必需；可在成员卡片上提示“运行模型在 Settings → Studio 配置”，避免用户误以为成员 Markdown 内配置。
- `docs/modules/frontend.md`、`docs/modules/library.md`、`docs/modules/api.md`
  - 更新 Settings、YPI Studio extension、web-config 的职责说明。

## Trellis 禁用 / 隔离方案

推荐分层：

1. **成员子进程硬隔离（MVP 必做）**
   - 在 `runChildPi()` spawn env 增加 `TRELLIS_SUBAGENT_CHILD=1`。
   - 当前 `.pi/extensions/trellis/index.ts` 已在入口处 `if (process.env.TRELLIS_SUBAGENT_CHILD === "1") return;`，因此可直接让 Trellis 扩展不注册、不注入 workflow-state。

2. **Prompt 软约束（MVP 必做）**
   - `buildMemberPrompt()` 顶部加入：当前是 YPI Studio member mode，不创建/切换/继续 Trellis task，不服从 Trellis workflow-state；如发现 Trellis 提示残留，只作为无效上下文忽略。

3. **主会话隔离（后续可选）**
   - `pi-web.json` 现有 `trellis.enabled` 只控制 Web 面板/设置，不控制项目本地 Pi 扩展。
   - 若要让“YPI Studio 主流程”也完全不受 Trellis 注入影响，需要 Trellis 扩展本身支持 `YPI_STUDIO_DISABLE_TRELLIS=1` 或 Web session 按配置过滤项目扩展；这超出本次 MVP，风险较高。

## 兼容性与迁移

- 旧 `pi-web.json` 没有 `studio` 时 normalize 返回默认配置；不需要迁移脚本。
- 旧 `.ypi/tasks/*/task.json` 的 subagent run 没有 `modelSource` / `thinkingSource` 时继续可读。
- 旧工具调用入参有 `model` / `thinking` 时仍优先使用。
- 旧 UI 中 Model/Thinking 显示 default 的历史记录不会自动补全，只对新运行完整展示。

## 风险与缓解

- **模型 ID 格式风险**：使用 `provider/modelId`，符合 Pi CLI 文档；避免 `model:thinking` 拼接。
- **thinking inherit 实际值不可得**：需要在 YPI extension factory 的 `pi` 类型中加入可选 `getThinkingLevel?: () => string`；若不可得，展示 `inherit` 并不传 `--thinking`。
- **指定模型不可用**：child Pi 会失败；错误应保留在 transcript 和 task subagent run 中。后续可增加 fallback policy。
- **Trellis 主会话仍注入**：MVP 只保证 child member 隔离；如用户要求主会话也完全关闭 Trellis，需要单独设计项目扩展开关。
