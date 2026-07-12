# brief

## 背景

Yolk Pi Web 服务运行数天后可能增长到数 GB 内存。已有分析把首要怀疑指向服务端长期驻留的 `AgentSession` 及被 Studio child run 延长的父会话生命周期；次级怀疑包括 Studio continuation 容器、session path cache、OpenAI Codex WebSocket 调试统计，以及 SSE 连接清理。本任务不判断或修复泄漏，只增加可重复采集、可交付给用户分析的只读诊断快照。

## 目标

- 在目标 Yolk Pi Web 服务进程内采集一次有界内存诊断快照。
- 覆盖 Node 进程内存、运行时长、活跃 AgentSession、Studio child/continuation 容器、session path cache，以及 Browser Share、Terminal 等低优先级运行时容器的计数摘要。
- 将 JSON 快照原子写入 `~/.pi/agent/diagnostics/`，并向触发方返回文件路径、采集时间、大小和有限摘要。
- 让多次快照可按时间对比，帮助判断“进程内存增长是否伴随某类容器或单 session 体量增长”。
- 在 Settings 提供前端入口按钮，降低对 curl 的依赖。

## 推荐触发方式

1. **主入口（用户要求）**：Settings 弹窗新增 `diagnostics` section，按钮「生成内存诊断快照」。
2. **兼容入口**：`POST /api/diagnostics/memory-snapshot`，仍可用 curl。

API 必须在当前运行中的 Next.js 服务进程内调用共享采集模块，不能启动独立进程采集。前端只消费元数据响应，不渲染完整 JSON。

## 采集边界

- 进程：PID、Node/平台版本、uptime、`process.memoryUsage()`、`process.resourceUsage()`、可用时的 V8 heap statistics，以及采集耗时/截断信息。
- AgentSession：registry/start-lock 数量；每个已驻留 wrapper 的 session id、路径、cwd、存活/streaming/compacting 状态、listener 数、idle timer 状态、Studio child pin 数、branch entry 数、agent message 数及按角色/内容类型统计的字符或字节长度。只遍历有上限的 session/message/content 项。
- Studio：child run 按状态/runner/member 聚合和有界逐项摘要；continuation callback、pending continuation、terminal key 数量及 pending attempts/age 摘要。
- 次级容器：session path cache、Browser Share、Terminal、session-file-change 写入锁等只读计数和有界摘要；OpenAI Codex debug stats 仅对已知活跃 session id 查询公开 getter，不尝试枚举第三方私有 Map。
- 启发式 findings：例如高 RSS/heap、驻留 session 多、单 session message/content 体量大、child 长时间 running、pending continuation 多、listener 多；必须标注为 heuristic，不宣称根因。

## 安全与性能约束

- 不 abort/destroy session，不清理 cache，不重置 debug stats，不改变 task/run/terminal/browser 状态。
- 不输出 token、API key、环境变量、system prompt、完整消息、工具参数/结果、Studio result/transcript 或终端缓冲正文。
- 路径允许保留，便于关联用户工作区和 session 文件；错误只保存类型/错误码/有界安全消息，避免对象递归序列化。
- 默认总超时 5 秒；session、message、content、run、finding 均有固定采样上限；超过上限只记录总数和 `truncated`。
- 快照在内存中保持为小型纯 JSON 投影，限制最终 JSON 大小；使用临时文件加 rename 原子落盘，文件名含 UTC 时间、PID 和随机后缀，目录/文件权限尽力设为 `0700`/`0600`。

## 范围外

- 修复任何内存泄漏或修改 idle/SSE/Studio continuation 生命周期。
- 自动周期采集、告警、上传、遥测、远端支持服务。
- V8 heap snapshot、GC 强制触发、inspector、诊断压缩包、完整日志或会话导出。
- 诊断文件浏览列表、下载中心、自动 retention、完整 JSON 预览。

## 成功标准

1. Settings 诊断入口或 API 触发后返回成功元数据，且 `~/.pi/agent/diagnostics/` 出现可解析 JSON 文件。
2. 快照能在不读取正文的前提下关联进程内存与关键 runtime 容器、逐 session 体量指标。
3. 大 session/大量 runtime 项会被截断并在超时内结束，不因诊断显著放大内存。
4. 采集前后业务状态不变；敏感内容测试不能在文件中找到 marker。
5. API/共享模块契约、Settings 入口和运维用法写入项目文档。

## UI 门禁

**已触发。** 用户要求新增前端诊断按钮，属于前端功能新增。已产出 HTML 原型 [ui-prototype.html](ui-prototype.html)，说明见 [ui.md](ui.md)。实现前需用户审批原型与放置方案。

## 待审批决策

- 批准 Settings → 诊断 section + 后端 API 的组合方案。
- 推荐路径原样保留以便定位 session/workspace；文件明确标注“分享前审阅”。
