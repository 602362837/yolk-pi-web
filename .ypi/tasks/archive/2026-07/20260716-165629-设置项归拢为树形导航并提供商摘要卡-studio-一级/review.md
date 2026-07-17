# review：设置项归拢为树形导航并提供商摘要卡（Studio 一级）

**检查员：** checker  
**任务状态建议：** `ready`（可进入 ready；**不要**直接进 `user_acceptance`）  
**Verdict：** **Pass**（含 1 项检查员已修低风险问题；浏览器矩阵未在本环境全量手测，记为非阻塞 residual risk）

## 审查范围

- 对照材料：`prd.md` / `design.md` / `implement.md` / `ui.md` / `plan-review.md` / `checks.md` / `handoff.md` / HTML 原型 `settings-tree-provider-hub-prototype.html`
- 生产改动：
  - `components/SettingsTreeNavigation.tsx`（新增 + 检查员小修）
  - `components/SettingsProviderHub.tsx`（新增）
  - `components/SettingsConfig.tsx`（集成）
  - `app/globals.css`（树/Hub/≤640/a11y）
  - `docs/modules/frontend.md`（模块登记）
- 未改：`lib/pi-web-config.ts`、`/api/web-config`、provider quota/account API、`AppShell` 深链 props 契约

## Findings Fixed

1. **Space 在树容器上 `preventDefault` 会阻断原生 button 激活**  
   - 位置：`components/SettingsTreeNavigation.tsx` `handleTreeKeyDown`  
   - 问题：`role="tree"` 容器监听 `keydown`，对 Space 调用 `preventDefault()`。焦点在 treeitem button 上时事件会冒泡到容器；浏览器默认 Space 激活依赖未被取消的 keydown，导致 Enter 可用、Space 可能失效（违反 R7 / checks 键盘项）。  
   - 修复：保留 Enter/Space case 注释说明，**不再** `preventDefault` Space；交由原生 button 激活。  
   - 风险：低；不改 IA/API/状态。

## Remaining Findings

### 阻塞

None。

### 非阻塞 / residual

1. **浏览器人工矩阵未在本检查会话全量执行**  
   实现员 handoff 与本次检查均以代码路径 + 静态验证为主。以下仍建议主会话或 UA 阶段抽测：
   - 320 / 390 / 640 / 768 / 960 / 1440 与 200% zoom 无横向溢出、Save/Cancel 可达；
   - 明暗主题焦点环与 开/关/未提供 徽标可读；
   - 全键盘 Hub → 四详情 → 返回；
   - Network：仅打开 Hub 无 `/api/auth/quota` 等新请求（代码已确认 Hub 无 fetch）；
   - Members → Settings Studio 深链一次点击：选中 root Studio + 成员行 ~2.2s 高亮。

2. **ARIA tree 与独立 provider chevron**  
   - 已实现 `role="tree"` / `treeitem` / `group`、`aria-expanded` / `aria-controls` / `aria-current="page"`、roving tabindex 与方向键。  
   - provider 折叠按钮在 flatten 中为 `toggle:providers`，但渲染为 Hub 行旁的 sibling button，**未**挂 `role="treeitem"`；键盘仍可通过 roving 焦点与 Arrow 到达。  
   - 读屏对「treeitem 旁无 role 的控件」可能有挑剔；design 允许完整 tree 或降级 nav/button。当前属可接受实现，**不阻塞**；若 UA 反馈读屏混乱，再统一语义（整行 treeitem + 内嵌 expand，或降级 nav）。

3. **`renderProviderBackLink` 仍带 inline style**  
   `globals.css` 已用 `button.settings-provider-back` + `!important` 覆盖，功能与主题正常。可后续清掉 inline，非必须。

4. **双端 `expandAncestorsForView`**  
   `SettingsTreeNavigation.handleSelectView` 与 `SettingsConfig.handleSelectView` 都会 union 祖先展开；冗余但语义一致，无功能回归迹象。

## 需求 / 设计对照（checks.md 摘要）

| 域 | 结论 | 证据 |
| --- | --- | --- |
| 四分组可折叠 + 非平铺 13 一级 | pass | `SettingsTreeNavigation`：sessionWorkspace / modelsUsage / tools / system |
| Studio 一级直达 | pass | root leaf `view:studio`；`ancestorGroupsForView("studio")=[]` |
| Trellis 在工具 | pass | tools 下 terminal / editor / trellis |
| 提供商策略先 Hub 四卡 | pass | `view === "providerHub"` → `SettingsProviderHub`；不默认 chatgpt |
| 四卡进详情 + 返回 Hub | pass | `onOpenProvider` / `renderProviderBackLink` 四详情共用 |
| OpenCode Go 用量「未提供」 | pass | `buildOpencodeGoRows` 固定「未提供」，无 usage toggle |
| 未做方案 C；账号仍在 Models | pass | Hub 只读草稿布尔；无账号编辑 UI |
| 13 `SettingsSection` 稳定 | pass | 联合类型 13 id；`export type { SettingsSection }` 从树模块 re-export |
| `initialSection` 未扩宽到 `providerHub` | pass | props：`initialSection?: SettingsSection`；`SettingsView` 仅内部 |
| 默认 yolk + sessionWorkspace 展开 | pass | `DEFAULT_SETTINGS_EXPANDED_GROUPS` + `expandAncestorsForView` |
| Studio 深链 + focus 高亮 | pass | AppShell 仍传 `initialSection="studio"` + member/field；effect 先 expand 再 `setView`；2.2s highlight / custom member 保留 |
| provider 详情自动展开 modelsUsage+providers | pass | `ancestorGroupsForView(chatgpt\|…)=["modelsUsage","providers"]` |
| 草稿回 Hub 同步 | pass | Hub props 直接取当前 chatgpt/opencodeGo/grok/kiro state |
| dirty/save/reset / PUT body 不变 | pass | body 仍为 yolk…editor；diagnostics 不进 dirty |
| Hub 无 quota/account 请求 | pass | ProviderHub / TreeNav 无 fetch；`providerHub` 不进 models/trellis load effect |
| ≤640 纵向树非横向 tabs | pass（CSS） | `.settings-tree-nav-panel` `max-height: min(36dvh,280px)`；旧 flat 横向选择器排除 tree panel |
| 选中态非纯颜色 | pass | `bg-selected` + inset accent 条 + font-weight + `aria-current` |
| 文档 | pass | `docs/modules/frontend.md` 登记 TreeNav / ProviderHub / Studio / Trellis / 非目标 |
| UI 门禁材料 | pass | 任务内 HTML 原型 + ui.md 正式交付；plan-review 已勾 UI designer；实现已完成（流程上审批书 checkbox 历史态不作为本 checking 阻塞，因任务已进入 checking 且 6/6 done） |

## Verification

| 命令 | 结果 |
| --- | --- |
| `npm run lint` | **通过** exit 0；仅既有 archive/scripts 6 条 warning，与本任务无关 |
| `node_modules/.bin/tsc --noEmit` | **通过** exit 0 |
| 代码路径对照 checks / PRD / design | 通过（见上表） |
| 浏览器矩阵 | **未在本检查会话全量手测**（非阻塞 residual） |

## 结论与主会话动作

### Verdict

**Pass** — 实现覆盖 PRD/Design/Implement 验收要点；稳定 section 契约与 web-config schema 未破坏；Hub 边界正确；lint/tsc 绿；检查员已修 Space 键盘回归风险。

### 建议 transition

- **`checking` → `ready`**
- **不要**跳到 `user_acceptance`（由主会话/流程推进）
- **不需要** `changes_requested`

### 主会话可选 follow-up（非阻塞）

1. UA 前抽测 checks 浏览器矩阵（窄屏 / 键盘 / Studio 深链 / Network）。  
2. 若读屏反馈 chevron 语义怪异，再统一 ARIA（仍可保持 nav/button 降级路径）。  
3. 清理 `renderProviderBackLink` inline style（纯样式债）。

## 检查员改动文件

- `components/SettingsTreeNavigation.tsx` — Space `preventDefault` 移除  
- `.ypi/tasks/20260716-165629-设置项归拢为树形导航并提供商摘要卡-studio-一级/review.md` — 本文件  
