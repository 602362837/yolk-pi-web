# Checks

## 需求覆盖

- [ ] `POST /api/diagnostics/memory-snapshot` 在运行中服务进程采集并返回 `201` 文件元数据。
- [ ] 文件写入 `<getAgentDir()>/diagnostics/`，命名无用户输入，JSON 为 `kind=yolk-pi-memory-diagnostic`、`schemaVersion=1`。
- [ ] 覆盖 process/V8、AgentSession、Studio runtime、path cache、Browser Share、Terminal、session-file-change section。
- [ ] 每个 section 有 totals/aggregates；逐项样本有 total/sampled/truncated 元数据。
- [ ] findings 明确标记 heuristic，不宣称已确认泄漏。
- [ ] 不包含泄漏修复、cleanup、abort、destroy、强制 GC、heap dump 或定时采集。
- [ ] Settings 存在 Diagnostics section 与「生成内存诊断快照」按钮，状态覆盖 idle/loading/success/error/409。
- [ ] success 仅展示元数据并可复制路径；无完整 JSON 预览/文件列表/下载中心。
- [ ] 隐私 callout 可见；UI 与 [ui-prototype.html](ui-prototype.html) 主路径一致。

## 安全检查

- [ ] 用带唯一 marker 的 user/assistant/tool result/system prompt/Studio summary/progress text/terminal buffer/browser snapshot 构造 fixture，诊断 JSON 中均搜索不到 marker。
- [ ] 用 `sk-test-secret-marker`、`Bearer secret-marker`、`refresh_token=secret-marker` 测试错误/字符串边界，文件和 API 响应中均不存在 marker。
- [ ] AgentSession 只输出长度、计数、角色/content type、id/path/model/provider；不输出 content、args、result、system prompt。
- [ ] Studio 不输出 `result`、promise、callback、summary、lastTextPreview、itemsPreview、warning 文本。
- [ ] Browser Share 不输出 URL/title/selection/page text/command input/result；Terminal 不输出 buffer/input/credential/env。
- [ ] OpenAI Codex stats 不输出 previous response id 或 last error 字符串，只保留数值/布尔。
- [ ] API 不接受自定义文件路径或放宽脱敏的请求参数。
- [ ] 前端响应处理不把完整 snapshot body 写入 state/DOM。
- [ ] 响应与文件权限符合预期：`Cache-Control: no-store`，POSIX 上目录 `0700`、文件 `0600`（平台不支持时 best effort）。

## 只读性检查

- [ ] 采集前后比较 RPC registry id/status、Studio registry/pending keys、Browser Share counts、Terminal ids、path cache entries，除诊断锁释放外无变化。
- [ ] helper 未调用 `destroy`、`abort`、`dispose`、`cleanupSessionResources`、`resetOpenAICodexWebSocketDebugStats`、`closeOpenAICodexWebSocketSessions`、`cleanupExpired`、`closeTerminalSession`、`global.gc`。
- [ ] 采集不调用 `startRpcSession`、`listAllSessions` 或会扫描/修剪 session 的浏览 helper。
- [ ] 对过期 Browser Share 记录采集后仍保持原记录，证明 projection 没有隐式 cleanup。

## 有界性与故障检查

- [ ] 构造超过 100 sessions、每 session 超过 2,000 messages/entries、每 message 超过 100 blocks，验证计数停止且 `truncated` 正确。
- [ ] 构造超过 200 child/pending continuation、100 path cache/terminal sample，验证总数保留、样本截断。
- [ ] deadline 已过时 helper 立即停止；整体写出 partial 快照，不继续开始后续昂贵 section。
- [ ] 模拟某 section getter 抛错，其他 section 仍写出，`errors[]` 仅含有界安全消息。
- [ ] 模拟首轮 JSON 超过 5 MiB，验证 compact fallback 删除 samples、保留 totals；fallback 仍超限时无正式文件且 tmp 被清理。
- [ ] 两个并发 POST：一个执行，一个稳定返回 `409 snapshot_in_progress`，完成后第三次可成功。
- [ ] 模拟 mkdir/open/write/rename 失败，响应无秘密、tmp 尽力删除、不留下半个正式 JSON。

## UI 检查

- [ ] Settings 侧栏可见「诊断 / Diagnostics」，点击进入 diagnostics 内容区。
- [ ] loading 时按钮 disabled 且文案变化，防止重复提交。
- [ ] 201 成功后显示 path/bytes/duration/partial，复制路径可用。
- [ ] 409 显示“已有快照进行中”类文案。
- [ ] 网络错误与 5xx 显示可读错误，不崩溃 Settings 弹窗。
- [ ] 长路径可换行/滚动，不撑破布局。
- [ ] 键盘可聚焦按钮；主要文案对比度可接受。
- [ ] 无文件浏览器、无自动下载、无完整 JSON 展开。

## 数据正确性

- [ ] `process.memoryUsage()` 与文件数值一致，前后 delta 计算无 NaN/负零异常。
- [ ] UTF-8 byte estimate 使用 `Buffer.byteLength`，ASCII/中文/emoji fixture 结果正确。
- [ ] role/content-type 聚合与 fixture 一致。
- [ ] Studio age 对合法/无效时间处理稳定；status/runner/member 聚合总和与 registry 总数一致。
- [ ] terminal buffer bytes 为逐 chunk 估算且不出现 buffer 文本。
- [ ] findings 阈值边界有纯函数测试。
- [ ] third-party stats 字段名/文档明确仅覆盖 known active session ids。

## 自动验证

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:memory-diagnostics
```

不运行 `next build`。

## 人工验收

1. 打开 Settings → 诊断，低负载采集一次，确认 success 元数据与文件落盘。
2. 打开至少两个普通 chat，其中一个产生较大工具结果；启动一个 Studio child run，再采集一次。
3. 确认第二份快照的 session/child/message length 指标合理增长，但没有任何聊天/工具原文。
4. 用 curl 再触发一次，确认与 Settings 共用同一 API/互斥。
5. 在采集进行中快速连点/并发 curl，确认 409 与 UI busy 态。
6. 使用 `jq` 解析文件并按 `capturedAt` 对比 rss/heap/session retained estimate。
7. 检查 API 与 UI 均只暴露元数据，不返回/渲染完整快照。

## 回归风险

- `rpc-manager` 访问 SDK 内部可选 shape 时必须防御版本差异。
- 新增 export 不应改变热重载 global registry 初始化时机或 session lifecycle。
- Settings section union/exhaustive switch 遗漏会导致编译或空白面板。
- Browser Share/Terminal projection 必须留在 owner 模块。
- sync deadline 是 cooperative；review 必须检查所有大循环是否周期检查 deadline。
- 文件保留完整路径是已知隐私权衡；分享诊断文件前需人工审阅。
