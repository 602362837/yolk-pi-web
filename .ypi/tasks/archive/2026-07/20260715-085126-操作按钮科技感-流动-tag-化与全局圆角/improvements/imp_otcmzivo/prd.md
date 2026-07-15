# PRD — IMP-001 最大合理全站图标线条流动替换

## 目标与背景

主任务已交付侧栏/顶栏 action tag + 图标线条流动。用户反馈要把「指上去图标线条流动」做成可复用能力，并进一步要求：

> 范围尽量大，然后能替换的都替换

原「能力-only + 0～1 示范」作废。本改进在 **opt-in 契约** 与 **安全黑名单** 下，把 `components/` 中可安全迁移的独立 action 图标尽量替换为 `ActionFlowIcon` + `data-icon-flow`。

## 用户价值

- 高频工具条与面板入口形成统一科技感，而不是只有顶栏在动。
- 仍可预测：列表行、危险操作、关闭钮不会到处闪动。
- 后续新 action 有明确接入/禁止规则。

## 范围内

1. **能力层**
   - 保留 `ActionFlowIcon` 为唯一 stroke-flow SVG primitive。
   - CSS motion 从「仅 `.tech-action-tag`」解耦为宿主无关 `[data-icon-flow]`，且必须命中后代 `.action-flow-icon__overlay`。
   - `interactive` / `ambient` / `off` 语义不变；无 attr = 不流动。
   - 可选薄 helper：`iconFlowAttrs(mode)`。
2. **最大合理替换（白名单执行）**
   - 扫描并替换下文「应替换清单」中的入口。
   - 不要求统一 pill chrome；允许保留原按钮外形，只换图标与 opt-in attr。
3. **黑名单硬排除**（见下表，实现与检查强制）。
4. **a11y / reduced-motion / disabled / SSR id** 与主任务一致。
5. **文档**：`docs/modules/frontend.md` 写清接入三步与黑白名单。
6. **HTML 原型**：多区域示范 + 黑白名单图例（本改进交付）。

## 范围外

- `button { … animation … }` 或未带 `data-icon-flow` 的全局强制。
- 边框/背景扫光、动画库、JS 计时器、WebGL、新主题配置。
- 危险/删除/解绑/拒绝、关闭 X、分段内部格、统计 chip 主体、树/表/会话行内操作、已有 CSS spin 的刷新、纯 fill 实心图标、外部图片/字体图标。
- 改变点击业务、面板、API、session、SSE。

## 契约原则（不可破）

1. 流动只在 **图标可见 stroke/path**（base + overlay dash），不是边框。
2. **Opt-in only**：宿主显式 `data-icon-flow` + `ActionFlowIcon`。
3. 新替换默认 **`interactive`**（hover / focus-visible / active-open）；`ambient` 仅 `.sidebar-utility-actions`。
4. `disabled` / `data-icon-flow="off"` / `prefers-reduced-motion` → 隐藏 overlay，base 可读。
5. gradient id per-instance（`useId` 清洗）；overlay `pointer-events: none`、SVG `aria-hidden`。

## 应替换清单（白名单 · 最大合理）

> 计数为规划扫描约数；实现员以代码为准，**能安全替换则替换**，发现新的同类独立 action 可并入同批，但不得突破黑名单。

### B0 · 已接入（仅契约迁移，行为等价）

| 文件 | 入口 |
| --- | --- |
| `AppShell.tsx` | Models / Usage / Skills / Settings（ambient）；sidebar toggle、theme、Export、System、Subagents、Git、Terminal（interactive） |
| `BranchNavigator.tsx` | Branches inline trigger（interactive）；非 inline header 仅共享图标几何、不强制顶栏 tag |

### B1 · Chat 输入与分享工具条

| 文件 | 入口 | 模式 |
| --- | --- | --- |
| `BrowserShareControl.tsx` | 绑定/状态 pill（monitor stroke SVG） | interactive；loading 时 `off` |
| `ChatInput.tsx` | Attach image、Attach file | interactive |
| `ChatInput.tsx` | Compact（非 compacting 的 stroke 图标态） | interactive；compacting 实心方块保持静态 |
| `ChatInput.tsx` | 自动吸底 toggle、完成提示音 toggle | interactive |
| `ChatInput.tsx` | Send、Steer、Follow-up 的 stroke 箭头图标 | interactive（disabled 时 off） |
| `MessageView.tsx` | Copy message、Edit from here（及对等 hover 图标 action） | interactive |

### B2 · 侧栏工作区工具条（非会话行）

| 文件 | 入口 | 模式 |
| --- | --- | --- |
| `SessionSidebar.tsx` | 新建会话、创建 Git 工作树、刷新（非完成勾）、Workspace actions | interactive |
| `AppShell.tsx` | 项目空间信息折叠旁「刷新项目空间信息」（非完成勾） | interactive |

### B3 · 文件 / Usage / Models / Skills 面板工具条

| 文件 | 入口 | 模式 |
| --- | --- | --- |
| `FileViewer.tsx` | Add to chat（工具条级，非行内破坏） | interactive |
| `ChatGptUsagePanel.tsx` | Refresh active account usage | interactive；若存在 spin 态则 spin 期间 off 或跳过叠加 |
| `UsageStatsModal.tsx` | Refresh | interactive |
| `UsageProviderModelTable.tsx` | 刷新 | interactive |
| `ModelsConfig.tsx` | 面板级 Refresh usage / Refresh accounts / Refresh balance / Test model connection 等 **工具条** stroke 图标 | interactive |
| `ModelsConfig.tsx` | 账户工具条：Show/Hide key、Copy API key（非 Disable/Delete 行） | interactive（若视觉过密可在实现中保留，checks 允许抽样） |
| `SkillsConfig.tsx` | Add skill（工具条 + 号 stroke） | interactive |

### B4 · 可选扩大（批准后尽量做；遇阻可记 handoff 偏差）

| 文件 | 入口 | 说明 |
| --- | --- | --- |
| `TerminalPanel.tsx` | New local terminal、Open SSH、Maximize/fullscreen 等 **非关闭** 工具条图标 | interactive；关闭/结束进程黑名单 |
| `YpiStudioWaitPanel.tsx` / `YpiStudioSubagentTranscript.tsx` | 独立工具条 stroke 图标（若存在且非行内） | interactive |
| 主题 toggle pressed 持续 flow | `AppShell` theme | 可选 polish：pressed 只改表面，flow 仅 hover/focus |

**合计目标：在 B0 迁移基础上新增约 30+ 宿主；全仓独立 stroke action 白名单尽量清空。**

## 明确不替换（黑名单）

| 类别 | 示例 |
| --- | --- |
| 危险 / 破坏性 | Delete、Archive（会话行）、解绑 Browser Share、拒绝命令、Stop Agent（实心方块）、停止压缩实心态 |
| 关闭 / 移除碎片 | TabBar Close、各 Modal Close、附件缩略图 remove X、Terminal Close tab / 关闭终端并结束进程 |
| 密集列表 / 树 / 表行 | `SessionSidebar` 会话行 Rename/Delete/Expand forks、文件树行、模型账户 Disable 行、表格行操作 |
| 表单装饰 / 分段 | `SelectDropdown` 触发器 chevron（纯装饰）、分段内部格、Checkbox |
| 统计 chip 主体 | `SessionStatsChips` 触发器本身 |
| 双动画 / spin | `GitPanel` Refresh（已有 spin） |
| 不可控几何 | `FileIcons` 文件类型图、外部图片、字体图标、纯 fill 装饰 |
| 拖拽 / 分隔 | resize handle、SessionChanges 拖拽浮层（无合适 stroke action 则跳过） |

## 需求

### R1 Opt-in 默认关闭

- 未声明 `data-icon-flow`：即使内部误放 `ActionFlowIcon`，overlay 也不得持续流动。
- 禁止全 button 强制 animation 选择器。

### R2 宿主无关 motion

- `interactive` / `ambient` / `off` 规则不依赖 `.tech-action-tag`。
- ambient 错峰 CSS 仍限定 `.sidebar-utility-actions`。

### R3 最大合理替换完成度

- 白名单 B1–B3 **必须**完成（文件存在且几何可迁时）。
- B4 尽量完成；无法完成须在 handoff 写明原因（非产品范围回退）。
- 黑名单 **零** 误接入（检查 blocker）。

### R4 行为不变

- 所有 `onClick`、disabled、aria、panel、dropdown 锚点、badge 逻辑不变。
- 仅视觉：SVG → `ActionFlowIcon` + attr；可删冲突的内联 hover 改色（若与 CSS 争用）。

### R5 a11y / theme / SSR

- 与主任务 R5 相同：base fallback、reduced-motion、focus-visible、per-instance gradient id。

### R6 验收

- lint + tsc；静态搜索无全 button flow；抽样浏览器：白名单 hover 流动、黑名单静止、侧栏 ambient、reduced-motion。

## 验收标准（用户可感知）

1. Chat 底栏附件/Browser Share/Send/Steer 等：hover 时图标线条流动。
2. 侧栏新建/工作树/刷新/Workspace：hover 流动；会话行 Delete 等仍静止。
3. Usage/Models 等面板工具条 Refresh：hover 流动；Close/Delete 静止。
4. 顶栏/侧栏原入口不回归；边框不流动。
5. reduced-motion 与 disabled 全静。

## 决策状态（待用户批准）

1. **待批**：宿主无关 opt-in + 禁止全局扫射。
2. **待批**：**最大合理替换**（B0–B3 必做，B4 尽量），作废 0 示范。
3. **待批**：黑名单如上，不可为了“范围大”而突破。
4. **待批**：不强制新 `FlowIconButton` chrome；薄 helper 可选但推荐。
