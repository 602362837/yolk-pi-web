# PRD：设置树形导航与提供商策略摘要 Hub

## 目标与用户价值

将不断增长的 Settings 从 13 个平铺入口收敛为稳定的信息架构，让用户先按任务域定位，再进入具体设置；同时在不改变配置 schema 的前提下，提供跨 provider 的策略概览，减少逐页确认开关状态的成本。

## 用户与核心场景

- 普通用户：快速找到会话、WorkTree、用量、工具和诊断设置。
- 多 provider 用户：在一个 hub 比较 ChatGPT / OpenCode Go / Grok / Kiro 的可见策略状态，再进入详情调整。
- Studio 管理者：从 Members 页面深链到 Studio 成员模型并保持目标行高亮。
- 键盘或窄屏用户：无需精确鼠标操作也能展开分组和打开设置页。

## 信息架构

```text
设置
├── 会话与工作区
│   ├── 蛋黄𝝅
│   └── WorkTree
├── Studio
├── 模型与用量
│   ├── Usage
│   ├── 模型价格
│   └── 提供商策略
│       ├── ChatGPT
│       ├── OpenCode Go
│       ├── Grok
│       └── Kiro
├── 工具
│   ├── Terminal
│   ├── Editor
│   └── Trellis
└── 系统
    └── 诊断
```

## 功能需求与验收标准

### R1. 可折叠树形导航

- 分组“会话与工作区 / 模型与用量 / 工具 / 系统”可展开、折叠。
- 叶子显示明确选中态，不能只靠颜色；建议同时使用背景、边框/指示条和 `aria-current="page"`。
- 折叠当前叶子所属分组时，内容区保持当前页；再次打开或深链时所属祖先自动展开。
- 展开状态仅为 Settings 实例内前端状态，本期不持久化到 `pi-web.json` 或 localStorage。

**验收：** 鼠标和键盘均可展开/折叠；选择任意叶子后右侧出现原有内容；关闭并重开 Settings 使用稳定默认展开策略。

### R2. Studio 一级直达

- Studio 与四个分组平级，不位于“工具”或任何“工作流代理”分组内。
- 点击 Studio 直接打开现有成员运行策略页。

**验收：** 从普通设置入口与 Members 深链均可打开 Studio；Studio 行具有一级视觉层级。

### R3. 提供商策略 Hub

- 点击“提供商策略”正文区域先打开 hub，而不是默认跳到第一个 provider。
- Hub 展示四张摘要卡：ChatGPT、OpenCode Go、Grok、Kiro。
- 每张卡展示 provider 名、简述、关键状态和“查看详情”动作；整卡可点击时仍保留清晰按钮/可访问名称。
- 状态来自当前 Settings 草稿，因此未保存切换返回 hub 后应立即反映草稿值。
- 摘要口径：
  - ChatGPT：用量面板、自动 failover、后台自动刷新。
  - OpenCode Go：自动 failover；顶栏用量明确标记“未提供”，账号管理提示“Models”。
  - Grok：用量面板、自动 failover、账号管理“Models / Global Active”。
  - Kiro：用量面板、自动 failover、账号管理“Models / Global Active”。
- Hub 不请求 quota、账号或 secret 数据，不显示未加载的实时额度。

**验收：** 四卡完整显示；从每卡进入对应现有 section；返回 hub 后状态准确；OpenCode Go 不出现虚假 usage toggle。

### R4. Provider 详情导航

- Provider 详情继续使用稳定 section id：`chatgpt/opencodeGo/grok/kiro`。
- 当详情被选中，自动展开“模型与用量”和“提供商策略”祖先，并选中 provider 子叶。
- 详情页提供明确“返回提供商策略”入口；不依赖浏览器后退。

**验收：** Hub→详情→Hub 路径对四个 provider 一致；直接设置 `initialSection` 为 provider（若未来调用）也能打开祖先分组。

### R5. 深链兼容

- `initialSection="studio"` 在首次渲染和 prop 更新时继续生效。
- `studioFocusMember` / `studioFocusField` 的现有滚动、高亮和临时自定义成员行不变。
- 导航同步逻辑必须先展开目标祖先，再选择 section，不能因折叠状态隐藏选中项。

**验收：** 从 Studio Members 模型入口打开 Settings，Studio 一级项选中，目标成员行居中并高亮约 2.2 秒；无额外点击。

### R6. 窄屏与模态布局

- 桌面导航宽度提高到可承载三级缩进，内容区仍有可用宽度；可适度扩大 modal 最大宽度。
- `≤640px` 使用全屏 modal，树导航在内容上方纵向展示、内部滚动并限制最大高度；不得把多级树压成不可理解的单行横向 tabs。
- Provider 卡在宽屏双列、窄屏单列；长 provider 文案不溢出。

**验收：** 320/390/640px 宽度可访问所有导航项、内容和底部保存按钮，无横向页面溢出。

### R7. 可访问性

- 导航节点使用原生 button；展开节点提供 `aria-expanded` 与 `aria-controls`。
- 支持 Tab；树内支持 Enter/Space，且实现标准方向键体验：上下移动可见节点，右键展开/进入首子项，左键折叠/回父项，Home/End 跳首尾。
- 焦点环可见；状态徽标用“开/关/未提供”文字，不只用颜色。
- `prefers-reduced-motion` 下取消非必要展开/hover 动效。

**验收：** 仅键盘可完成 Hub→四个详情→返回；读屏能得知展开和当前项状态。

## 非功能要求

- 不新增后端 API 或配置 schema。
- 不复制 provider 表单或配置更新逻辑；详情仍由 `SettingsConfig` 的既有状态/handlers 渲染。
- 新组件保持纯呈现或轻量 UI 状态，避免读取 secrets 或 provider quota。
- lint 与 TypeScript 必须通过。

## 非目标

- 不实现方案 C 或新“顶栏用量”统一设置页。
- 不移动 Models 中的账号管理。
- 不改变 Usage、ChatGPT、OpenCode Go、Grok、Kiro 的字段和保存语义。
- 不对现有长表单做视觉重设计。

## 未决问题

产品决策已稳定，无需重新议价。唯一流程阻塞是 UI designer 派发工具在当前成员环境不可用；需主会话补派并让用户审批 HTML 原型后再实现。
