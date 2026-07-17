# UI：Settings 树导航与 Provider Hub

## UI 原型门禁

本任务改变设置弹窗的信息架构、导航交互、provider 入口和窄屏布局，明确触发 UI 原型硬门禁。

- HTML 原型交付件：[`settings-tree-provider-hub-prototype.html`](settings-tree-provider-hub-prototype.html)
- 草案覆盖：桌面树导航、Studio 一级、provider Hub、provider 详情返回、窄屏布局和明暗主题。
- 当前状态：**ui-designer 已正式审阅并交付，原型已就绪，满足门禁要求**。
- 正式交付路径：[`settings-tree-provider-hub-prototype.html`](settings-tree-provider-hub-prototype.html)

取得用户批准前不得进入实现。

## 设计目标

1. 用稳定分组降低 13 个平铺入口的扫描成本。
2. 让 Studio 保持高可见的一层直达，不被误归类为工具或 Trellis 子项。
3. 让用户先在 provider Hub 比较策略状态，再进入具体表单。
4. 不把配置表单重画成新设计系统，继续复用现有面板、圆角、边框和 token。

## 关键页面与交互

### 1. 默认设置页

- 左侧约 216px 树导航；右侧保持现有叶子内容。
- “会话与工作区”默认展开并选中“蛋黄𝝅”。
- Studio 放在两个分组之间，以 root leaf 样式直达。
- 分组 chevron 与 label 使用同一个可访问 button；普通分组点击只展开/折叠。

### 2. 提供商策略 Hub

- “提供商策略”本身是可激活的 hub 行，同时有独立展开 affordance 显示四个 provider 子叶。
- 右侧标题说明“策略摘要来自当前设置草稿，账号仍在 Models”。
- 四张卡在宽屏 2×2；每张卡有 provider 名、说明、状态行和“查看详情”。
- 状态使用文字徽标：`开`、`关`、`未提供`、`Models`。

### 3. Provider 详情

- 详情继续复用现有 ChatGPT/OpenCode Go/Grok/Kiro 表单。
- 标题上方或同一行提供“← 返回提供商策略”。
- 左树保持祖先展开并选中 provider 子叶。

### 4. 窄屏

- `≤640px` Settings 继续全屏。
- 树导航改为内容上方的纵向可滚动区域，限制约 36dvh；不沿用旧平铺 tab 的横向滚动。
- Provider 卡单列，footer 按现有规则可见。

## 视觉规范

- 只使用现有 `--bg`, `--bg-panel`, `--bg-subtle`, `--bg-selected`, `--border`, `--text`, `--text-muted`, `--text-dim`, `--accent`。
- 选中态：浅 accent 背景 + 左侧/边框强调 + 字重，不只改变文字颜色。
- 层级：root 0、普通叶子 1、provider 叶子 2；缩进控制在窄导航仍可阅读的范围。
- 摘要卡 hover/focus 有边框与轻微背景变化；`prefers-reduced-motion` 取消位移动效。

## 状态矩阵

| 场景 | 导航 | 内容 | 反馈 |
| --- | --- | --- | --- |
| 初次打开 | 会话与工作区展开，蛋黄𝝅选中 | 原蛋黄𝝅页 | 无额外提示 |
| 点击普通分组 | 切换 `aria-expanded` | 当前页不变 | chevron/子项显隐 |
| 点击 Studio | root Studio 选中 | 原 Studio 页 | 深链成员高亮保持 |
| 点击提供商策略 | models/providers 展开，Hub 选中 | 四卡摘要 | 卡片反映当前草稿 |
| 点击 provider 卡 | provider 子叶选中 | 原 provider 详情 | 显示返回 Hub |
| 折叠当前祖先 | 子项隐藏 | 当前表单和草稿保留 | 再次深链自动展开 |
| OpenCode Go 卡 | 用量为“未提供” | 只显示 failover 摘要 | 不制造 usage toggle |
| Loading/error | 树仍可见 | 沿用现有 loading/error | 不显示假摘要 |
| 窄屏 | 顶部纵向树可滚动 | 下方内容单列 | 无横向溢出 |

## 可访问性

- 节点为原生 button，展开节点有 `aria-expanded`/`aria-controls`。
- 当前页使用 `aria-current="page"`。
- 实现 tree 键盘规则：ArrowUp/Down/Left/Right、Home/End、Enter/Space。
- Provider 卡不嵌套多个交互控件；整卡 button 或唯一“查看详情”button 二选一。
- 文本状态不依赖颜色，焦点环使用现有 accent。

## UI designer 交付说明

UI 设计员已根据 `components/SettingsConfig.tsx` 的真实状态与 `app/globals.css` 中已有的 CSS variables 对原型进行了审阅与修订。

### 原型修订与交互结论：
1. **真实 Token 校准**：原型已全面迁移至现有 CSS 变量：`--bg`, `--bg-panel`, `--bg-subtle`, `--bg-selected`, `--border`, `--text`, `--text-muted`, `--text-dim`, `--accent`，且选中态不仅依赖颜色，还包括 `box-shadow` 边缘指示线和 `font-weight` 的组合变化。
2. **草稿-保存-取消流**：原型模拟了 ChatGPT、OpenCode Go、Grok、Kiro 的用量和自动切换草稿状态。更改 provider 详情页中的开关后返回 Hub，摘要状态会即时同步。点击取消可复原，点击保存可持久化。
3. **全键盘树导航支持**：实现了 Roving tabindex 规范。`ArrowDown`/`ArrowUp` 在可见节点间移动焦点；`ArrowRight`/`ArrowLeft` 分别展开和折叠分组；`Home`/`End` 快速到达首尾；非展开分组可使用 Enter 或 Space 选择和聚焦。
4. **窄屏适配校验**：`≤640px` 下弹窗使用 100vw/100dvh 全屏展示。树导航横向展开为顶部纵向可滚动区域，且最大高度限制为 `36dvh`（不超过 270px），provider 卡片自适应降级为单列呈现，页面底部的操作栏固定置底，防止键盘挤压。
5. **OpenCode Go 状态**：严格隐藏用量面板开关，用量显示“未提供”，账号提示指向 "Models"，以保持与产品架构设计的一致性。

目前原型已就绪，正式交付主会话/用户审阅，无遗留 UI 设计风险。

## 审批请求

用户审批时请重点确认：

- Studio 是否以正确一级层级展示；
- provider Hub 是否保留四卡先览后进详情；
- provider 子叶是展开在树中还是只通过卡片进入（当前原型为两者都可进入）；
- 小屏采用顶部纵向折叠树是否可接受。
