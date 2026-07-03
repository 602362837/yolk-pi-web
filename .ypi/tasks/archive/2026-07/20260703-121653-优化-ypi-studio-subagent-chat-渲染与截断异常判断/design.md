# design

## 方案摘要

采用“运行状态与展示截断分离 + 最近进展窗口 + 标题直显 t/s”的方案。保留现有 child Pi 流式解析、sidecar transcript 与 `tool_execution_update` 数据流，不改变子代理执行方式；主要修正 truncation severity、progress payload 语义和默认 UI 呈现。

## 当前截断分类与影响判断

| 截断/限制来源 | 当前位置 | 是否代表子代理异常 | 是否影响子代理运行 | 是否影响主会话可见结果 | 建议呈现 |
| --- | --- | --- | --- | --- | --- |
| live preview 裁剪（4KiB） | `safeRecentItems()` / `boundedText()` | 否 | 否 | 否，只影响 UI 预览 | 中性 `recent preview` |
| transcript item 裁剪（16KiB） | `lib/ypi-studio-transcripts.ts` `normalizeItem()` | 否 | 否 | 否，只影响 sidecar 单条内容 | 中性 `item clipped` |
| transcript 总量 5MiB | `appendYpiStudioSubagentTranscriptItem()` | 不一定 | 否，当前只停止/截断 capture | 可能影响完整回放 | warning/info：capture limited，但 run status 不变 |
| transcript API projection 256KiB/limit | `readYpiStudioSubagentTranscript()` | 否 | 否 | 否，只影响一次 API 响应 | 中性 `response limited`，可分页/Debug |
| final assistant output 256KiB | `rememberAssistantOutput()` | 否 | 否 | 是，父工具 final output 被裁剪 | info/warning：结果已裁剪，建议摘要/查看 transcript |
| stdout/stderr/单行/idle/runtime/abort | `terminateChild()` | 是 | 是，会终止/取消 | 是 | failed/cancelled/waiting 样式 |
| 子进程非零退出 | `finish()` | 是 | 已结束失败 | 是 | failed 样式 |

结论：用户看到的“截断”大多只是 UI/存储保护，不代表子代理运行异常；只有硬限制终止或运行状态失败才是真异常。

## 数据流 / 契约设计

现有数据流保持：

```text
child Pi JSON stdout
  -> runChildPi.parseLine()
  -> progressSnapshot()/progressPayload()
  -> Pi tool onUpdate
  -> SSE tool_execution_update
  -> hooks/useAgentSession.toolProgressById[toolCallId] 替换 partialResult
  -> MessageView/YpiStudioSubagentTranscript 渲染
```

建议扩展 `YpiStudioSubagentRunProgress`（兼容可选字段）：

```ts
interface YpiStudioSubagentRunProgress {
  // existing fields
  phase: YpiStudioSubagentRunPhase;
  tokens?: number;
  tps?: number;
  currentTool?: YpiStudioSubagentCurrentTool;
  itemsPreview: YpiStudioSubagentTranscriptItem[]; // fixed recent window

  display?: {
    recentLimit: number;              // e.g. 5
    previewTruncated?: boolean;       // live preview/text clipped
    finalOutputTruncated?: boolean;   // parent result clipped
    transcriptItemTruncated?: boolean;
    transcriptCaptureLimited?: boolean;
    apiProjectionLimited?: boolean;
  };
  terminationReason?: string;         // only set when it caused failed/cancelled/waiting
}
```

建议扩展 `YpiStudioSubagentTranscriptRef`（兼容保留 `truncated`）：

```ts
interface YpiStudioSubagentTranscriptRef {
  truncated: boolean; // legacy: any truncation; UI must not treat as failure
  truncation?: {
    itemTruncated?: boolean;
    captureLimited?: boolean;
    bytesLimit?: number;
  };
}
```

实现可分两档：

- 最小可行：不改变持久格式，仅在 UI 中按 `run.status` 判定异常，把 `transcript.truncated` 降级为 info，并把 live preview 限制改为 5。
- 推荐完整：增加可选 `display/truncation/terminationReason` 字段，让 UI 精准区分 item clip、capture limit、final output clip、hard failure。

## 影响模块和边界

- `lib/ypi-studio-extension.ts`
  - 调整 `safeRecentItems()` 默认窗口为 5。
  - 在 progress 中输出 display/truncation/terminationReason（可选）。
  - 不因普通 preview/item/final-output 裁剪把 run 标为 failed。
  - hard limit 仍通过 `terminateChild()` 失败。

- `lib/ypi-studio-transcripts.ts`
  - 区分单条 item clipped 与总 capture limited。
  - 兼容旧 `transcript.truncated`。
  - API projection warning 文案改为“response limited”，避免像运行异常。

- `lib/ypi-studio-types.ts`
  - 增加可选 wire fields。

- `components/YpiStudioSubagentTranscript.tsx`
  - 标题直接渲染 `t/s` badge。
  - 默认展开显示 status + recent activity，不展示 prompt/raw/tool details。
  - truncation info 与 failure warning 分离。
  - `compactItems()` 固定最近 5，Debug 才放宽。

- `components/ChatWindow.tsx`
  - live overlay signature 已包含 tokens/tps/currentTool；如新增 display 字段，签名需纳入影响以触发 widget 更新。

- `components/YpiStudioSessionWidget.tsx` / `lib/ypi-studio-session-link.ts`
  - 继续最多展示少量最近 run/preview；避免 warnings 中把 API projection limited 当异常。

- `docs/modules/frontend.md` / `docs/modules/library.md` / `docs/architecture/overview.md`
  - 更新 YPI Studio subagent 展示语义和截断分类。

## 兼容性

- 历史 task/run 没有新增字段：UI 只用 status 判定严重性，`transcript.truncated=true` 显示为 info。
- 历史无 transcript：保持 final output fallback。
- API 路由无需破坏性变更；新增字段均可选。

## 风险与缓解

- 风险：过度隐藏细节导致排障困难。缓解：保留 Debug/Raw 二级入口。
- 风险：tps 估算来源不稳定。缓解：保留 `tokenSource` tooltip，usage 优先、estimated_chars 标注为估算。
- 风险：final output 裁剪确实影响父会话后续质量。缓解：UI 明确说明“结果被裁剪”并建议要求子代理摘要；后续可单独设计“返回摘要+transcript ref”。
- 风险：新增字段与旧 run 混用。缓解：所有字段 optional，normalize 函数保守读取。

## 回滚方案

- 前端可回滚到当前 transcript 组件；后端新增 optional 字段不会影响旧 UI。
- 若新 truncation 字段导致兼容问题，保留 `transcript.truncated` legacy 行为即可。
- 若 UI 默认隐藏过多，可仅恢复 Debug 默认展开，不改执行路径。
