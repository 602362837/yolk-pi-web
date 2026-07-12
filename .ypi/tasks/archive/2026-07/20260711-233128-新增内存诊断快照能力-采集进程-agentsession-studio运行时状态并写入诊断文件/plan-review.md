# 计划审批书：内存诊断快照（含前端入口）

## 变更说明

原方案为 API-only（curl）。用户反馈后已修订为：

1. 后端只读诊断采集 + `POST /api/diagnostics/memory-snapshot`（保留）
2. **Settings 新增「诊断」入口与「生成内存诊断快照」按钮**（新增）
3. HTML 原型已产出，等待你审批

## 要解决什么

Yolk Pi Web 运行数天后可能增长到数 GB 内存。本计划只增加诊断证据采集，不修复或清理任何疑似泄漏。

详细材料：

- [PRD](prd.md)
- [Design](design.md)
- [Implement](implement.md)
- [Checks](checks.md)
- [UI](ui.md)
- [HTML 原型](ui-prototype.html)
- [Brief](brief.md)

## 采集什么

- Node 进程：RSS、heap/external/array buffer、resource usage、V8 heap statistics、uptime、采集前后 delta。
- AgentSession：驻留/活跃/streaming/compacting/start-lock 数，逐 session listener、idle timer、Studio child pin、branch/message 体量估算。
- Studio runtime：child run 状态/年龄，continuation 相关计数与有界摘要。
- 次级容器：session path cache、Browser Share、Terminal、active session file-change sidecar 安全计数。
- OpenAI Codex：仅已知 active session 的公开 getter 数值/布尔 stats。
- 启发式 findings：只提示值得检查的异常，不宣称已确认泄漏。

## 如何触发与落盘

**前端主入口（推荐）**

1. 打开 Settings
2. 左侧选择「诊断 / Diagnostics」
3. 点击「生成内存诊断快照」
4. 查看 success 元数据（路径/大小/耗时），不在浏览器展开完整 JSON

**兼容入口**

```bash
curl -X POST http://localhost:30141/api/diagnostics/memory-snapshot
```

JSON 原子写入 `~/.pi/agent/diagnostics/`（或 `PI_CODING_AGENT_DIR` 对应目录）。API 与 UI 都只暴露元数据。

## 前端放置

- **推荐**：Settings → 诊断 section（见 [ui-prototype.html](ui-prototype.html)）
- **备选 A**：Yolk section 底部动作区
- **备选 B**：Usage 弹窗次要动作

状态覆盖：idle / loading / success / error / 409 busy；含隐私 callout 与复制路径。

## 安全与性能边界

- 严格只读：不 abort/destroy session，不 cleanup/reset/GC/heap snapshot。
- 不写 token、key、env、完整对话、system prompt、工具参数/结果、Studio transcript、终端 buffer、Browser Share 页面正文。
- 保留本机 workspace/session 路径与 id 以便排障；文件明确提示「分享前审阅」。
- 默认 5 秒 deadline；最终 JSON 上限 5 MiB；进程内单飞，并发 409。
- 本次不做自动 retention / 文件列表 / 下载中心。

## UI 与原型审批

**需要 UI 原型审批。**

请审阅：

- [ui.md](ui.md)
- [ui-prototype.html](ui-prototype.html)

实现前必须同时批准 HTML 原型与入口位置。

## 实施计划

串行 DAG（maxConcurrency=1）：

1. Runtime owner 有界只读 projection
2. 快照编排、原子落盘、POST API + tests
3. Settings Diagnostics 按钮与状态 UI
4. 文档与完整检查

机器可调度 plan 见 [Implement](implement.md)。

## 批准后的验收标准

- Settings 可一键采集；POST 返回 `201`，产生可 `jq` 解析的 schema v1 JSON。
- 快照能关联进程内存与 AgentSession/Studio/次级容器数量和体量。
- marker 测试证明文件与 API/UI 响应不含正文或凭证。
- 采集前后 runtime 业务状态不变。
- 并发、section 异常、deadline、5 MiB fallback、原子写失败均安全降级。
- UI 五态与隐私提示正确。
- `npm run test:memory-diagnostics`、`npm run lint`、`tsc --noEmit` 通过。

## 审批请求

请确认以下四项（可回复「确认批准」或指出要改的点）：

1. 批准后端只读诊断范围、实施 DAG 和检查门禁。
2. 批准 Settings → 诊断 section 作为前端入口（或指定备选位置）。
3. 批准 [ui-prototype.html](ui-prototype.html) 的交互与状态设计。
4. 批准诊断文件保留完整本机 workspace/session 路径；文件不自动上传，分享前人工审阅。

批准前任务保持 `awaiting_approval`，不会进入实现，也不会派发 implementer。
