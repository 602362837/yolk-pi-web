# Brief：修复全量会话扫描导致的高内存占用

## 问题结论

根因已由已安装 Pi SDK 源码确认：`SessionManager.listAll()` 对每个 JSONL 调用 `buildSessionInfo()`；后者逐条解析全部消息，把每条 user/assistant 文本放入 `allMessages[]`，最后再执行 `allMessages.join(" ")` 生成 `allMessagesText`。因此一次全量扫描会同时保留大量消息文本，并在 join 时产生额外大字符串；项目会话列表实际不消费 `allMessagesText`。并发上限 10 只能限制同时读取的文件数，不能限制最终 `SessionInfo[]` 对所有会话全文的累计保留。

当前高频入口 `lib/session-reader.ts#listAllSessionsUncached()`、允许根目录发现、按 cwd 删除，以及 `sessions/archive-all` 均会触发该路径；1 秒快照只能减少短时间重复扫描，不能降低首次扫描峰值，且缓存会继续持有 SDK 返回对象。

## 目标

在不改变会话 JSONL、API 响应形状、排序/标题/Studio child 折叠语义的前提下，用项目自有的轻量元数据扫描器替代列表与批处理路径上的 `SessionManager.listAll()`：流式读取文件，只保留 header、最新 session name、消息数、首条用户文本的有界标题前缀、最后活动时间和文件 stat，不累计或返回完整消息正文。

## 关键决策建议

1. JSONL 仍是事实来源；不引入必须正确的索引或迁移。
2. 轻量扫描器必须按文件流式处理，并对首条用户文本设置固定上限；不得先 `readFile`、`getEntries()` 或构建 `allMessagesText`。
3. 保持有限并发，结果只含项目需要的元数据类型，不沿用含 `allMessagesText` 的 SDK `SessionInfo`。
4. 详情、上下文、分支、导出、Usage 精确统计仍可按需完整打开目标文件；本修复不改变这些语义。
5. 活跃、归档列表和批量 archive/delete/allowed-roots 路径逐步统一到同一扫描器，避免旁路复发。

## UI 门禁

不触发 UI prototype。该修复不新增页面/组件，不改变交互、审批体验或用户可见信息结构；标题仍由首条用户消息前缀生成，展示层本就截断为 50 字。若实现阶段决定新增“扫描被截断”提示、设置项或诊断面板，则必须重新判定并派发 UI 设计员。
