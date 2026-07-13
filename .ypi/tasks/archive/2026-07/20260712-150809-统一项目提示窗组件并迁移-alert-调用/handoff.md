# Handoff

## 当前状态

任务处于 `changes_requested`。首轮 5 个实现子任务被错误记为 done，但没有任何生产代码改动或可采信输出；全部需要重新排队。

## 已更新产物

- [implement.md](./implement.md)：保留首轮计划为历史记录，新增 5 个 `-retry-1` 子任务及输出捕获门禁。
- [review.md](./review.md)：记录空运行证据和返工结论。
- 本文件：提供主会话恢复步骤。

## 主会话恢复步骤

1. 确认已审批范围记录，尤其是 toast 是否纳入；若排除，在新计划中明确将 R2 标记 skipped。
2. 将 [implement.md](./implement.md) 最后一个 `json ypi-implementation-plan` 块保存为新的 implementation plan。
3. 核对 Studio 显示新 ID、0/5 done、`S1-prompt-foundation-retry-1` ready；旧 S1-S5 只保留作审计，不再 claim。
4. 单独派发 R1。若 transcript 无源码读取/编辑/验证工具调用、工作区无预期生产差异或没有最终摘要，立即标失败并停止。
5. R1 证据通过后并行派发 R2-R4；处理 `ModelsConfig.tsx` 共享文件时要求实现员基于当前工作区合并，不能覆盖彼此改动。
6. R2-R4 通过后派发 R5，再派发 checker。checker 必须运行检查并写 `review.md`。

## 未决风险

- SDK runner 可能再次快速空结束；主会话需把“有 final message”与“有工具调用/工作区证据”同时作为成功条件。
- R2 与 R4 都修改 `ModelsConfig.tsx`，并行执行存在冲突风险；可将 R2 改为依赖 R4 或由主会话串行派发。
- 项目缺少通用前端组件测试框架，焦点、读屏、嵌套 modal 和移动端仍需浏览器人工验收。
