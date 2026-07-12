# PRD

## 目标与背景

为运行数天后内存可能增长到数 GB 的 Yolk Pi Web 服务增加一次性、只读、可重复对比的内存诊断快照。快照必须在目标服务进程内采集，帮助用户把 Node 进程内存与 AgentSession、Studio runtime 及其他 in-process 容器的数量/体量变化关联起来。本任务不修复泄漏，也不以启发式结论替代后续根因分析。

用户明确要求提供前端入口，避免只靠 curl。

## 用户价值

- 用户可在 Settings 一键触发，或用 curl 在内存较低、增长中、增长后分别采集，保留带时间戳的 JSON 证据。
- 支持人员无需获得完整对话、工具结果或凭证，即可比较驻留 session、消息体量、Studio child/pending continuation 和 cache 的增长趋势。
- 诊断失败或数据量过大时以部分结果和错误摘要降级，不进一步推高内存或扰动业务状态。

## 范围内

1. 新增 `POST /api/diagnostics/memory-snapshot`，在当前 Next.js 服务进程中触发采集。
2. 新增共享诊断模块，生成 schema-versioned JSON，并原子写入 `<getAgentDir()>/diagnostics/`，通常为 `~/.pi/agent/diagnostics/`。
3. 采集进程、AgentSession、Studio runtime、session path cache、Browser Share、Terminal、session-file-change 运行态的有界摘要。
4. 针对当前已知 AgentSession id 查询 OpenAI Codex WebSocket debug stats 公开 getter；不修改第三方包，不反射私有 Map。
5. 生成明确标注为 heuristic 的 findings、采集耗时、各 section 错误和截断元数据。
6. **Settings 前端入口**：新增 `diagnostics` section，按钮「生成内存诊断快照」，展示 loading/success/error/409 状态与文件元数据。
7. 增加纯采集/脱敏/上限/落盘/API 测试，以及 API、library、architecture、operations、frontend 文档。

## 范围外

- 泄漏修复、idle 策略调整、SSE cleanup 修复、Studio continuation 清理。
- heap dump、V8 inspector、强制 GC、CPU profile、自动定时采集和告警。
- 诊断上传、远程 telemetry、压缩包或完整日志导出。
- 诊断文件列表/下载管理、自动 retention、浏览器内完整 JSON 预览。
- 枚举 `@earendil-works/pi-ai` 未公开的 WebSocket cache/debug Map。
- 顶栏/聊天主路径常驻按钮（避免噪声；如需可后续另议）。

## 功能需求与验收标准

### R1 触发与响应

- `POST /api/diagnostics/memory-snapshot` 无需请求体即可触发默认采集。
- 成功响应包含稳定类型标识、schema version、`capturedAt`、绝对 `filePath`、`fileName`、`bytes`、`durationMs`、`partial`、section/error/truncation 摘要。
- 同一进程只允许一个快照采集写入；并发请求返回 `409 snapshot_in_progress`，不得排队复制采集内存。
- 失败返回结构化错误和适当 5xx；错误响应不含 env、token、会话正文或递归对象。

### R2 进程信息

- 记录 PID、PPID、Node/version/platform/arch、uptime、启动/采集时间。
- 记录 `process.memoryUsage()`：rss、heapTotal、heapUsed、external、arrayBuffers。
- 记录 `process.resourceUsage()` 和 V8 `getHeapStatistics()` 中数值字段；不可用 section 记录 error，不阻断其他 section。
- 记录快照采集前后 memory usage 和 delta，便于识别诊断自身成本。

### R3 AgentSession 诊断

- 记录 registry 总数、alive/streaming/compacting 数、start lock 数和被 Studio child pin 的 session 数。
- 默认最多投影 100 个 session；按估算 retained content bytes 降序保留，另记录总数、采样数和截断数。
- 每个 session 只记录 id、cwd、sessionFile、provider/model、状态、listener 数、idle timer 是否存在、Studio child 数、branch entry 数、agent message 数、角色计数、内容 block 类型计数、字符串总字符/UTF-8 字节估算、最大单项长度、系统提示长度、active tool 数、OpenAI Codex debug stats 数值/布尔摘要。
- 默认每 session 最多遍历 2,000 条 branch entry、2,000 条 agent message、每 message 最多 100 个 content block；超限停止读取并标记截断。
- 不复制/返回 message content、tool args/result、system prompt、图片/base64、provider response id 或 debug error 原文。

### R4 Studio runtime 诊断

- 记录 child run registry、continuation callbacks、terminal continuation keys、pending continuations 的总数。
- child run 按 status/runner/member 聚合，最多输出 200 个安全摘要。
- pending continuation 最多输出 200 个安全摘要；不输出 summary/payload text/callback。

### R5 次级容器

- session path cache 记录总数和最多 100 个 `{ sessionId, path }`。
- Browser Share 记录 share/binding/tombstone/command/waiter 数及按状态聚合，不输出 page snapshot/command payload。
- Terminal 记录 session 数、kind/backend 聚合、subscriber/buffer chunk/estimated buffer bytes 等摘要，不输出 buffer/input/SSH secrets。
- session-file-change 为当前活跃 session 只读取 sidecar 文件数/pending tool 数和文件大小/更新时间。

### R6 安全、上限与落盘

- 总预算默认 5 秒；每个 section 单独捕获错误。超时后不再开始新 section，写入已有部分并标记 `partial=true`。
- 最终 JSON 默认硬上限 5 MiB；超限先移除逐项 samples；仍超限则失败且清理临时文件。
- 文件名格式稳定且无用户输入，例如 `memory-<UTC compact>-pid<PID>-<random>.json`。
- 目录和文件权限尽力设置 `0700`/`0600`；同目录临时文件写完后 `rename`。
- 文件含 `privacy` 声明，明确无正文/凭证但含本机路径和标识符，提醒分享前审阅。

### R7 启发式 findings

- 至少覆盖：RSS/heap 高、registry session 多、单 session 估算 content bytes 高、listener 多、child run 长时间 queued/running、pending continuation 多/重试高、path cache 明显大于驻留 session、terminal/browser 容器异常多。
- 每项包含 code、severity、message 和只含数值/id/path 的 evidence；不得声称“已确认泄漏”。

### R8 前端入口（Settings Diagnostics）

- Settings 侧栏新增 `diagnostics` section，文案「诊断 / Diagnostics」。
- 主按钮「生成内存诊断快照」调用 `POST /api/diagnostics/memory-snapshot`。
- 状态：idle / loading（按钮 disabled）/ success / error / 409 busy。
- success 展示：filePath（可复制）、bytes、durationMs、schemaVersion、partial/truncated 标记；**不**渲染完整 JSON。
- 明确隐私 callout：可能含本机 workspace/session 路径，不会自动上传，分享前审阅。
- 次要说明可保留 curl 示例。
- 不做文件列表、下载中心、自动清理。

### R9 兼容与文档

- additive API 和 additive module export，不改变既有 API、JSONL、task、session、config 格式。
- `docs/modules/api.md`、`docs/modules/library.md`、`docs/modules/frontend.md`、`docs/architecture/overview.md`、`docs/operations/troubleshooting.md` 记录契约、Settings 入口、curl 用法和多快照对比建议；`AGENTS.md` 增加诊断入口导航。

## 非功能需求

- TypeScript strict；运行时 owner 自己投影私有容器，统一 collector 不直接读取其他模块私有字段。
- 快照采集不得调用 abort/destroy/cleanup/reset/GC，不调用会创建 AgentSession 的 API。
- API route 固定 Node.js runtime。
- 前端请求期间防重复点击；409 与网络错误需可读文案。
- 用户可连续采集多个文件；本次不做自动 retention。

## UI 门禁

**触发。** 新增 Settings 诊断 section 与按钮。HTML 原型：[ui-prototype.html](ui-prototype.html)，说明见 [ui.md](ui.md)。实现前需用户审批。

## 未决问题

- 审批时确认 Settings → Diagnostics 放置；备选：Yolk section 底部动作区，或 Usage 弹窗次要动作。
- 审批时确认诊断文件保留完整本机路径。推荐保留。
