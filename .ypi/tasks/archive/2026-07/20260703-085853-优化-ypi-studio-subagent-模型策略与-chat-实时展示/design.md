# Design

## 方案摘要

将 Studio member 运行策略拆为一个可测试的纯解析层，并把解析结果作为一等诊断数据贯穿 child Pi 启动、`tool_execution_update`、final tool result、Chat transcript header 与 Studio widget。Chat transcript 改成“摘要优先 + compact transcript + debug/raw 二级展开”，避免默认展开时一次性展示大量 child 事件。`runChildPi` 增加 child JSON event 状态机与 token/tps 估算，前端按 phase 展示运行状态。

## 当前链路梳理

### Settings / config

- `components/SettingsConfig.tsx`
  - Studio section 读取 `/api/web-config`，展示 `studio.defaultPolicy` 与默认成员 `architect/ui-designer/implementer/checker` 的 model/thinking。
  - `ModelPolicySelect` 支持 `followMain | piDefault | unset | specific:provider/modelId`。
  - `ThinkingSelect` 支持 `inherit | off | minimal | low | medium | high | xhigh`。
  - 保存时 PUT `/api/web-config`。
- `lib/pi-web-config.ts`
  - 默认：`studio.defaultPolicy = followMain/inherit`，默认成员同样 followMain/inherit。
  - `readStudioConfig()` 容错读取并合并默认成员 / custom member。
  - `validatePiWebStudioConfig()` 严格校验保存入参，支持 custom members。

### Extension / child Pi

- `lib/ypi-studio-extension.ts`
  - `normalizeSubagentInput()` 读取 tool input 的 `member/prompt/taskId/model/thinking`。
  - `resolveStudioMemberPolicy()` 读取 `readPiWebConfig().studio`，当前逻辑是：
    - `input.model` 直接覆盖。
    - member model 非 `unset` 用 member，否则用 defaultPolicy。
    - defaultPolicy 若仍 `unset`，当前会隐式转 followMain。
    - `followMain` 解析不到 `ctx.model` 时无 `--model`，label 为 Pi default。
    - `input.thinking` 合法时覆盖；非法时 silent ignore。
    - `inherit` 通过 `pi.getThinkingLevel()` 读取，读不到时无 `--thinking`。
  - `buildPiArgs()` 用 resolved `modelArg/thinkingArg` 添加 child CLI `--model/--thinking`。
  - progress/final details 当前只有 `model/thinking/modelSource/thinkingSource`，fallback 原因不可见。

## 推荐改动文件清单

### 必改

- `lib/ypi-studio-extension.ts`
  - canonicalize member id。
  - 将策略解析替换为新 pure resolver。
  - `runChildPi` 增加 phase/tokens/tps/currentTool 状态机。
  - progress/final details 带 diagnostics/warnings。
  - tool prompt guideline 补充：不要主动传 `model/thinking`，除非用户明确要求覆盖 Settings。
- `lib/ypi-studio-types.ts`
  - 增加 policy diagnostics、run progress phase/stats 类型。
  - 扩展 `YpiStudioTaskSubagentRun` 和 `YpiStudioLiveRunOverlay`。
- `components/YpiStudioSubagentTranscript.tsx`
  - 新 summary/compact/debug/raw 渲染。
  - 展示 phase、tokens、tps、currentTool、policy warnings。
- `hooks/useAgentSession.ts`
  - 扩展 `ToolExecutionProgress` 的 details 解析类型；保留 unknown 边界。
- `components/ChatWindow.tsx`
  - 从 Studio progress details 提取 phase/tokens/tps/currentTool/itemsPreview 到 live overlay。
- `components/YpiStudioSessionWidget.tsx`
  - live run 展示 phase/tokens/tps/currentTool。
- `components/SettingsConfig.tsx`
  - Studio section 文案更新为精确 fallback 规则。

### 建议新增

- `lib/ypi-studio-policy.ts`
  - 纯函数：canonicalize member、解析 model/thinking、生成 diagnostics/warnings。
- `lib/ypi-studio-live-progress.ts`（可选）
  - 前端共享 normalizer：从 tool details 中提取 Studio run/progress，供 transcript、ChatWindow、widget 复用。

### 文档同步

- `docs/modules/library.md`：补充 policy resolver / progress contract。
- `docs/modules/frontend.md`：补充 transcript compact/debug 行为。
- `docs/architecture/overview.md`：更新 YPI Studio child progress payload 与 fallback 可观测性。

## 数据结构 / 类型变更

### Policy diagnostics

建议新增：

```ts
type YpiStudioPolicySource = "toolInput" | "memberConfig" | "defaultPolicy" | "followMain" | "piDefault" | "unset";

type YpiStudioPolicyWarningCode =
  | "config_parse_error"
  | "member_id_normalized"
  | "tool_model_invalid"
  | "tool_thinking_invalid"
  | "member_policy_unset"
  | "default_policy_unset"
  | "follow_main_model_unavailable"
  | "follow_main_thinking_unavailable";

interface YpiStudioPolicyResolution {
  label: string;
  arg?: string;
  effectiveSource: YpiStudioPolicySource;
  configuredSource?: "toolInput" | "memberConfig" | "defaultPolicy";
  configuredMode?: string;
  requested?: string;
  fallbackChain: YpiStudioPolicySource[];
  warnings?: { code: YpiStudioPolicyWarningCode; message: string }[];
}

interface YpiStudioSubagentPolicyDiagnostics {
  schemaVersion: 1;
  memberInput: string;
  member: string;
  memberPolicyFound: boolean;
  config: { exists: boolean; parseError?: string; pathLabel: "~/.pi/agent/pi-web.json" };
  model: YpiStudioPolicyResolution;
  thinking: YpiStudioPolicyResolution;
  warnings?: { code: YpiStudioPolicyWarningCode; message: string }[];
}
```

兼容字段保留：`model`、`thinking`、`modelSource`、`thinkingSource` 仍在 run 上，来源使用 `effectiveSource`。

### Progress stats

建议新增：

```ts
type YpiStudioSubagentRunPhase =
  | "starting"
  | "waiting_model"
  | "streaming"
  | "running_tool"
  | "waiting_for_user"
  | "finished";

interface YpiStudioSubagentRunProgress {
  schemaVersion: 1;
  phase: YpiStudioSubagentRunPhase;
  startedAt: string;
  updatedAt: string;
  eventCount: number;
  lastTextPreview: string;
  itemsPreview: YpiStudioSubagentTranscriptItem[];
  warnings?: string[];
  outputChars?: number;
  tokens?: number;
  tokenSource?: "estimated_chars" | "usage";
  tps?: number;
  firstTokenAt?: string;
  lastTokenAt?: string;
  currentTool?: { toolCallId: string; toolName: string; startedAt?: string };
}
```

扩展：

- `YpiStudioTaskSubagentRun.policy?: YpiStudioSubagentPolicyDiagnostics`
- `YpiStudioLiveRunOverlay.phase/tokens/tps/currentTool/policyWarnings/itemsPreview`

## 策略优先级与 fallback 规则

### Model

1. `toolInput.model`
   - 合法格式建议为 `provider/modelId`；合法则直接作为 `--model`。
   - 不合法时 warning，然后进入 member/default fallback。
   - UI 必须显示 `toolInput overrides Settings`。
2. `memberConfig`
   - lookup 使用 canonical member id（trim + lowercase for file-style ids）。
   - `specific`：使用 `provider/modelId`。
   - `followMain`：尝试 `ctx.model.provider/id`，成功则 `--model provider/id`；失败 warning 并进入 `piDefault`。
   - `piDefault`：不传 `--model`。
   - `unset`：不是最终策略，进入 defaultPolicy，并在 diagnostics 记录 fallback。
3. `defaultPolicy`
   - 同上。
   - 若 defaultPolicy 也是 `unset`：进入内置 fallback `followMain -> piDefault`，必须记录 `default_policy_unset`。
4. `followMain`
   - 只有能读取当前主会话 model 时才传 `--model`。
5. `piDefault`
   - 最终兜底，不传 `--model`。

### Thinking

1. `toolInput.thinking`
   - 仅接受 `off/minimal/low/medium/high/xhigh`；非法 warning 后回退。
2. `memberConfig.thinking`
   - 成员存在时使用成员 thinking。
3. `defaultPolicy.thinking`
   - 成员不存在时使用默认 thinking。
4. `inherit/followMain`
   - 通过 `pi.getThinkingLevel()` 获取；如果返回 `auto/undefined/invalid`，warning 后进入 Pi default。
5. `piDefault`
   - 不传 `--thinking`。

## 后端事件流

```text
SettingsConfig
  PUT /api/web-config { studio }
    -> lib/pi-web-config validate/write ~/.pi/agent/pi-web.json

main Pi ypi_studio_subagent(input)
  -> canonicalize member
  -> resolveStudioMemberPolicyWithDiagnostics(config + ctx.model + pi.getThinkingLevel)
  -> record running run { model/thinking/source/policy }
  -> onUpdate details.run.progress phase=starting
  -> spawn child pi --mode json -p --no-session [--model] [--thinking]

child stdout JSON events
  agent_start          -> phase=waiting_model
  message_update       -> phase=streaming, update chars/tokens/tps
  message_end          -> capture final assistant text, tokens from usage if present
  tool_execution_start -> phase=running_tool, currentTool
  tool_execution_update-> phase=running_tool, preview only
  tool_execution_end   -> phase=waiting_model, clear currentTool
  extension_ui_request -> phase=waiting_for_user, status=waiting_for_user, kill child
  close/error/abort    -> phase=finished, finalize status/transcript

onUpdate throttled
  -> parent Pi emits tool_execution_update SSE
  -> useAgentSession.toolProgressById[toolCallId]
  -> MessageView/YpiStudioSubagentTranscript + ChatWindow live overlay

final tool_execution_end
  -> result.details { task, run, warnings }
  -> persisted task.subagents includes policy diagnostics and final model/thinking metadata
```

## UI 行为规范

### Header / collapsed

- 永远默认折叠。
- 显示：`ypi_studio_subagent`、member、status、phase、elapsed、tokens/tps、model chip、thinking chip、last preview。
- phase 文案：
  - `starting`：Starting child
  - `waiting_model`：Waiting model
  - `streaming`：Streaming
  - `running_tool`：Running tool: `<toolName>`
  - `waiting_for_user`：Waiting for user
  - `finished`：Finished
- 有 policy/progress warning 时显示黄色 warning icon，title 中列出前 3 条。

### Expanded summary（默认展开内容）

- 顶部 meta grid：Member、Status、Phase、Task、Run、Model、Thinking、Elapsed、Tokens、t/s。
- Warnings/error/waiting_for_user prompt 默认可见。
- Delegated prompt 默认只显示一行 preview + Show prompt。
- Transcript 默认 compact：
  - `assistant`：展示最后 1-3 条摘要；最终输出与 final result 重复时去重。
  - `tool_call`：一行 compact，工具名 + 输入 preview。
  - `tool_result`：成功结果默认折叠成一行；失败结果默认展开 compact 错误。
  - `error`：默认可见。
  - `prompt/status/stderr`：默认隐藏，除非 stderr 出现在 failed run 中，此时显示 warning 摘要。
- Final output：默认显示 Markdown 摘要（例如 max 6 行 / 600 chars），按钮展开完整输出。

### Debug / raw 二级开关

- `Show debug`：显示 prompt、status、stderr、所有 transcript item，文本可完整展开。
- `Show raw`：仅在 debug 中出现；显示 `block.input`、`progress.partialResult.details`、`result.details`、每个 item JSON。
- 拉取 transcript API：展开 summary 不必立即 fetch；点击 compact transcript / debug 时再 fetch 完整 bounded transcript，运行中继续使用 progress preview。

## 兼容性、风险、回滚

- 兼容：保留现有 run 字段；新增字段均 optional。
- 旧 transcript / 旧 task 没有 `policy/progress.phase` 时，前端按现有 status 和 summary fallback。
- 最大风险是 policy resolver 改变 default `unset` 语义；通过保留 `unset -> followMain -> piDefault` 避免破坏现有 UI 文案。
- 若 t/s 估算异常，只影响展示，不影响 child 执行；可回滚前端展示并保留后端字段。
- 若 diagnostics 过多造成 Chat 仍繁杂，默认只显示 warning count，详细内容进入 debug。
