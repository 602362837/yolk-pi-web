# prd

## 目标与背景

优化 `ypi_studio_subagent` 在主 Chat 中的展示语义：用户能明确区分“子代理真实运行异常”和“为了 UI/存储安全而截断展示”；同时让工具标题直接体现子代理实时状态与 token 流速，默认只显示最近几条进展，避免信息膨胀和细节暴露。

## 范围内

- 主 Chat 中 `ypi_studio_subagent` 工具块的标题、折叠态、展开态默认展示。
- 子代理 progress/transcript 截断语义与 severity 的前后端契约。
- live progress 的固定窗口策略（最近 N 条，替换旧内容）。
- `xx t/s` 在工具标题附近的直接显示。
- session widget 可复用同一语义，避免把截断当作异常。
- 文档同步：frontend/library/api/architecture 中涉及展示契约的描述。

## 范围外

- 不重做通用 `subagent` / `trellis_subagent` 面板。
- 不改变 YPI Studio 子进程模型/思考策略。
- 不改任务状态机、审批门禁、成员定义。
- 不在本任务中设计 `.ypi/.runtime` 自动 GC。
- 不默认展示完整 child raw transcript。

## 需求与验收标准

1. 截断不误报异常
   - 成功完成的子代理如果只发生 preview/item/API projection 截断，工具块仍显示 `succeeded`/绿色或中性状态。
   - UI 用中性说明展示“仅显示被裁剪/最近内容，不影响子代理运行”。
   - 只有 `failed`、`cancelled`、`waiting_for_user` 或 hard termination reason 才使用异常/阻塞样式。

2. 明确真实运行异常
   - stdout/stderr/单行/idle/max-runtime/abort/非零退出等仍按现有机制进入 failed/cancelled/waiting 状态。
   - 失败时保留可读原因和恢复建议。

3. 标题直接显示 token 流速
   - `ypi_studio_subagent` 工具标题附近显示 `xx.x t/s`（有值时无需展开即可看到）。
   - 可同时显示 token 总量、phase/current-tool 概要、elapsed，但不得挤掉主状态。

4. 只展示最近进展
   - 默认 live UI 至多显示最近 N 条进展（建议 N=5），新进展到来时替换旧进展。
   - 前端不得在组件 state 中无限追加 live transcript item。
   - 默认展开态不拉取完整 transcript；完整/更多内容只在 Debug/Raw 显式入口中按 API limit 获取。

5. 隐藏具体执行细节
   - 默认不展示 delegated prompt、tool input/output、raw JSON。
   - 默认只展示 member、状态、phase、当前高层动作、最近文本摘要。
   - Debug/Raw 入口仍可用于排障。

6. 兼容历史数据
   - 旧 run 没有新 truncation 字段时按当前 `status` 和 `transcript.truncated` 兼容显示。
   - 旧 `transcript.truncated=true` 不再直接等价于异常。

## 未决问题

- 最近进展条数是否固定为 5。
- Debug/Raw 是否需要隐藏到开发模式配置下。
- 是否在后续任务改变最终输出 256KiB 裁剪后返回给主会话的契约。
