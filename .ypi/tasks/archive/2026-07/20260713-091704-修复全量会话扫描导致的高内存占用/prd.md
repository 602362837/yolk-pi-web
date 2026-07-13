# PRD：轻量会话元数据扫描

## 目标与背景

会话列表只需少量元数据，但当前 Pi SDK `SessionManager.listAll/buildSessionInfo` 为所有会话生成并保留 `allMessagesText`，导致会话数量和正文体积增大时堆内存近似随全量语料增长。目标是让列表扫描的保留内存主要随“会话数 × 有界元数据”增长，而不是随消息正文总量增长。

## 范围内

- 活跃会话 inventory/list 的轻量元数据扫描。
- 项目空间会话列表、全局会话列表、allowed-roots cwd 枚举、按 cwd 删除、archive-all 对新 inventory 的复用。
- 归档列表/归档 inventory 中现存完整解析旁路的收敛。
- Studio child header 识别、parent path 到 id 映射、project/space link、WorkTree 失效清理兼容。
- 自动化回归与内存行为验证。

## 范围外

- 会话详情、上下文、分支导航、导出等单会话完整加载。
- Usage 对 assistant usage 的精确扫描（它仍需读目标 usage 字段，但应避免先经由保留全文的 inventory）。
- JSONL 格式迁移、强一致数据库/索引、UI 改版。
- 修改或发布上游 Pi SDK。

## 需求与验收标准

### R1 轻量扫描

- 扫描每个 JSONL 时仅保留：path/id/cwd/name/parentSessionPath/created/modified/messageCount/有界 firstMessage，以及现有 header metadata 所需字段。
- 不产生 `allMessages[]`、`allMessagesText`，不调用 `SessionManager.open(...).getEntries()` 获取列表元数据，不把完整 message/tool content 放入结果或缓存。
- 单条超大消息的正文处理必须有界；实现说明需明确解析器是否仍短暂物化完整 JSON 行。若会物化，则不满足本任务的“轻量”核心验收。

### R2 行为兼容

- `/api/sessions` 与 project-space sessions API 保持现有字段和分组/Studio child 过滤语义。
- `name` 采用最新 `session_info`（显式清空恢复 undefined）；`messageCount` 统计所有 message entry；`firstMessage` 取首条 user 文本；`modified` 优先最后 user/assistant 活动时间，再 header timestamp，再文件 mtime。
- UI 标题前 50 个规范化字符与现有实现一致；超出显示所需部分允许有界截断。
- malformed/orphan 文件保持容错，不因单文件失败导致整个列表失败。

### R3 生态兼容

- legacy headers、可选 projectId/spaceId、Studio child、parentSession、归档文件均不迁移、不回写。
- Studio child 仍默认隐藏，项目空间内仍折叠到可见 parent；Usage 明确 opt-in child 的行为不变。
- 删除 WorkTree session、archive-all 按 canonical cwd 匹配不变。

### R4 性能

- 压测夹具包含多个大正文会话和超大单行消息；扫描结果对象中不存在完整正文标记。
- 在 `node --expose-gc` 隔离进程中比较扫描前后 heap/RSS，设宽松、可重复的预算：保留 heap 不随正文总字节近线性增长，且显著低于 SDK `listAll` 基线。CI 以结构性“不保留正文”测试为硬门禁，内存数值测试可使用足够宽松阈值避免平台抖动。

## 未决问题

无阻塞产品问题。实现时建议确定首条标题扫描上限（推荐 1–4 KiB 的规范化文本预算，最终 API 可返回不超过 100 字），并在测试中锁定“前 50 展示字符兼容”。
