# Design：有界 JSONL 会话元数据扫描器

## 方案摘要

在 `lib/` 新增项目自有的 session inventory scanner，由 `lib/session-reader.ts` 统一调用。扫描器枚举 active/archive 目录中的 `.jsonl`，以固定并发读取；对每个文件使用增量 JSON token/state 解析，仅提取元数据字段并跳过无关 value，尤其是 message content、tool result、compaction summary 和 custom data。扫描完成后返回不含正文聚合字段的内部 `LightweightSessionMetadata`。

不建议仅把 SDK `allMessagesText` 从映射结果中删除：峰值已在 `SessionManager.listAll()` 内发生。不建议用 `readline + JSON.parse(line)` 作为最终方案：虽然不跨会话保留正文，但超大单行仍会同时物化完整行、完整 content 和解析对象，不能满足“单条消息有界”。不建议将 sidecar index 设为事实来源：外部 Pi 写入和旧会话会造成一致性问题。

## 内部契约

建议新增 `lib/session-metadata-scanner.ts`：

```ts
interface LightweightSessionMetadata {
  path: string;
  id: string;
  cwd: string;
  name?: string;
  parentSessionPath?: string;
  created: Date;
  modified: Date;
  messageCount: number;
  firstMessage: string; // bounded
}

interface ScanSessionInventoryOptions {
  rootDir?: string;
  concurrency?: number; // fixed default, e.g. 4–10
  firstMessageMaxChars?: number; // API bound, e.g. 100
}
```

同时提供单文件扫描与目录 inventory API，使 active、archive 和测试复用。返回类型刻意不包含 `allMessagesText`。

## 增量解析要求

- 输入按 chunk 读取，不按完整 JSONL 行缓存；维护字符串转义、对象/数组深度、当前 key/path 和目标 primitive 的有限状态。
- 只捕获：首条 session header 的必要 primitive、顶层 entry `type/timestamp`、`session_info.name`、message `role/timestamp`，以及首条 user message 的 content 文本前缀。
- content 为 string 时按 JSON escape 正确解码；为 blocks 数组时只拼接 `type:"text"` block 的有界 `text`，与 SDK 文本提取语义一致。达到预算后继续语法跳过但不累积文本。
- messageCount 对所有 message 计数；last activity 仅 user/assistant，优先数字 `message.timestamp`，否则 entry timestamp。
- 第一条有效 record 不是 session 时返回 orphan/null；单文件解析错误隔离。
- header 通常很小，但仍应设置合理 token/metadata 上限；超限文件按 malformed 处理，不能无限累积。

若团队不希望维护增量 JSON tokenizer，可选择经过审计的 streaming JSON parser 依赖，但必须验证其不会构造完整 content value，并更新依赖文档/lockfile。优先无新依赖的小型、聚焦 tokenizer，并以逃逸字符、chunk 边界和嵌套 content 测试约束。

## 数据流

```text
API / batch operation
  -> listAllSessions / scan inventory
  -> enumerate *.jsonl
  -> bounded-concurrency scanSessionMetadata(file)
  -> LightweightSessionMetadata[]
  -> read first header metadata/project link + Studio projection
  -> existing SessionInfo wire mapping/cache/filter
```

可进一步让 scanner 返回已解析 header metadata，避免 `listAllSessions` 二次 `readFirstLineSync`；首个版本也可保留该小型 header read，但应使用现有流式首行 helper，且不得 `readFileSync(file)`。

## 模块影响

- `lib/session-reader.ts`：替换三处 active `SessionManager.listAll()`；复用 lightweight 类型；保持 1 秒 single-flight cache 和 path cache。
- `app/api/sessions/archive-all/route.ts`：通过共享 inventory/list helper 按 cwd 筛选，不再直接调用 SDK。
- 归档：`listArchivedSessionMetadata` 已接近轻量，但 `scanArchivedCwds` 用 `readFileSync(...).split` 读取整文件，`listArchivedSessions` 用 `getEntries()`；均应改用单文件 metadata scanner。归档详情仍返回相同计数/标题。
- `lib/usage-stats.ts`：其精确 usage entry 扫描仍在范围外，但 inventory 来源改轻量后不再先保留所有正文；确认没有依赖 `allMessagesText`。
- API/UI：wire shape 不变，无组件改动。
- Studio child：metadata 从 header 解析；child display 任务 I/O、parentSessionId fold 和 include flags不变。

## 兼容性

- JSONL 为权威来源，无迁移、无写入。
- firstMessage 内部由“可能完整”收敛为有界；展示只使用 50 字，需测试前 50 字一致。Usage modal 也只作为标题使用。
- modified 不能简单改成 fs.mtime，否则排序和相对时间会发生可见变化。
- session name 必须扫描到文件末尾以获取最新 `session_info`，但只保留最新有界 name。
- SDK 未来若修复 `allMessagesText`，本地 scanner 仍提供稳定、可测试的项目契约；后续可评估回归 SDK API。

## 风险与缓解

1. **自定义 tokenizer 正确性**：用 chunk=1、随机 chunk、Unicode surrogate、escape、嵌套数组/对象、超大字符串和 malformed fixture 做差分测试。
2. **字段顺序变化**：解析必须按 JSON path/key，不依赖序列化字段顺序。
3. **标题差异**：对 SDK fixture 做 metadata 差分，只允许 firstMessage 上限后的差异。
4. **并发 I/O**：固定低并发并保留现有 single-flight；禁止 `Promise.all` 无界打开文件。
5. **缓存陈旧**：沿用并补齐 delete/archive/unarchive invalidation。
6. **归档行为变化**：active 与 archive 共用 scanner，但保留各自目录枚举和 archived 标记。

## 回滚

代码级回滚为恢复原 `SessionManager.listAll()` 调用；不涉及数据回滚。建议实现保持 scanner 边界集中，若线上发现 metadata 兼容问题可临时 feature fallback（仅代码常量/环境诊断开关，不新增 UI 配置），但不能长期默认回到高内存路径。
