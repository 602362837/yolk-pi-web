# Checks

## 审批门禁

- [ ] `ui-designer` 已产出 task-local HTML 原型，不是纯 Markdown。
- [ ] 原型覆盖单一账本、全部默认、统一 dropdown、exact+M、降噪、双切换图表与折线 Usage 图标、桌面/窄屏。
- [ ] 用户已明确“折线图”包含账本内真实趋势可视化与入口/header 语义图标，并批准修订后的 HTML 原型。
- [ ] `plan-review.md` 已补充原型链接与审批记录。
- [ ] 在以上条件满足前不得实现或进入 `awaiting_approval`。

## 需求覆盖

- [ ] Usage 打开后没有 `Session 统计` 文案、tab 或 legacy 页面请求。
- [ ] 有 cwd 时首次打开和重置都为“全部”；仅手动选择“当前”才发送 cwd。
- [ ] source/status 均使用共享 `SelectDropdown`，组件内无原生 `<select>`。
- [ ] summary、Token 拆分、provider/model、chart tooltip、drawer 的 token 遵循 exact + M / compact+exact 规则。
- [ ] 页面无 coverage banner、known gaps、legacy footer、损坏文件数。
- [ ] 默认可见的按日“使用量”折线趋势图使用现有 byDay 数据；支持“折线/柱状”形态切换和“使用量/费用”指标切换，二者组合均可用，点位/柱段 hover/focus 与当前指标一致（使用量 exact+M，费用 `$x.xx`，可附带另一指标）。
- [ ] sidebar/header Usage 图标与批准原型一致。
- [ ] `SessionStatsChips` 的 parent/standalone/studio_child 口径不变。

## API / 日期正确性

- [ ] 单日本地范围只包含该日 00:00:00.000—23:59:59.999 的事件。
- [ ] 正好位于 from start / to end 的事件被包含，边界外 1ms 的事件被排除。
- [ ] UTC+8（至少一个非 UTC 时区）跨 UTC 分区 fixture 不混入相邻本地日。
- [ ] `byDay` 和响应 range 使用同一日期/时区语义。
- [ ] query cache key 区分完整时间边界和过滤条件。
- [ ] 366 日上限、非法日期、from > to 返回 400。
- [ ] `/api/usage` 无 sessionId 不扫描 session；按批准策略返回 400/410。
- [ ] `/api/usage?sessionId=` 仍返回完整 `session_rollup` 契约。

## 配置 / 兼容

- [ ] 旧 `usage.statsSource: "legacy"` 不会关闭 ledger recorder。
- [ ] 读取旧配置不报错；按批准策略在下一次保存时移除或忽略退休字段。
- [ ] `includeArchived` 继续影响 session rollup，Settings 文案不再声称控制 ledger。
- [ ] 历史 Session JSONL 和 usage event 文件未被修改、迁移或删除。
- [ ] API `coverage` wire 字段若保留，类型和旧调用方仍兼容，但 UI 不渲染。

## 自动验证

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:llm-usage-store
npm run test:usage-rollup
# 实现时新增并运行：
npm run test:llm-usage-query
```

`test:llm-usage-query` 至少覆盖 event-level range filter、时区分区边界、local byDay/range、cache key 隔离和所有筛选组合中的一个交叉用例。

## 静态回归搜索

```bash
rg -n 'Session 统计|resolveDefaultUsageView|statsSource|Coverage banner|覆盖率声明|兼容提示' components app lib docs AGENTS.md
rg -n '<select' components/UsageProviderModelTable.tsx
rg -n 'getUsageStats\(' --glob '!node_modules/**' .
```

预期仅允许明确的迁移/历史注释，不应有活跃 legacy UI 或 global aggregator 调用。

## 手工验收

1. 有当前项目时打开 Usage：默认“全部”，请求 URL 无 cwd；切到“当前”后才有 cwd；重置回全部。
2. 选择一个已知有数据和一个无数据的日期范围，观察 summary/byDay/table 同步变化。
3. 展开 source/status dropdown，用键盘选择、Esc 关闭、Tab 移出；modal 滚动/窄屏时 portal 不裁剪。
4. 对照 API 原始数值检查 exact/M，复制/tooltip 可见 exact。
5. 打开 parent、standalone、studio child chat，确认顶栏费用和上下文 popover 不回归。
6. 打开 archived Session（includeArchived 开/关各一次）验证既有 rollup 行为。
7. 查看浏览器 console/server log，无 hydration、重复 fetch、路径泄露或 recorder disable 异常。

## 重点风险

- 本地日期与 UTC partition 再次混淆。
- 删除 global Session 聚合时误删顶栏 rollup helper/type。
- 表格 exact+M 导致窄屏拥挤。
- 共享 dropdown 新 size 影响既有调用方。
- 图表双切换（形态与指标）在窄屏下拥挤或 tooltip 口径漂移。
