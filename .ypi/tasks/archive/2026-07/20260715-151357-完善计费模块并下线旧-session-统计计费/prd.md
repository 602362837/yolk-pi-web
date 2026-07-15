# PRD

## 目标与背景

新调用账本已可承担全局 token / 费用统计。当前仍暴露旧 Session 扫描统计，造成双口径和配置复杂度；新账本同时存在日期边界错误、默认范围不符合预期、token 信息不完整、原生下拉不统一、覆盖率提示噪音和 Usage 图标表达不足。

目标是让用户只面对一套全局计费界面，并保持聊天顶栏所需的 Session / Studio child rollup 能力不回归。

## 用户价值

- 选择日期后，结果严格对应所选本地日期范围。
- 打开 Usage 即看到全部工作区，不会误以为只有当前目录。
- 每个 token 指标同时可读精确值与 M 换算。
- 筛选交互与项目其他设置一致。
- 页面不再展示内部覆盖率和 legacy 口径噪音。
- 全局统计只有一个账本口径，旧 Session 扫描不再消耗 I/O。

## 范围内

1. 下线全局 `Session 统计` 页面、tab 和无 sessionId 的 Session 扫描聚合。
2. 保留并明确隔离 `session_rollup` API/逻辑及 `SessionStatsChips`。
3. 修复 `/api/usage/calls` 本地日期范围到 UTC 分区的过滤与日分组。
4. 工作区筛选默认及重置值均为“全部”。
5. 新账本所有 token 展示复用 `lib/token-format.ts`，按 exact + M 规则呈现。
6. 来源/状态筛选复用 `SelectDropdown`；必要时扩展共享 toolbar 尺寸。
7. 移除 coverage banner、legacy 兼容 footer 和面向用户的损坏文件计数；底层诊断字段可保留。
8. 在现有 byDay 数据上保留“使用量 / 费用”指标切换，并增加可切换的按日“折线趋势 / 柱状占比”形态可视化；Usage 入口与 modal header 同时使用统一的折线统计语义图标。
9. 清理 `usage.statsSource` 选择语义和 recorder gate，更新 Settings/文档/测试。
10. UI 设计员 HTML 原型与用户审批。

## 范围外

- 删除或改写历史 Session JSONL、`usage-events/v1` 文件。
- 追溯重算历史费用或 token。
- 下线聊天顶栏 Session / Studio child 费用与上下文展示。
- 删除 session archive、Session 浏览或 Studio child audit 功能。
- 修改模型价格配置页。
- 不引入新的图表库；折线趋势仅复用现有 byDay 数据和 SVG/CSS，不改变 API shape。
- 删除 ledger API 的 `coverage` wire 字段；本次仅停止用户界面展示，避免不必要的 API 破坏。

## 功能需求与验收标准

### FR-1 单一全局账本入口

- 打开左侧 Usage 后直接显示调用账本，不出现 `Session 统计` tab 或切换入口。
- 页面不再请求无 `sessionId` 的 `/api/usage`。
- `GET /api/usage?sessionId=<id>` 继续返回 `session_rollup`；缺失 `sessionId` 时不执行全局扫描。
- `SessionStatsChips`、父 Session + Studio children rollup、child 自身展示口径保持不变。

### FR-2 日期筛选正确

- `from` / `to` 使用服务端本地日期语义：起始日 00:00:00.000 至结束日 23:59:59.999，均包含边界。
- UTC 分区可作为候选读取范围，但聚合前必须按 `event.occurredAt` 精确二次过滤。
- `byDay` 按同一本地日期语义分组；响应 `range.from/to` 与用户输入一致，`timezone` 反映实际口径，不再固定错误的 UTC 标签。
- `from > to`、非法日期和超过 366 日仍返回 400。
- 在 UTC+8 等非 UTC 时区选择单日时，不得混入相邻本地日事件。

### FR-3 默认“全部”

- 有 cwd 时首次打开仍选中“全部”。
- 点击“重置”后仍为“全部”。
- 用户可手动选择“当前”；无 cwd 时“当前”禁用。
- API 请求仅在用户主动选择“当前”时携带 `cwd`。

### FR-4 exact + M token 展示

- summary 总 Token、Token 拆分、provider/model token 列、图表/tooltip、详情 drawer 中所有 token 值使用共享 formatter。
- 主显示为完整千分位整数；同区域显示 `tokens / 1_000_000` 的 M 派生值，最多 6 位小数并去尾零。
- 紧凑图表位置可显示 compact/M，但必须在 tooltip 或辅助文本提供 exact。
- M 仅用于展示，不参与聚合、存储或费用计算。

### FR-5 统一筛选控件

- 来源和状态不再渲染原生 `<select>`，改用 `SelectDropdown`。
- 键盘 Enter/Space/Arrow/Escape/Tab、焦点恢复、disabled 状态沿用共享组件语义。
- 若新增 `size="toolbar"`，应是通用能力且不改变现有 compact/field 调用方视觉。

### FR-6 降噪与图标

- 页面不显示“覆盖率声明”、known gaps、legacy 兼容口径 footer 或损坏文件数量。
- coverage/corrupt/skipped 仍可保留在 API 与 server log 中供排障。
- 左侧 Usage 入口与账本 header 使用一致的折线统计语义图标，保留可访问 label/title。

### FR-7 配置和文档退役

- `usage.statsSource` 不再决定默认视图或 recorder 开关；账本采集始终启用。
- 旧配置字段不会导致 ledger 停写；读取旧配置不报错。
- Settings 的 `includeArchived` 文案只描述 Session rollup，不暗示全局账本扫描 Session。
- 模块/API/架构/操作文档不再推荐切回 legacy。

## 非功能要求

- 查询仍只读取日期范围覆盖的 UTC 分区，最多 366 日；不得退化为全账本扫描。
- 不引入新的运行时图表或下拉依赖；图表形态和指标切换均复用现有 byDay 数据。
- 不泄露 cwd、凭据、prompt/output；workspace 过滤仍使用 hash。
- 移动端筛选栏可换行，dropdown portal 不被 modal 裁剪。
- 历史文件 byte-for-byte 不变。

## 未决问题

1. 已确认保留现网“使用量 / 费用”指标切换，并增加“折线趋势 / 柱状占比”形态切换；默认折线 + 使用量，复用 byDay 数据。入口/header 同时使用折线统计语义图标。
2. 无 `sessionId` 的旧 `/api/usage` 应返回 400（推荐）还是 410？
3. 是否接受 `statsSource` 一版兼容忽略并在后续配置保存时移除（推荐）？
