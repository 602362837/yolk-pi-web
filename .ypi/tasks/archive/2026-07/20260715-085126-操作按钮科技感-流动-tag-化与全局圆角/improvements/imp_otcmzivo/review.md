# review — IMP-001（imp_otcmzivo）CHK-A

**检查员：** 检查员（checker）  
**子任务：** CHK-A  
**对照：** `checks.md` / `prd.md` / `design.md` / `plan-review.md` / `handoff.md`  
**结论：** **pass_with_notes**（无 blocker）

---

## 范围与证据边界

- 独立审查本改进生产 diff + 文档 + 静态搜索 + lint/tsc。
- **未**启动 dev server 做浏览器目视 hover/focus（与 handoff 一致）；Send 硬门禁以生产 CSS/类名契约静态验收，live 交主会话 UAT 补一眼。
- 未 git commit / push；未改生产代码（本检查 run 仅写本 `review.md`）。

---

## 需求覆盖（checks 清单）

| 项 | 结果 | 证据 |
| --- | --- | --- |
| CSS 宿主无关 `[data-icon-flow]`，不依赖必须 `.tech-action-tag` | **Pass** | `app/globals.css` ~2864–2887：`[data-icon-flow="interactive|ambient"] … .action-flow-icon__overlay` |
| 未设置 attr 的控件无持续流动 | **Pass** | 默认 `.action-flow-icon__overlay { opacity: 0 }`；动画仅在 attr 选择器下打开 |
| 无全局 `button` 强制 animation / 边框扫光回潮 | **Pass** | `rg` 全 button flow 规则 **0 命中**；`action-icon-flow` 仅绑 overlay |
| B0 顶栏/侧栏/Branches 等价迁移 | **Pass** | `AppShell` ambient 侧栏四入口 + interactive 顶栏；`BranchNavigator` inline `interactive`；非 inline 仅 `ActionFlowIcon` 无 attr（静止） |
| B1 Chat / Browser Share / Message | **Pass** | `ChatInput`、`BrowserShareControl`、`MessageView` 均有 `iconFlowAttrs` + `ActionFlowIcon` |
| B2 侧栏工具条；会话行未接入 | **Pass** | `SessionSidebar` 仅 4 处 toolbar `iconFlowAttrs`（新建/工作树/刷新/Workspace）；行内 Delete/Rename/Archive **无** flow |
| B3 面板工具条；Close/Delete/Disable 行未接入 | **Pass** | FileViewer / Usage* / ModelsConfig / SkillsConfig 工具条已挂；Models 账户 Delete/Disable 为文本按钮，无 `data-icon-flow` |
| B4 尽量或 handoff 偏差 | **Pass** | `TerminalPanel` Collapse/New/SSH/Maximize → interactive；Close dock 静态+blacklist 注释；YpiStudio 面板 handoff 记跳过 |
| 黑名单抽样静止 | **Pass** | 见下节 |
| `off` / disabled / reduced-motion | **Pass** | globals off/disabled/`.is-disabled` + `@media (prefers-reduced-motion: reduce)` 强制 `opacity:0; animation:none` |
| 文档接入步骤与黑白名单 | **Pass** | `docs/modules/frontend.md` opt-in 三步、模式表、白/黑名单、Send 门禁、回滚 |
| 无 API/session/SSE 改动 | **Pass** | `git status` 仅 `components/*`、`app/globals.css`、`docs/modules/frontend.md` + 任务目录；无 `app/api/**` / `lib/**` |

---

## 白名单完成度（B0–B4）

含 `data-icon-flow` / `iconFlowAttrs` 的组件文件：

`AppShell` · `BranchNavigator` · `BrowserShareControl` · `ChatInput` · `MessageView` · `SessionSidebar` · `FileViewer` · `ChatGptUsagePanel` · `UsageStatsModal` · `UsageProviderModelTable` · `ModelsConfig` · `SkillsConfig` · `TerminalPanel`

`iconFlowAttrs(` 调用约 **45** 处（含条件 `off`），与 handoff 一致；覆盖 PRD B0–B3 必做集，B4 Terminal 已做。

Helper / primitive：

- `components/iconFlow.ts` — 纯 `IconFlowMode` + `iconFlowAttrs`
- `components/ActionFlowIcon.tsx` — 注释明确须宿主 `data-icon-flow`；alone 不动画

---

## 黑名单零误接入（静态）

| 抽样 | 结果 |
| --- | --- |
| `GitPanel` Refresh（spin） | **无** `ActionFlowIcon` / `data-icon-flow`；仍用内联 spin SVG |
| `SessionStatsChips` | **无** flow 命中 |
| Browser Share「解绑当前浏览器分享」 | 无 `iconFlowAttrs`（仅绑定 pill 有） |
| Terminal Close dock / Close tab | dock 关闭无 flow + 注释 blacklist；tab close 无 flow |
| Chat Stop Agent | 实心 `fill` rect，**未**包 `ActionFlowIcon` |
| Compact compacting 态 | 实心方块静态；idle stroke 才 flow |
| 附件 remove X | 普通 SVG，无 flow |
| Session 行 Rename/Delete/Archive | `SessionSidebar` flow 仅工具条行 |
| Models Disable/Delete 账户 | 文本/确认流，无 `data-icon-flow` |

---

## Send / 主操作 focus 硬门禁（用户）

**静态判定：Pass（无漂白路径）**

生产契约：

1. Send 按钮：`chat-input-primary-action chat-input-primary-action--send` + `ActionFlowIcon` + `iconFlowAttrs(… interactive|off)`（`ChatInput.tsx`）。
2. CSS（`app/globals.css`）：
   - hover / focus-visible / active：**`background: var(--accent) !important` + `color: #fff !important`** — **不是**白底。
   - focus-visible：accent 系 **box-shadow ring**；`outline: none` 于 send 专用规则，通用 primary 仍有 outline 兜底。
   - Send 上 `--icon-flow-a/b/c` 改为 pale cyan/indigo/violet，保证 **accent 底 + 白字/白 base + 浅色 overlay** 可读。
3. Steer / Follow-up：`focus-visible` 用 `outline: 2px solid currentColor`，无整钮漂白。
4. 内联 style 默认已是 accent 底 + `#fff` 字色；CSS `!important` 锁住 focus/hover 不回退成浅底浅图标。

**残留：** 本检查 run **未**键盘 focus-visible 实机目视深/浅主题；建议主会话 UAT 各点一次。代码层无「白底盖白图标」实现。

---

## 契约与 a11y

- Opt-in only；禁止全局 button animation — **满足**。
- ambient 错峰仍限 `.sidebar-utility-actions > [data-icon-flow="ambient"]:nth-child(n)` — **满足**；顶栏为 interactive，未见 ambient 泄漏到默认表单。
- `aria-pressed` alone **不**持续 flow（globals 注释 + 选择器仅 `.is-active` / `[aria-expanded="true"]`）— 符合可选 theme polish。
- reduced-motion / off / disabled 隐藏 overlay — **满足**。
- 未引入 `FlowIconButton` — **满足**。

---

## 自动验证

| 命令 | 结果 |
| --- | --- |
| `npm run lint` | **0 errors**；6 warnings 均在无关 archive/scripts 测试文件，非本改进 |
| `node_modules/.bin/tsc --noEmit` | **exit 0** |
| `rg data-icon-flow\|ActionFlowIcon\|iconFlowAttrs` | 命中 B0–B4 目标 + docs + helper |
| `rg action-icon-flow` in globals | 仅 keyframes + 三条 attr 选择器 |
| 全 button flow 强制规则 | **0 命中** |
| 黑名单文件 GitPanel / SessionStatsChips | 无 flow |

---

## Findings Fixed

None（检查员本 run 未改生产代码；实现已覆盖计划与 Send 门禁，无需低风险补丁）。

---

## Remaining Findings

### Blocker

None。

### Non-blocking / notes

1. **Live 浏览器 UAT 未在本改进实现/检查 run 执行**  
   白名单 hover 流动、侧栏 ambient 错峰、会话行静止、reduced-motion、Send focus 深浅主题 — 建议主会话用户验收时按 `checks.md` 浏览器清单快速点验。  
   **不构成代码 blocker**（静态契约完整，handoff 已诚实声明）。

2. **B4 偏差（已文档化）**  
   `YpiStudioWaitPanel` / `YpiStudioSubagentTranscript` 未接入；handoff 说明无可迁独立 stroke 工具条。可接受，不回退 B1–B3。

3. **ModelsConfig 账户工具条 Show/Hide key、Copy key**  
   挂在账户行工具区（非 Disable/Delete）。符合 PRD「账户工具条可 interactive」；密度可接受，无需返工。

4. **后续维护风险（文档已写黑名单）**  
   新人若误读「全部 icon button 都加」可能突破黑名单 — `frontend.md` 已明确禁止；非本 diff 缺陷。

---

## Verdict

### **pass_with_notes**

**原因：**

- 最大合理白名单替换（B0–B3 必做 + B4 Terminal）与 opt-in 宿主无关 CSS 已落地，黑名单静态零误接入。
- 用户硬门禁「Send focus 不得整钮漂白」在生产 CSS 中有明确 accent 底 + 白字 + ring + pale flow token，无白底漂白路径。
- lint/tsc 干净；无 API/session 改动；文档与代码一致。
- 唯一实质残留是 **未做 live 目视 UAT** → notes，非 blocker。主会话可 `mark CHK-A done` 并进入 `waiting_user_acceptance`；用户验收时补 Send focus / 抽样 hover 即可。

---

## 主会话下一步

1. Mark **CHK-A** done。  
2. 改进状态 → **waiting_user_acceptance**（无 blocker）。  
3. 用户验收重点：Chat Send `:focus-visible` 图标可见；会话行 Delete 静止；顶栏/侧栏无回归。  
4. 不要 git commit（本检查员未提交）。
