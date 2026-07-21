# UI：Settings → 外观 → 背景皮肤

## 门禁结论

**已交付并满足 HTML 原型硬门禁。** 本任务向 Settings 新增外观皮肤视图，包含上传/切换/删除及相关呈现控制交互。

UI 设计员已于任务目录下交付 [appearance-skins-prototype.html](appearance-skins-prototype.html) 原型文件，该文件为单文件自包含 HTML，完整覆盖了外观入口、列表、上传状态、参数调节（fit、锚点、遮罩、面板透明度）、删除确认、并发冲突等交互逻辑。

## UI 原型交付说明

### 交付形式
- 原型文件：`.ypi/tasks/20260720-144502-设计外观模块-皮肤管理与网页背景适配/appearance-skins-prototype.html`
- 运行方式：双击该自包含 HTML 可在任意浏览器中打开并调试交互状态。

### 设计亮点与适配
1. **真实穿透感**：模拟了 active skin 时 AppShell 面板和侧栏的透明度叠加（CSS variables override），展示出背景的毛玻璃或半穿透感，且 Monaco 等高密度工具始终实色展示以保证对比。
2. **完整的状态模拟器**：支持亮暗模式切换、拖放/选择上传格式验证、20MiB 上传限制、并发冲突、容量上限以及切换失败等边界错误的提示。
3. **定位锚点行为**：实现 3x3 空间锚点对焦，并在拉伸铺满（stretch）时禁用该对焦项，带有详细的原型文字引导。
4. **Active 皮肤原子删除流程**：模拟了在删除当前使用背景时的强警告文案及“切换默认外观+删除”的原子交互。

## UI 设计员委托

### 先阅读

- `brief.md`、`prd.md`、`design.md`、`checks.md`
- `components/SettingsTreeNavigation.tsx`
- `components/SettingsConfig.tsx`
- `components/AppShell.tsx`
- `hooks/useTheme.ts`
- `app/globals.css`（`:root` / `html.dark`、Settings、responsive）
- 已有任务原型中 Settings tree、light/dark、narrow、AppPrompt 的表现方式

### 原型交付形式

- 文件：任务目录下 [appearance-skins-prototype.html](appearance-skins-prototype.html)
- 单文件自包含 HTML/CSS/轻量状态切换脚本，不依赖外网资源。
- 应可通过 task-local CSP sandbox preview 打开。
- `ui.md` 在交付后已补充相对链接、设计说明（见本文件头部及 `plan-review.md`）。

## 推荐页面结构

### Settings 树

- 新增 root-level `外观` leaf，推荐置于 `Studio` 之前；图标可用简单的 sun/image 线性符号。
- 描述：`主题与网页背景皮肤`。但 P0 内容只管理背景，现有 light/dark 按钮不迁移。

### 外观内容区

桌面建议两栏：

1. **左侧皮肤库**（约 260–300px）
   - 「默认外观」固定卡片。
   - 上传按钮/拖放区。
   - 皮肤缩略图列表：active、名称、尺寸、菜单（重命名/删除）。
   - 数量/总容量提示。
2. **右侧预览与参数**
   - 16:9 可缩放预览，模拟 topbar/sidebar/chat/input 的半透明层级，而不只是裸背景图。
   - Fit segmented control：覆盖裁剪 / 完整显示 / 拉伸 / 原始尺寸。
   - 3×3 位置锚点；stretch 时禁用并说明原因。
   - 遮罩色：自动 / 浅色 / 深色。
   - 背景遮罩强度、面板不透明度 slider，显示数值。
   - 当前状态与「应用」语义：推荐所有已持久化操作即时生效；参数可采用短 debounce 自动保存，原型必须明确 busy/saved/conflict。

≤640px 改为单列：先库、后预览/参数；操作按钮不可横向溢出，Settings tree 保持现有顶部可滚动布局。

## 关键交互

1. **上传**
   - 点击与拖放均可；只接受单图。
   - 选择后进入「上传 → 安全处理 → 生成缩略图」进度文案，不伪造精确百分比。
   - 推荐成功后自动激活，并把新卡片滚入视野；失败时旧 active 不变。
2. **切换**
   - 点击整张卡片切换；active 有文字/图标，不只靠边框颜色。
   - 浏览器 decode 期间显示轻量 busy；decode 失败维持旧皮肤。
3. **参数**
   - Fit/position/veil/panel 均在预览中即时体现。
   - 保存冲突显示「配置已在其他标签页变化，已刷新，请重新调整」，不静默覆盖。
4. **删除**
   - 非 active：普通危险确认。
   - active：更强确认，明确「删除后立即切回默认背景」。
   - busy 只锁定目标卡片；失败保留卡片和真实 active。
5. **默认外观**
   - 可随时切回，恢复现有不透明 semantic surfaces；不会删除皮肤。

## 原型状态控制器必须覆盖

- 默认空态、默认外观 active
- catalog 有 1 个 / 多个皮肤
- upload hover/drop、上传中、处理中、格式错误、过大、像素过大、配额满、成功
- cover / contain / stretch / original
- 9 个 position 锚点；stretch disabled
- auto/light/dark overlay，低/高 overlay 与 panel opacity
- switching/decode failure
- rename、delete confirm、active delete confirm、delete busy/failure
- revision conflict / catalog stale
- light / dark
- desktop / ≤640px
- keyboard focus / reduced motion

## 视觉与可读性要求

- 原型应真实模拟背景穿透，而不是所有 pane 保持完全不透明。
- Chat 内容、代码块、输入栏、Sidebar、topbar、右面板必须可读。
- Settings modal、AppPrompt/confirm、popover 应比普通 pane 更不透明。
- Monaco/xterm 用一个「保持实色」示意，说明高密度工具不跟随最低 panel opacity。
- `contain` 的留白使用 theme-aware 底色；`stretch` 明示可能变形；`cover` 明示是视口裁剪、不修改原图。
- 背景层不能有交互，不影响鼠标或 focus。
- 动画只允许一次性短淡入；reduced motion 完全静态。

## 可访问性要求

- 皮肤卡片为 button/radio-like 可键盘激活，active 状态有 `aria-pressed` 或等效语义。
- 3×3 position 使用 radiogroup，方向名称完整可读。
- sliders 有 label、当前数值和键盘行为。
- 上传状态 `aria-live=polite`；错误不用高频播报。
- 删除确认使用现有 AppPrompt 的 alertdialog/focus restore 语义。
- 所有状态不只靠颜色；缩略图有安全、简短 alt（如皮肤名）。

## 审批要求

原型交付后，主会话应把 HTML 链接补入 `plan-review.md`，请用户明确回复「批准」或「需要修改」。批准应同时确认：

- 皮肤 P0 是背景皮肤，不是完整色板主题；
- Settings 树位置与页面布局；
- 四种 fit 与 3×3 position；
- 上传成功自动激活与 active 删除行为；
- 可读性参数及 translucent surface 程度；
- responsive/light/dark/reduced-motion 表现。

**在 HTML 原型和上述审批完成前，不得建议进入 implementing。**
