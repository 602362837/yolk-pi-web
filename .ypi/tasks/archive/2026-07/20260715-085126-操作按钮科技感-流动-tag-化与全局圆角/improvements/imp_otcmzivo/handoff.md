# Handoff — IMP-001（imp_otcmzivo）最大合理图标线条流动替换

## 结论

实现 DAG **IMP-A → IMP-E + DOC-A** 已在代码中落地：宿主无关 `data-icon-flow` opt-in、`iconFlowAttrs` helper、B0–B3 白名单批量替换、B4 Terminal 非危险工具条替换、Chat Send 焦点对比度硬门禁 CSS、frontend 文档。

本文件为 **DOC-A** 产出；对照仓库现状，不夸大未跑浏览器证据。

## 批次完成清单（对照代码）

### IMP-A · CSS 解耦

| 文件 | 结果 |
| --- | --- |
| `app/globals.css` | Host-agnostic `[data-icon-flow="interactive"|"ambient"|"off"]` + 后代 `.action-flow-icon__overlay`；ambient 错峰限定 `.sidebar-utility-actions`；`off`/`:disabled`/`.is-disabled`/`prefers-reduced-motion` 隐藏 overlay；注释明确禁止全局 button 动画。 |
| 同上 · Send 硬门禁 | `.chat-input-primary-action--send` hover/focus/active 保持 **accent 底 + 白字/白图标** + ring/box-shadow；Send 上覆盖 pale `--icon-flow-a/b/c`；**非**整钮漂白。Steer/follow-up focus-visible 用 outline。 |

静态抽查：`action-icon-flow` 仅绑在 `[data-icon-flow=…] … .action-flow-icon__overlay`；未见 `button { … animation … }` 强制 flow。

### IMP-B · helper + B0

| 文件 | 结果 |
| --- | --- |
| `components/iconFlow.ts` | `IconFlowMode` + `iconFlowAttrs(mode)` 纯 helper。 |
| `components/ActionFlowIcon.tsx` | 注释写明必须宿主 `data-icon-flow`；alone 不动画。 |
| `components/AppShell.tsx` | 侧栏 Models/Usage/Skills/Settings → `ambient`（disabled→`off`）；顶栏 sidebar/theme/Export/System/Subagents/Git/Terminal 等 → `interactive`；explorer 刷新 → `interactive`（完成勾态 `off`）。Theme：`aria-pressed` 不单独持续 flow（CSS 仅 hover/focus + active-open via expanded/is-active）。 |
| `components/BranchNavigator.tsx` | Inline trigger → `interactive` + `ActionFlowIcon`。 |

### IMP-C · B1 Chat / Browser Share / Message

| 文件 | 结果 |
| --- | --- |
| `components/BrowserShareControl.tsx` | 绑定/状态 pill → `interactive`（`!canUse \|\| loading` → `off`）。**解绑**按钮无 `data-icon-flow`（黑名单）。 |
| `components/ChatInput.tsx` | Attach image/file、Send/Steer/Follow-up stroke、Compact idle stroke、auto-scroll/sound toggles → `interactive`；streaming/upload/compacting 等 → `off` 或 fill 实心态不包 flow。 |
| `components/MessageView.tsx` | Copy / Edit / Fork-style 等消息级 action → `interactive`（forking → `off`）。 |

### IMP-D · B2+B3 侧栏与面板工具条

| 文件 | 结果 |
| --- | --- |
| `components/SessionSidebar.tsx` | 新建会话、创建 worktree、刷新、Workspace menu → `interactive`（disabled/完成态 `off`）。会话行 Rename/Delete/Expand **无** flow。 |
| `components/AppShell.tsx` | 项目空间信息刷新（非完成勾）→ `interactive`。 |
| `components/FileViewer.tsx` | Add to chat 工具条级（多处同类入口）→ `interactive`。 |
| `components/ChatGptUsagePanel.tsx` | Refresh active account usage → `interactive`（refreshing/resetting → `off`）。 |
| `components/UsageStatsModal.tsx` | Refresh → `interactive`（loading → `off`）。 |
| `components/UsageProviderModelTable.tsx` | 刷新 → `interactive`（loading → `off`）。 |
| `components/ModelsConfig.tsx` | 工具条级 Refresh usage/accounts/balance、Test connection、Show/Hide key、Copy key → `interactive`；busy/revealing/copied → `off`。账户 Disable/Delete **未**接入（静态抽查仅上述 toolbar 入口）。 |
| `components/SkillsConfig.tsx` | Add skill 工具条 → `interactive`。 |

### IMP-E · B4

| 文件 | 结果 |
| --- | --- |
| `components/TerminalPanel.tsx` | Collapse、New local、Open SSH、Maximize → `interactive`。Close tab / 关闭终端并结束进程 **静态**（注释标明 blacklist）。 |
| Theme polish | CSS：`aria-pressed`  alone 不持续 flow（见 IMP-A）。 |
| `YpiStudioWaitPanel` / `YpiStudioSubagentTranscript` | **未**接入 flow（无独立 stroke 工具条迁入；按 B4「尽量」记偏差，不回退 B1–B3）。 |

### DOC-A

| 文件 | 结果 |
| --- | --- |
| `docs/modules/frontend.md` | 写入三步 opt-in、`iconFlow.ts` 表项、模式表、白名单批次、黑名单、Send 硬门禁、ambient 限制、反模式、回滚。 |
| 本 `handoff.md` | 各批文件、跳过项、验证与证据边界。 |

## 宿主计数（代码 `iconFlowAttrs(` 出现次数，约）

| 文件 | 次数 |
| --- | --- |
| AppShell | 9 |
| ChatInput | 8 |
| ModelsConfig | 6 |
| MessageView | 4 |
| SessionSidebar | 4 |
| FileViewer | 4 |
| TerminalPanel | 4 |
| BranchNavigator | 1 |
| BrowserShareControl | 1 |
| ChatGptUsagePanel | 1 |
| UsageStatsModal | 1 |
| UsageProviderModelTable | 1 |
| SkillsConfig | 1 |
| **合计** | **~45 call sites**（含 disabled 条件 `off`；非唯一视觉宿主数） |

含 `data-icon-flow` / `ActionFlowIcon` 的组件文件覆盖 PRD B0–B3 目标集；`GitPanel` / `SessionStatsChips` **无** flow 接入。

## 明确跳过 / 偏差

1. **YPI Studio wait/subagent 面板工具条** — 未发现需迁的独立 stroke toolbar；未改。  
2. **ModelsConfig 账户行 Disable/Delete** — 黑名单，未接入。  
3. **GitPanel Refresh** — spin 黑名单，未叠加 flow。  
4. **会话行 / Modal Close / Stop fill / 附件 remove X** — 黑名单，静态抽查无 `iconFlowAttrs`。  
5. **不强制** `.tech-action-tag` pill：多数面板/底栏仅 attr + `ActionFlowIcon`。  
6. **浏览器人工 UAT** — 本 DOC-A 实现员 **未**在本 run 启动 dev server 做 hover/focus 目视；依赖代码审查 + 静态搜索。Send 对比度以 CSS 规则为准，**live focus 仍建议检查员/主会话目视一次**。

## 验证

| 命令 / 检查 | 结果（DOC-A 时点） |
| --- | --- |
| 静态：`rg data-icon-flow\|ActionFlowIcon\|iconFlowAttrs` on `components` / `globals` / `frontend.md` | 命中 B0–B4 目标文件 + 文档 + helper |
| 静态：无全局 `button` flow animation 规则 | 未见命中 |
| 黑名单文件抽查 GitPanel / SessionStatsChips | 无 `data-icon-flow` |
| Browser Share 解绑 | 无 `iconFlowAttrs` |
| Terminal close dock | 无 flow，注释 blacklist |
| `npm run lint` | **本 DOC-A 子任务未重跑**（文档-only 改动；实现批声称过 lint/tsc，检查员应全量复跑） |
| `tsc --noEmit` | **本 DOC-A 未重跑** |
| 浏览器白名单 hover / 黑名单静止 / reduced-motion / Send focus | **未在本 run 执行** |

## Send focus 规避说明（用户硬门禁）

生产路径（非原型白底）：

- 类名：`chat-input-primary-action chat-input-primary-action--send`
- hover / focus-visible / active：**`background: var(--accent)` + `color: #fff`**（强制保持对比），非白底。
- focus-visible：accent 系 `box-shadow` ring；非靠漂白背景。
- 流动叠加：Send 上 pale cyan/indigo/violet stops，避免白底 + 浅色图标「啥也看不到」。

检查员应用键盘 focus-visible 与 hover 各验一次深浅主题。

## 回滚

见 `docs/modules/frontend.md` Rollback：按宿主文件回退 SVG/attr → 收窄 globals → 可选删除 `iconFlow.ts`；无数据迁移。

## 风险 / 给检查员

1. **Live UAT 未在本 handoff 跑完** — 以 checks.md 浏览器清单为准；尤其 Send focus、侧栏 ambient、会话行静止。  
2. ModelsConfig 体积大 — 已限 toolbar；复查 Disable 行。  
3. FileViewer 多处 Add-to-chat 均挂了 flow — 确认均为工具条级而非树行破坏。  
4. 文档已写黑名单；避免后续「全部 icon button 都加」误读。  
5. 主会话下一步：`DOC-A` mark done → **checking**；不要在未查 live 的情况下把浏览器证据写成已通过。

## 主会话决策

- 无产品范围回退请求。  
- 可选：检查员若认为 YpiStudio 面板后续有独立 stroke 工具条，可开 follow-up，不阻塞本改进验收。  
- 实现员未 commit / push / 未 transition 改进状态。
