# 计划审批书：修复全量会话扫描导致的高内存占用

## 审批摘要

已确认根因：已安装 Pi SDK 的 `SessionManager.listAll()` 经 `buildSessionInfo()` 把所有会话的 user/assistant 文本累计到 `allMessages[]`，再生成 `allMessagesText`；项目列表不消费该字段，但扫描峰值和缓存保留会随全量正文增长。

计划新增项目自有的有界、增量 JSONL 元数据扫描器，替换 active list、allowed-roots、按 cwd 删除、archive-all 和归档列表中的重扫描/完整解析路径。JSONL 继续作为事实来源；API wire、Sidebar 标题前 50 字、消息数、更新时间排序、project/space link、Studio child 折叠和 archive 语义保持兼容。详情/上下文/分支/导出仍按需完整读取，Usage 精确统计不改口径。

## 审批要点

- **PRD**：列表保留内存从随正文总量增长收敛为随会话有界元数据增长。
- **Design**：按 chunk 解析并跳过 content，不接受 `readline + JSON.parse(line)` 作为最终轻量方案；不引入强一致索引。
- **Implement**：5 个 DAG 子任务，先 scanner，再并行接 active/archive，最后性能回归与文档。
- **Checks**：兼容差分、超大单行、结构性正文不保留、隔离进程 heap/RSS、API/Studio child/archive/Usage 回归。
- **UI**：无页面、交互、审批体验或信息结构变化，明确不触发 HTML prototype 门禁。

## 相关产物

- [Brief](brief.md)
- [PRD](prd.md)
- [UI 门禁评估](ui.md)
- [Design](design.md)
- [Implement / Implementation Plan](implement.md)
- [Checks](checks.md)

## 请求审批

请主会话核对并保存 `implement.md` 中的结构化 implementation plan，然后将任务切换到 `awaiting_approval`。必须等待用户明确批准后，才可进入实现；本架构阶段未修改生产代码。
