# 改进计划审批书 — IMP-001（修订：最大合理全站替换）

## 审批结论请求

用户修订反馈（原话）：

> 其实是希望范围尽量大，然后能替换的都替换

**原推荐「能力-only + 0 示范接入」作废。**  
新计划：在 **opt-in 契约** 与 **安全黑名单** 下，对 `components/` 中可安全迁移的独立 stroke 图标 action 做 **最大合理替换**（约 +30 宿主，连同已有约 12 个共 ~40+）。

用户后续确认（2026-07-15）：

> 这题大体没啥问题；然后 chat 的那个 send 按钮原型图中获取焦点后整个按钮都变白了啥也看不到，能规避这个问题就没问题了。

**解释为有条件批准**：最大合理替换方案可实施；**硬门禁**为 Chat Send（及同类主操作图标按钮）在 `:focus-visible` / hover / active 时 **不得** 整钮漂白导致图标不可见，必须保留 base stroke 与对比度。

## 决策表

| # | 决策 | 建议 | 状态 |
| --- | --- | --- | --- |
| 1 | 能力形态 | `ActionFlowIcon` + 宿主无关 `data-icon-flow`；默认关闭；禁止全局 `button` 强制动画 | **用户有条件批准** |
| 2 | 交付深度 | **最大合理替换**：B0 迁移 + B1–B3 必做 + B4 尽量；不是 0 示范 | **用户有条件批准** |
| 3 | 流动载体 | 仅图标 SVG 线条（base+overlay dash）；边框/背景静态 | **用户有条件批准** |
| 4 | 模式 | 新入口默认 `interactive`；`ambient` 仅侧栏 utility | **用户有条件批准** |
| 5 | 黑名单 | 危险/关闭/行内密集/分段内部/统计 chip/spin 刷新/实心 Stop 等不换 | **用户有条件批准** |
| 6 | chrome | 不强制 `FlowIconButton` / 不强制全 pill；可只换图标+attr | **用户有条件批准** |
| 7 | **Send 焦点可见性** | focus/hover/active **禁止**整钮漂白；图标 `currentColor` 与背景保持对比；focus ring 用 outline/ring，不靠白底盖图标 | **用户硬要求，必须规避** |
| 8 | 主题 pressed polish | 可选：theme 仅 hover/focus 流动 | 可选 |

## 范围规模（规划）

| 批次 | 内容 | 规模 |
| --- | --- | --- |
| B0 | AppShell 顶栏/侧栏 + Branches | ~12（已有，契约迁移） |
| B1 | ChatInput、BrowserShare、MessageView | ~12–15（含 Send 焦点对比度硬门禁） |
| B2 | SessionSidebar 工具条、AppShell 空间刷新 | ~5 |
| B3 | FileViewer、Usage*、ModelsConfig 工具条、SkillsConfig | ~10–15 |
| B4 | Terminal 等非危险工具条 | 尽量 |
| 黑名单 | 会话行 Delete 等 | 明确不换 |

详见 [PRD 清单](prd.md)。

## 方案摘要

### PRD / Design

- CSS 先解耦，再 helper，再按区域批量替换。
- 实现 DAG：`IMP-A → IMP-B → IMP-C → IMP-D → IMP-E → DOC-A`（见 [implement.md](implement.md)）。
- Checks 以白名单完成度 + 黑名单零误接入 + **Send/主操作 focus 图标可读** 为门禁。

### UI 原型

- [icon-flow-opt-in-prototype.html](icon-flow-opt-in-prototype.html)  
  实现时须修正原型/生产中 Send focus 漂白问题（outline/ring + 保持图标色，禁止整钮 `background: white` + 浅色图标）。

### 非目标提醒

- 不是无脑 CSS 扫射所有 button。  
- 不是边框流动。  
- 不是改业务 API。

## 相关材料

- [Brief](brief.md)
- [PRD](prd.md)
- [UI](ui.md)
- [HTML 原型 · 多区域黑白名单](icon-flow-opt-in-prototype.html)
- [Design](design.md)
- [Implement](implement.md)
- [Checks](checks.md)

## 用户批准记录

- 输入摘要：大体 OK；Send focus 整钮变白不可见必须规避。
- 主会话将据此 `record_improvement_approval` 后进入 `implementing`。
