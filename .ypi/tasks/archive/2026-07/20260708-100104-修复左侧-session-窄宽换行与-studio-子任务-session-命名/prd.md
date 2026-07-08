# PRD

## 目标与背景

左侧 Session 列表在窄侧栏下需要保持稳定、可读、不可错位；Studio child session 标题需要准确表达被委派的 implementation subtask，避免多个 child session 都显示同一个主任务名而难以区分。

## 范围内

- 修复 `components/SessionSidebar.tsx` 中普通 Session 行、Studio child 行、Archived Session 行在窄宽下的单行截断行为。
- 调整 Studio child session 标题优先级：
  1. implementation subtask 标题；
  2. `member/角色 + 主任务名称`；
  3. 其他安全 fallback（run summary、taskId basename、session id）。
- 调整 SDK child session 新建时写入的 `session_info` 名称，使未来 child session 持久名称符合上述优先级。
- 保持现有 API 类型兼容，不迁移历史 JSONL。

## 范围外

- 不重设计左侧侧栏整体信息架构。
- 不改 Project Registry、session 链接、Studio task 状态机或子任务调度逻辑。
- 不批量重写历史 child session JSONL 的 `session_info`。
- 不引入新的后端 API 字段，除非实现时发现现有 `studioChildDisplay` 不足。

## 需求与验收标准

1. 窄侧栏单行截断
   - Given 左侧侧栏宽度缩小到很窄（例如 160px 或更小），When 查看普通、带 WorkTree badge、带 Studio badge/detail、hover 操作按钮、归档行，Then 每行高度稳定，标题和元信息不换行，超出宽度以省略/裁剪显示。
   - 不应出现上下两行互相覆盖、第二行换到第三行、按钮挤压导致行高错乱。

2. Studio child session 标题准确
   - Given child session header 有 `studioChild.subtaskId` 且任务 detail 能解析对应 implementation subtask 标题，Then Session 列表标题优先显示该 subtask 标题。
   - Given 无 subtaskId 或无法解析 subtask 标题，但能解析主任务标题，Then 标题回退为 `member · 主任务标题`（或等价的角色 + 主任务名称）。
   - Given 任务 detail 不可读，Then 保留安全 fallback，不导致 session 列表失败。

3. 新建 SDK child session 持久名称
   - Given 通过 `ypi_studio_subagent` 启动 SDK child session，When 写入 `session_info`，Then 名称优先包含 subtask 标题；没有 subtask 标题时包含 member + 主任务标题。

4. 兼容性
   - 历史普通 session、历史 Studio child session、归档 session 仍可读可打开。
   - 不改变 Studio child session 只读审计语义。

## 未决问题

- UI 原型与用户审批尚未完成；实现前需主会话指派 `ui-designer` 输出 HTML 原型并获得批准。
- “角色 + 主任务名称”的最终展示分隔符建议为 `member · taskTitle`，需用户/主会话确认是否接受英文 member id（如 `implementer`）或需要中文角色名映射。
