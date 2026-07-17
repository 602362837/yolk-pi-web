# Brief：设置项归拢为树形导航并提供商摘要卡（Studio 一级）

## 背景

当前 `components/SettingsConfig.tsx` 在 150px 左栏平铺 13 个一级 `SettingsSection`，设置项增加后难以建立“会话 / 模型与用量 / 工具 / 系统”的认知分组。用户已确认采用方案 B：左侧改为可折叠树形导航，并为提供商策略增加摘要 hub，而不是仅换导航样式或把所有顶栏用量开关合并为一个大页面。

## 已确认目标

1. 将设置 IA 调整为：
   - 会话与工作区：蛋黄𝝅、WorkTree
   - **Studio：一级直达入口**
   - 模型与用量：Usage、模型价格、提供商策略
   - 工具：Terminal、Editor、Trellis
   - 系统：诊断
2. “提供商策略”先展示 ChatGPT / OpenCode Go / Grok / Kiro 四张摘要卡，再从卡片进入现有详情页。
3. 摘要读取当前 Settings 草稿状态，至少呈现用量面板、自动 failover 等关键开关；OpenCode Go 没有顶栏用量能力时明确显示“未提供”，不得伪造开关。
4. 保持既有 `SettingsSection` id：`yolk/worktree/studio/usage/modelPrices/terminal/chatgpt/opencodeGo/grok/kiro/editor/trellis/diagnostics`。
5. 保持 `AppShell` 的 `initialSection="studio"`、`studioFocusMember`、`studioFocusField` 深链：打开时自动展开所属树分组、选中 Studio，并继续滚动和高亮目标成员行。
6. Trellis 归入“工具”，与 Terminal / Editor 同级；不得成为一级或新建“工作流代理”分组。

## 范围内

- Settings 左侧树形导航、展开/折叠状态、选中态和键盘行为。
- Studio 一级入口。
- 提供商策略 hub、四张摘要卡、从卡片进入 provider 详情和返回 hub 的路径。
- 桌面/窄屏 Settings 布局适配。
- 深链自动展开与选中兼容。
- `docs/modules/frontend.md` 等直接受影响文档同步。

## 范围外

- 不实施方案 C：不把 Usage 和各 provider 的 `usagePanelEnabled` 合并到单一“顶栏用量”大页。
- 不移动或重做账号管理；账号继续在 Models 中管理。
- 不改变 provider quota、failover、OAuth 或账号 API。
- 不改变 `pi-web.json` / `models.json` schema、字段语义、dirty/save/reset 路径。
- 不重写各现有叶子页内部表单。
- 不更改 AppShell 打开设置的产品入口。

## 证据与约束

- `SettingsConfig.tsx` 当前用 `SettingsSection` 联合类型、`renderSectionButton()` 与长条件渲染承载 13 个页。
- `AppShell.tsx` 仅在 Studio 成员深链时传 `initialSection="studio"`，并传 focus member/field。
- 小屏现有 `app/globals.css` 将 `.settings-modal-body` 纵向堆叠，并把旧导航变为横向滚动；树形导航需要专门的小屏规则，不能沿用扁平 tab 的横向布局。
- 配置仍由 `/api/web-config` 读写 `pi-web.json`；Provider hub 只投影当前客户端草稿，不新增请求或持久化字段。

## 成功标准

- 用户能通过最多两次主导航操作找到普通叶子，通过“提供商策略 → 卡片”进入 provider 详情。
- Studio 在树中与各分组平级并可一点直达。
- 深链、保存、恢复默认值、未保存提示与现有表单语义不回归。
- 键盘和窄屏均可完成展开、选择、进入 provider 详情和返回 hub。

## 当前门禁

本任务触发 UI 原型硬门禁。已准备架构侧 HTML 草案，但当前委派环境未提供 `ypi_studio_subagent` / Studio 调度工具，尚无法完成“由 ui-designer 派发并确认”的流程证明；主会话需补派 UI 设计员审阅/接管原型后，才可合法进入 `awaiting_approval`。
