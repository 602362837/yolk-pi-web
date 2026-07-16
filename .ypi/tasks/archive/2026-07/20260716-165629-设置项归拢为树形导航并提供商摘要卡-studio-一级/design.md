# Design：Settings 树导航与 Provider Hub

## 方案摘要

保留 13 个既有 `SettingsSection` 作为真实详情页标识，新增仅存在于前端的虚拟 view `providerHub`。把导航定义从 JSX 平铺调用提升为一份静态树模型，由独立导航组件渲染；把四张 provider 摘要卡抽成纯呈现组件。`SettingsConfig` 继续拥有配置草稿、dirty/save/reset、详情条件渲染和 Studio focus 行为。

## 建议类型与边界

```ts
export type SettingsSection =
  | "yolk" | "worktree" | "studio" | "usage" | "modelPrices"
  | "terminal" | "chatgpt" | "opencodeGo" | "grok" | "kiro"
  | "editor" | "trellis" | "diagnostics";

type SettingsView = SettingsSection | "providerHub";
type SettingsGroupId = "sessionWorkspace" | "modelsUsage" | "providers" | "tools" | "system";
```

- `initialSection` 继续只接受 `SettingsSection`，外部契约不混入虚拟 view。
- `providerHub` 不写入 URL、配置或 AppShell state。
- 可增加纯 helper `ancestorGroupsForView(view)`，用稳定映射驱动自动展开；不要按显示文案猜分组。

## 组件划分

### `components/SettingsTreeNavigation.tsx`

职责：

- 渲染固定 IA、缩进、展开按钮和可见节点。
- 接收 `activeView`、`expandedGroups`、`onExpandedGroupsChange`、`onSelectView`。
- Studio 作为 root leaf；providerHub 既可激活内容，又可展开四个 provider 子叶。
- 管理可见节点的 roving focus / 标准树方向键，不管理配置数据。

不负责：保存、dirty、provider 状态、Studio member 深链。

### `components/SettingsProviderHub.tsx`

职责：

- 接收安全布尔投影和 `onOpenProvider(section)`。
- 渲染四张摘要卡与 `开 / 关 / 未提供 / Models` 文本状态。
- 卡片只反映当前 Settings 草稿，不 fetch、不保存、不读取账号或 quota。

建议 props：

```ts
interface SettingsProviderHubProps {
  chatgpt: { usagePanelEnabled: boolean; autoFailoverEnabled: boolean; autoRefreshEnabled: boolean };
  opencodeGo: { autoFailoverEnabled: boolean };
  grok: { usagePanelEnabled: boolean; autoFailoverEnabled: boolean };
  kiro: { usagePanelEnabled: boolean; autoFailoverEnabled: boolean };
  onOpenProvider: (section: "chatgpt" | "opencodeGo" | "grok" | "kiro") => void;
}
```

### `components/SettingsConfig.tsx`

继续负责：

- `/api/web-config` 加载与保存。
- 所有现有配置草稿和 handlers。
- `section`/`view` 协调、deep-link effect、Studio member scroll/highlight。
- provider 详情顶部的“返回提供商策略”。
- Modal header/footer 和内容滚动。

## 导航树契约

```text
root
├─ group sessionWorkspace
│  ├─ section yolk
│  └─ section worktree
├─ section studio
├─ group modelsUsage
│  ├─ section usage
│  ├─ section modelPrices
│  └─ group providers + view providerHub
│     ├─ section chatgpt
│     ├─ section opencodeGo
│     ├─ section grok
│     └─ section kiro
├─ group tools
│  ├─ section terminal
│  ├─ section editor
│  └─ section trellis
└─ group system
   └─ section diagnostics
```

展开规则：

1. 初始 `yolk`：默认展开 `sessionWorkspace`。
2. 选择/深链任一 view：并集加入其祖先分组，绝不自动折叠用户已展开的其他分组。
3. 用户可折叠含当前 section 的分组；右侧保持不变，但再次选择/外部深链会重开祖先。
4. 点击 providerHub 的标签区域激活 Hub；独立 chevron 只切换 provider 子项，避免一次点击同时产生不清晰的两种动作。键盘 Right/Left 对展开负责，Enter/Space 激活 Hub。

## 数据流

```text
GET /api/web-config
  → SettingsConfig draft state
      ├─ existing leaf forms (unchanged)
      └─ safe boolean projection → SettingsProviderHub
                                   └─ onOpenProvider(existing section id)
                                           → set active view
                                           → expand ancestor groups
                                           → existing provider form

AppShell studio member action
  → initialSection="studio" + studioFocusMember/Field
      → SettingsConfig sync view=studio
      → expand no group (Studio root leaf)
      → existing row scroll/highlight effect
```

## 保存与配置契约

- `/api/web-config` 请求体完全不变。
- Hub 不产生新的可编辑控件；它只读草稿状态。所有开关仍在 provider 详情或 Usage 页修改。
- `providerHub`、展开组和焦点节点均为组件内临时状态。
- `modelPrices` 继续写 `models.json`；其他现有 section 继续沿用 `pi-web.json` 和当前 handlers。
- 不改变 `dirty` 比较、Reset、Save disabled 和 `onConfigChange`。

## 响应式与样式

- Modal 建议由 760px 扩为 `min(960px, calc(100vw - 40px))`，导航约 210–220px，内容 `min-width: 0`。
- 新增明确 class，而非依赖 `[style*=...]` 匹配：`.settings-tree-nav`, `.settings-tree-node`, `.settings-provider-grid/card`。
- `≤640px`：modal 全屏；body 纵向；树导航宽 100%、`max-height: min(36dvh, 280px)`、纵向滚动；provider grid 单列。
- 复用 `--bg/--bg-panel/--bg-subtle/--bg-selected/--border/--text*/--accent`，不引入固定夜间颜色。

## 可访问性设计

- 推荐严格 tree：容器 `role="tree"`，节点 `role="treeitem"`，子容器 `role="group"`；若实现复杂度导致语义错误，宁可采用可访问 button + `nav aria-label`，不要半实现错误 ARIA。
- 原生 button、`aria-expanded`、`aria-controls`、`aria-current="page"`。
- 维护当前可见节点数组，实现 ArrowUp/Down/Left/Right、Home/End；Tab 仍可离开导航。
- provider 卡用 button 或 card 内唯一 button，避免可点击容器嵌套 button。
- 徽标必须有“开 / 关 / 未提供”文字。

## 兼容性

- 保留所有 13 个 id 和 `SettingsConfig` props，AppShell 正常情况下无需代码改动，仅需回归检查。
- 不迁移任何配置文件。
- 旧浏览器若不支持 `color-mix`，核心结构仍由现有变量与 border 呈现；不要让可读性依赖 color-mix。
- Trellis、Terminal、Studio 的按需模型加载 effect 仍按真实 section 判断。

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| `providerHub` 混入 `SettingsSection` 后破坏外部契约 | 使用独立 `SettingsView`，`initialSection` 保持原联合类型。 |
| providerHub 摘要与未保存草稿不同步 | 直接从当前 draft props 派生，不复制状态。 |
| 三级树在 150px 导航中拥挤 | 导航增至约 216px并适度扩大 modal；小屏纵向滚动。 |
| 分组点击/展开语义冲突 | chevron 只展开，label 激活 Hub；普通 group 仅展开。 |
| 深链选中项被折叠 | 每次外部 section 同步时先展开 ancestor 映射。 |
| ARIA tree 实现不完整 | 实现标准键盘模式并做人工读屏检查；否则降级为 nav/button 语义。 |
| Monolithic `SettingsConfig` 改动冲突 | 导航与 Hub 独立组件，集成任务单写者完成。 |

## 回滚

纯前端代码回滚：恢复原 `renderSectionButton()` 平铺导航和 760px modal 即可。无数据迁移、无配置字段、无 API 需要回滚。
