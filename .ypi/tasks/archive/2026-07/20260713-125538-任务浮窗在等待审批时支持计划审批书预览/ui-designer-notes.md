# UI Designer Notes — 任务浮窗计划审批书预览

## 设计摘要

- **目标**：把等待审批时的计划材料从“先开 Studio 详情、再找审批 Tab”缩短为浮窗内一击预览，同时保持聊天审批门禁不变。
- **入口位置**：在 `TaskCard` 的状态/元信息之后、运行摘要之前增加独立且可换行的 action row；保留顶行详情箭头，整卡不变成可点击区域，也不占用拖拽手势。
- **主任务**：仅 `status === "awaiting_approval"` 显示「计划审批书」。
- **改进项**：每个 `status === "waiting_plan_approval"` 的实例分别显示「计划审批书 · IMP-xxx」，不猜测默认实例。
- **预览层级**：桌面使用居中只读模态；移动端先保留现有底部任务面板，再以接近全屏的底部模态展示计划。
- **信息层级**：计划类型/改进编号 → 任务标题 → 文件路径 → 固定只读提示 → Markdown 正文 → 安全读取与源文件入口。
- **明确边界**：模态没有批准、拒绝或请求修改按钮；固定文案为「预览不会自动批准计划，仍需在绑定聊天中明确回复确认或提出修改」。
- **原型文件**：`ui-prototype.html` 自包含 CSS/JS，不依赖外部资源。

## 原型操作说明

1. 桌面浮窗中可分别点击主任务「计划审批书」和改进项「计划审批书 · IMP-003」。
2. 打开后先演示 loading，约 700ms 后进入长 Markdown 内容；正文区域可独立滚动。
3. 点击模态左上方橙色「只读 · …」eyebrow，可输入 `loading`、`error`、`empty` 或 `success` 切换状态；也可在模态打开时使用：
   - `Alt + L`：loading
   - `Alt + E`：error
   - `Alt + 0`：空/TBD
   - `Alt + S`：成功/长内容
4. error/empty 状态提供重试/重新读取。
5. 支持右上角关闭、`Escape`、点击遮罩关闭；关闭后焦点返回入口。
6. 顶栏可切换浅色/深色主题；点击「移动端」进入窄屏演示，再点底部 Studio pill 打开移动端任务底部面板。
7. 在真实宽度 `<= 640px` 的浏览器中也会自动进入移动布局。

## 状态矩阵

| 场景 | 入口/展示 | 用户操作 | 反馈与边界 |
| --- | --- | --- | --- |
| 主任务 `awaiting_approval` | 卡片独立显示「计划审批书」 | 点击 | 打开主任务根目录 `plan-review.md` 的只读预览 |
| 主任务其它状态 | 不显示计划入口 | — | 非审批态布局维持现状；详情箭头仍可用 |
| 改进项 `waiting_plan_approval` | 显示「计划审批书 · IMP-xxx」 | 点击对应实例 | 请求显式携带该实例 `improvementId` |
| 改进项其它状态 | 不显示该实例入口 | — | 不扩大可见范围，不提供常驻入口 |
| Loading | spinner +「正在读取计划审批书…」 | 等待或关闭 | `aria-live="polite"`；关闭应中止请求 |
| Success | 固定只读提示 + Markdown | 阅读、相对链接、打开源文件、关闭 | 不调用审批 PATCH，不产生 grant/transition |
| 长内容 | header、只读提示、footer 固定，正文独立滚动 | 滚轮、触控、键盘阅读 | 模态不超过视口，避免页面背景滚动 |
| Empty / TBD |「计划审批书尚未准备好」 | 重新读取、关闭 | 不把占位内容伪装为可审批材料 |
| 404 / 缺失 | 可理解错误 + 重试 | 重试、关闭 | 不显示空白弹窗；建议文案说明文件未准备 |
| 403 / 安全拒绝 | 安全访问失败 + 重试 | 修正材料后重试或关闭 | 不回显敏感绝对路径或服务端内部细节 |
| 网络失败 | 读取失败 + 重试 | 重试 | 旧正文不冒充当前目标；忽略过期请求 |
| 相对 Markdown/文本链接 | 使用现有文件查看器 | 点击 | 客户端先校验，服务端最终校验 |
| 相对 HTML 链接 | task-local `mode=preview` | 点击 | 新窗口 CSP sandbox；改进项继续携带 `improvementId` |
| 非法链接 | 不导航 | 点击 | 显示 scheme/绝对路径/`..`/反斜杠等被拒绝的提示 |
| 关闭 | ×、Escape、遮罩 | 关闭 | 返回原聊天/浮窗上下文，焦点回触发按钮 |
| 任务/session 切换 | 关闭或刷新当前 target | — | AbortController 中止；旧请求不得覆盖新目标 |
| 移动端 | 现有 Studio pill → 底部任务面板 → 预览 | 逐级点击 | 预览接近全屏，保留顶部圆角与底部 safe area |
| 权限不足 | 错误状态 | 关闭/重试 | 不降级为越界读取，不扩大绑定任务范围 |

## 组件复用与实现建议

### 推荐组件边界

- 新增专用 `YpiStudioPlanReviewModal`：负责 fetch、AbortController、target key、重试、meaningful 判定、Markdown、相对链接、dialog/focus/键盘和响应式布局。
- `YpiStudioSessionWidget`：只生成预览 targets、渲染入口并保存当前 target；桌面与移动端继续复用同一个 `TaskCard`。
- `AppShell`：向 widget 传入当前授权 `cwd` 与既有 `handleOpenFile`（或窄化 callback）。

### 复用现有能力

- 使用 `MarkdownBody`，沿用 `.markdown-body`、代码块、表格、链接等现有样式；不要新增平行 Markdown renderer。
- 使用现有 task-local files API：
  - 主任务：`path=plan-review.md&mode=read`
  - 改进项：额外携带 `improvementId`
  - HTML：`mode=preview` 的 sandbox 响应
- 抽取并复用 `YpiStudioPanel.tsx` 现有的任务相对链接解析/构造逻辑；不要复制一套略有差异的校验。
- 复用主题变量：`--bg`、`--bg-panel`、`--bg-hover`、`--bg-selected`、`--border`、`--text`、`--text-muted`、`--text-dim`、`--accent`、`--bg-subtle`、`--font-mono`。
- 按钮继续使用紧凑次级视觉，审批等待强调采用现有 amber 语义；桌面 widget 宽度保持 `360px`。

### 数据与竞态

- 正文只在打开后读取，不加入 session widget 轻量投影。
- 请求 key 应包含 `taskKey + improvementId + retryToken`。
- target 改变、关闭、session/cwd 改变和组件卸载时 abort；即使底层请求未及时取消，也必须忽略非当前 target 的响应。
- 空白和 `TBD` 使用与现有 `artifactDocumentIsMeaningful` 一致的判断。
- 多个等待改进项逐个生成入口；请求和 HTML preview 始终保持相同实例 scope。

## 响应式要求

- 桌面模态建议宽度 `min(760px, calc(100vw - 32px))`，最大高度约 `82dvh`；只有正文区滚动。
- 保持浮窗 `360px`、最大高度、拖拽、收纳和排序不变。
- `<= 640px` 时现有任务底部面板不变；预览层使用接近全屏的底部面板，顶部保留圆角，底部计入 `env(safe-area-inset-bottom)`。
- 表格和代码块横向滚动，不能撑破模态；长标题允许换行。

## 可访问性

- 预览容器使用 `role="dialog"`、`aria-modal="true"`、`aria-labelledby`。
- 打开前保存 `document.activeElement`；打开后聚焦关闭按钮或 dialog；关闭后恢复触发按钮。
- 焦点限制在模态内；`Escape`、右上角关闭和遮罩均可关闭；内部点击不得冒泡关闭。
- loading/error/empty 容器使用 `aria-live="polite"`；错误不能只依赖颜色表达。
- 入口使用原生 `button`，`aria-label` 包含任务标题，改进入口还需包含 `IMP-xxx`。
- 点击入口时阻止 pointer/click 冒泡，避免触发面板拖拽或任务详情。
- 保证键盘可滚动正文、焦点环清晰；遵守 `prefers-reduced-motion`。
- 正文与背景、等待色、错误色需在浅色/深色主题下保持可读对比度。

## UI 验收清单

- [ ] 主任务入口仅在 `awaiting_approval` 显示，离开状态立即消失。
- [ ] 每个 `waiting_plan_approval` 改进实例有独立且可区分的入口。
- [ ] 详情箭头、拖拽、收纳球、排序、任务绑定过滤无回归。
- [ ] 点击后才请求正文；主任务和改进项读取目录正确。
- [ ] 模态始终显示只读/不会批准提示，且没有写状态操作。
- [ ] loading、success、empty/TBD、404、403、网络错误、重试均有明确 UI。
- [ ] 长 Markdown、表格、代码、长标题和相对链接可用且不溢出。
- [ ] HTML 相对链接使用 sandbox；非法路径被阻止并反馈。
- [ ] Escape、遮罩、关闭按钮、焦点进入/返回和焦点约束符合预期。
- [ ] 浅色/深色、360px 桌面浮窗和移动端底部面板视觉一致。
- [ ] 关闭预览后仍停留在当前聊天和浮窗上下文。

## Review Request

请用户/主会话审阅 `ui-prototype.html`，重点确认：

1. 入口放在状态元信息之后是否清晰且不挤压 360px 卡片；
2. 改进项文案「计划审批书 · IMP-xxx」是否足够区分实例；
3. 只读提示与“必须回绑定聊天明确批准”的边界是否足够醒目；
4. 桌面居中模态、移动端底部近全屏预览是否符合现有体验。

**在获得明确 UI 审批前，不进入生产实现阶段。**
