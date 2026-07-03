# brief

## 背景

YPI Studio 的 `ypi_studio_subagent` 通过 `lib/ypi-studio-extension.ts` 启动子 Pi 进程，并把 stdout/stderr 解析为进度、transcript 与最终 tool result。当前实现会保存完整 stdout/stderr Buffer，并在结束时 `Buffer.concat(...).toString()`；同时部分 live progress 字段仍可能携带未截断大字符串。用户遇到子代理像“跑死”、主 session stop 无效，以及 `Cannot create a string longer than 0x1fffffe8 characters ... ChildProcess`，高度疑似子进程输出/事件流无限累积触发 V8 字符串上限与事件循环/内存压力。

## 目标

- 子代理输出再大也不能把 Next.js 进程打崩。
- 主 session stop/abort 必须能级联终止当前 Studio 子代理子进程。
- 子代理无进展或卡死时能自动失败/取消并留下可恢复状态。
- UI 明确展示截断、取消、失败、等待用户输入和可恢复建议。

## 范围

范围内：`ypi_studio_subagent` 子进程生命周期、stdout/stderr 有界处理、AbortSignal/stop 级联、idle/max runtime timeout、transcript/progress/browser-safe 投影、相关 API/组件展示建议。

范围外：重做 Pi SDK abort 机制、引入完整任务队列系统、实现跨机器进程恢复、改变 YPI Studio 工作流产品语义。

## 验收摘要

- 不再对完整 stdout/stderr 做无界 Buffer 累积或超大字符串转换。
- stop 后子进程收到终止信号，必要时进程组强杀；route 不长时间挂起。
- 超大输出会被截断并记录 warning，不会造成 SSE/React 崩溃。
- idle/max runtime 超时会把 run 记录为 failed/cancelled 并 finalize transcript。
- 实现后通过 lint、tsc，并用模拟超大输出/无输出/忽略 SIGTERM 子进程手工或脚本验证。
