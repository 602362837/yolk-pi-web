# brief

## 任务背景

用户反馈：主 Chat 中 `ypi_studio_subagent` 工具块已有子代理 transcript/预览截断保护，但最近一次执行时，UI 把“截断”呈现得像异常，用户难以判断是否代表子代理真实运行失败。同时用户希望：

- 子代理给用户看的信息只保留最近几次工作/进展，新进展替换旧进展，避免内存/DOM 无限膨胀。
- 主会话工具标题附近直接显示子代理 token 流速（`xx t/s`）。
- 默认不向用户暴露子代理具体执行细节；工具标题/状态应能体现“在做什么”。

## 已阅读材料

- `AGENTS.md`
- `docs/architecture/overview.md`
- `docs/modules/frontend.md`
- `docs/modules/api.md`
- `docs/modules/library.md`
- 相关源码：
  - `components/YpiStudioSubagentTranscript.tsx`
  - `components/MessageView.tsx`
  - `components/ChatWindow.tsx`
  - `components/YpiStudioSessionWidget.tsx`
  - `hooks/useAgentSession.ts`
  - `lib/ypi-studio-extension.ts`
  - `lib/ypi-studio-transcripts.ts`
  - `lib/ypi-studio-types.ts`
  - `lib/ypi-studio-session-link.ts`
  - `app/api/studio/tasks/[taskKey]/subagents/[runId]/transcript/route.ts`

## 关键现状

1. `ypi_studio_subagent` 子进程运行由 `lib/ypi-studio-extension.ts` 管理，stdout JSONL 被流式解析，进度通过 `onUpdate` 进入 `tool_execution_update`。
2. `hooks/useAgentSession.ts` 对每个 `toolCallId` 的 `partialResult` 是替换式保存；当前 live preview 本身不会在 hook 中无限追加。
3. 后端已对 live preview 做窗口限制：`recentItems` 最多 24，`itemsPreview` 取最近 12；session widget 持久预览取最近 5。
4. 当前误判主要来自“截断语义被混用”：
   - 单条 transcript item 超过 16KiB 会被裁剪，并把 `transcript.truncated = true`。
   - UI 看到 `transcript.truncated` 就显示黄色 `Transcript capture was truncated by safety limits`。
   - 这并不等价于子代理失败，也通常不影响子进程继续执行。
5. 真正会影响子代理运行的是硬限制/终止路径：stdout/stderr/单行超限、idle/max-runtime、abort、非零退出等；这些会把 run status 置为 `failed`/`cancelled`/`waiting_for_user`。
6. `rememberAssistantOutput()` 的最终输出上限会裁剪返回给主会话的 final output；它不影响子代理执行完成状态，但可能影响主会话后续可见的结果完整性，需要以“结果被裁剪/请查看 transcript 或要求摘要”呈现，而不是“子代理异常”。

## 推荐方向

- 将“运行状态”和“展示/存储截断”彻底分离：红色/异常只由 `run.status` 或 hard termination reason 决定；展示截断使用中性 info badge/note。
- 默认 UI 从“transcript/debug 详情”改为“状态标题 + 最近进展窗口”：标题直接显示 member、status、phase/current-tool 概要、elapsed、`xx t/s`；展开后默认只显示最近 3–5 条可读进展。
- Prompt、tool args/tool results、raw JSON、完整 transcript API 仅放在 Debug/Raw 二级入口。
- 保留 sidecar transcript 作为调试/审计数据源，但默认不将大量内容读入 DOM；live 进展只使用固定大小窗口。

## 需主会话确认的问题

1. 最近进展默认条数：建议 5 条；是否需要配置化？
2. Debug/Raw transcript 是否继续提供给普通用户，还是仅开发模式/显式展开？建议保留但默认隐藏。
3. 最终输出超过 256KiB 时，是否保持裁剪后返回给主会话，还是改为返回摘要 + transcript 引用？建议本任务只改呈现语义，不改执行契约。
