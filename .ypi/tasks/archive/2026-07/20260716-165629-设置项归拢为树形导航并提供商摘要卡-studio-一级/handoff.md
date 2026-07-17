# Handoff：实现与验证（SETTINGS-IA-06）

## 实现范围（01–05 已完成）

| 子任务 | 状态 | 主要交付 |
| --- | --- | --- |
| SETTINGS-IA-01 | done | `components/SettingsTreeNavigation.tsx` — 树 IA、`SettingsView`/`ancestorGroupsForView`、键盘 roving focus |
| SETTINGS-IA-02 | done | `components/SettingsProviderHub.tsx` — 四卡草稿摘要、OpenCode Go「未提供」 |
| SETTINGS-IA-03 | done | `components/SettingsConfig.tsx` 集成 view/Hub/返回/深链；`AppShell` 调用方未改契约 |
| SETTINGS-IA-04 | done | `app/globals.css` 树/卡/≤640 纵向树/960 模态/reduced-motion |
| SETTINGS-IA-05 | done | `docs/modules/frontend.md` 登记树 IA、Hub、深链与非目标 |
| SETTINGS-IA-06 | done（本交接） | lint/tsc + 代码路径对照 `checks.md` |

## 变更文件（生产）

- `components/SettingsTreeNavigation.tsx` — 新增树导航与稳定 IA helper
- `components/SettingsProviderHub.tsx` — 新增 Provider Hub 纯呈现
- `components/SettingsConfig.tsx` — 集成 view、Hub、返回 Hub、深链展开
- `app/globals.css` — 树/Hub/响应式/a11y 样式
- `docs/modules/frontend.md` — 模块文档同步

未改：`lib/pi-web-config.ts`、`/api/web-config`、provider quota/account API、`AppShell` 深链 props 契约。

## SETTINGS-IA-06 验证

### 自动

| 命令 | 结果 |
| --- | --- |
| `npm run lint` | **通过**（exit 0；仅既有 archive/scripts 6 条 warning，与本任务无关） |
| `node_modules/.bin/tsc --noEmit` | **通过**（exit 0） |

### 代码路径 / 静态对照 checks.md

| 检查项 | 结论 | 证据 |
| --- | --- | --- |
| 不再平铺 13 一级项；四分组可折叠 | pass | `SettingsTreeNavigation` groups: sessionWorkspace / modelsUsage / tools / system |
| Studio 一级直达 | pass | root leaf `view:studio`，`ancestorGroupsForView("studio")=[]` |
| Trellis 在工具 | pass | tools 下 terminal/editor/trellis |
| 提供商策略先开 Hub | pass | `view === "providerHub"` → `SettingsProviderHub`；不默认 chatgpt |
| 四卡进详情 + 返回 Hub | pass | `onOpenProvider` → section；`renderProviderBackLink` 四详情共用 |
| OpenCode Go 用量「未提供」 | pass | `buildOpencodeGoRows` 固定 `未提供`，无 usage toggle |
| 未做方案 C / 账号仍在 Models | pass | Hub 只读草稿布尔；无账号编辑 UI |
| 13 `SettingsSection` + schema 未变 | pass | 联合类型仍 13 id；`PUT /api/web-config` body 仍为 yolk…editor |
| 默认 yolk + sessionWorkspace 展开 | pass | `DEFAULT_SETTINGS_EXPANDED_GROUPS` + initial view yolk |
| `initialSection="studio"` 深链 | pass | AppShell 仍传 `initialSection="studio"` + focus；effect 先 expand 再 setView |
| studioFocus 滚动/高亮/自定义成员 | pass | 既有 2.2s highlight + custom member 临时行保留 |
| provider 详情自动展开 modelsUsage+providers | pass | `ancestorGroupsForView(chatgpt|…)=["modelsUsage","providers"]` |
| 草稿回 Hub 同步 | pass | Hub props 直接取当前 `chatgpt/opencodeGo/grok/kiro` state |
| dirty/save/reset 不含 diagnostics / 无 schema 扩 | pass | dirty 比较仍仅配置对象；diagnostics 本地 |
| Hub 无 quota/account 请求 | pass | `SettingsProviderHub` 无 fetch；`providerHub` 不进入 models/trellis load effect |
| 键盘 tree / aria | pass（代码） | role=tree/treeitem、aria-expanded/controls/current、方向键/Home/End、roving tabindex |
| ≤640 纵向树非横向 tabs | pass（CSS） | `.settings-tree-nav-panel` max-height `min(36dvh,280px)`；旧 flat 横向选择器排除 tree panel |
| 文档 | pass | `docs/modules/frontend.md` 含 SettingsTreeNavigation / SettingsProviderHub / 提供商策略 |

### 浏览器人工矩阵（本环境未执行）

以下项**未在真实浏览器手测**，留给 checker / 主会话：

- 320 / 390 / 640 / 768 / 960 / 1440 视口与 200% zoom
- 明暗主题焦点环与徽标
- 全键盘 Hub→四详情→返回
- Network：仅打开 Hub 时无新的 `/api/auth/quota` 等请求（代码路径已确认无触发点）
- Members → Settings Studio 深链一次点击体验
- Save/Cancel/Reset 与折叠当前祖先后草稿保留的 UI 回归

## 风险 / 检查员关注

1. **ARIA tree 完整性**：已实现 role=tree + treeitem + 标准方向键；provider chevron 为独立 button（与 label 分离）。若读屏对嵌套 group 有挑剔，可再人工测 VoiceOver/NVDA。
2. **键盘与 flatten 可见节点**：`toggle:providers` 在 flatten 与渲染中均存在；ArrowRight 从 Hub 直接跳首 provider（跳过 chevron），与常见 tree 行为接近，建议键盘手测确认是否符合预期。
3. **双端 expand**：`SettingsTreeNavigation.handleSelectView` 与 `SettingsConfig.handleSelectView` 都会 union 祖先展开，冗余但语义一致，无功能回归迹象。
4. **浏览器矩阵未跑**：静态/类型已绿，交互与 network 仍需 checker 补人工项。

## 主会话下一步

1. 将 SETTINGS-IA-06 标 **done**（实现员侧验收完成；若 Studio 进度需主会话写回请同步）。
2. 派发 **checker** 按 `checks.md` 做浏览器人工矩阵与最终验收。
3. 不 commit / 不 push（实现员约束）。

## 决策需求

- 无产品决策阻塞。
- 仅需确认：是否接受「代码路径验收 + 浏览器矩阵交 checker」作为 IA-06 完成口径（本交接按此完成）。
