# prd

## 目标与背景

用户在 YPI Studio 中运行 `ypi_studio_subagent` 时遇到两类故障：

1. 子代理长时间无进展，主 session 点击 stop 后没有明显效果。
2. 服务端报 `Error: Cannot create a string longer than 0x1fffffe8 characters ... ChildProcess`，疑似子进程 stdout/stderr 或 SSE/tool event 无限累积。

当前代码证据显示 `runChildPi()` 会保存完整 stdout/stderr chunk，并在结束时转成完整字符串；这与 V8 单字符串上限报错高度吻合。

## 范围内

- 有界处理 child Pi stdout/stderr、live progress、final output、transcript。
- 主 session abort/destroy 级联到 YPI Studio child process。
- 子代理 no-progress/idle/max-runtime timeout。
- 终止后的 run 状态、warnings、UI 展示与恢复操作建议。
- API/route 对 abort 入口的安全处理。

## 范围外

- 不改变 Studio 工作流状态机主路径。
- 不实现复杂断点续跑；只提供“从当前阶段继续/重试”的恢复入口建议。
- 不新增用户可配置设置页，除非主会话决定本轮需要可调 timeout/output limit。

## 需求与验收标准

1. **输出有界**
   - stdout/stderr 不允许无界 Buffer 数组或无界字符串累加。
   - final tool result 文本必须截断到浏览器安全大小，并附带 warning。
   - transcript/API/live progress 均有硬上限。

2. **stop 有效**
   - `POST /api/agent/[id] { type: "abort" }` 对已有运行 session 先级联终止活跃 Studio child。
   - 如无运行 session，不应为了 abort 启动新 AgentSession。
   - 子进程先 SIGTERM，超时后 SIGKILL/Windows taskkill，且 run 最终落盘为 cancelled 或 failed。

3. **卡死检测**
   - child 启动后无首事件、运行期间无 stdout/stderr/parsed event、总运行过长都应产生 warning 或自动终止。
   - 自动终止后 parent tool promise 必须 resolve，不得永久等待。

4. **可恢复**
   - 任务不应因单个 child 失败自动进入 terminal 状态。
   - UI/结果中提示可重试同一 member/prompt、终止当前 run、标记失败，或让主 session 从当前 workflow 阶段继续。

## 未决问题

- 默认阈值是否接受：stdout 16MiB、stderr 1MiB、单行 1MiB、final output 256KiB、idle 10min、max runtime 60min、kill grace 2s/5s。
- 本轮是否只做硬编码常量，还是同时增加 `pi-web.json`/Settings 配置项。
