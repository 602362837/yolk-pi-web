# UI：Antigravity 多账号、额度与顶栏接入

## 门禁状态

**已交付 UI HTML 原型门禁。**

本任务涉及 Models 账号管理、Settings 开关、顶栏 standalone/compact/aggregate、failover 反馈和用户可见信息结构变化。
UI 设计员已交付 task-local 交互式原型 HTML，文件路径及说明如下：

- **HTML 原型路径**：[antigravity-provider-multi-account-quota-prototype.html](./antigravity-provider-multi-account-quota-prototype.html)
- **审查与交付说明**：原型为自包含的交互式设计，包含了状态矩阵（no_account, loading, live_single_window, live_multi_model, fresh, stale, reauth, invalid_project, switching, no_usable_account），且不依赖生产 API 或真实 Token。

---

## 交互设计说明与状态矩阵

### 1. 三处体验实现细则

#### A. Models → Antigravity
- **路径**：`components/ModelsConfig.tsx`
- **内容**：
  - **提供商标题与标识**：包含 Google/Antigravity 标识，显示未连接或已连接的账号数量。
  - **单一 OAuth 添加入口**：复用 SSE 浏览器 OAuth 并支持手工粘贴 redirect URL 的降级路径，不提供 JSON 导入以确保凭证安全。
  - **安全与通道风险披露**：醒目标识该通道为非官方通道，OAuth 授权包含 GCP `cloud-platform` 宽 scope，明确告知用户隐私边界。
  - **已存账号列表**：支持设置别名/备注、Active 状态高亮、重新激活 (Activate)、重新登录 (reauth recovery) 与删除保护 (Active 账号不允许直接删除)。
  - **配额详情看板**：按模型展示 `remainingFraction` 对应已用百分比，不进行跨模型求和或平均。
  - **数据世代隔离**：切换/激活账号时立即清空上一状态 of quota 数据，使用 AbortController 与 generation ID 阻断异步竞态闪回。

#### B. Settings → Antigravity
- **路径**：`components/SettingsConfig.tsx`
- **内容**：
  - 左侧导航与 ChatGPT / Grok / Kiro 并列新增 "Antigravity"。
  - **开关 1**：`显示 Antigravity 用量悬浮面板` (`antigravity.usagePanelEnabled`)，默认关闭。
  - **开关 2**：`明确限额或限流时自动切换可用账号` (`antigravity.autoFailover.enabled`)，默认关闭。
  - **降级文案**：明确提示 Model-aware 行为与 fail-closed 安全阻断机制。

#### C. 顶栏 (Topbar & Aggregate)
- **路径**：`components/AppShell.tsx`
- **内容**：
  - **Standalone Compact/Full 模式**：
    - 处于 `live_single_window` 且有单一安全模型额度时，显示单用量 ring 环。
    - 处于 `live_multi_model` 多模型或无可信 duration 时，显示为 `多模型/详情` 文本，降级至 detail-only，不伪造用量 ring。
    - 状态异常时展示 `需登录`、`不可用` 等状态短语。
  - **Aggregate 模式**：平铺列布局扩展为第四列，不引入跨 provider 总额度百分比计算。

### 2. 状态矩阵与交互反馈

| 场景 | 顶栏状态显示 | 悬浮详情/Models面板内容 | 自动切号候选资格 |
| --- | --- | --- | --- |
| **no_account** | `Antigravity 登录` (Warning) | 引导 Models 绑定账号与风险安全披露 | 否 |
| **loading** | `加载中...` | 展示 skeleton/骨架加载态，阻断重复操作 | 否 |
| **live_single_window** | 单 ring 环 + `Antigravity (85%)` | 呈现单模型可用额度与 resets 倒计时 | 是 (仅针对对应匹配的模型) |
| **live_multi_model** | `多模型/详情` (无 ring) | 平铺展示各个模型的独立额度，禁止总数求和 | 针对当前请求模型独立进行额度判断 |
| **fresh** | 环/文本取决于单/多模型 | 显示当前缓存数据为新鲜状态 | 是 |
| **stale** | ⚠️ `缓存过期` (Warning ring) | 显示缓存历史配额并展示过期警示，提供手动刷新按钮 | 否 |
| **reauth** | 🚨 `需登录` (Danger) | 弹出 401 警告，提供重新登录链接 | 否 |
| **invalid_project**| 🚨 `不可用` (Danger) | 弹出 403 警告，提示 GCP projectId 无访问权限 | 否 |
| **switching** | `正在切换...` | 禁用账号交互操作，在 Chat/SSE 区域发布 failover 切号事件通知 | 不重复触发 |
| **no_usable_account**| 🚨 `无可用额度` | 显示所有账号均已耗尽，并在 Chat/SSE 提示 fail-closed 阻断，不展示 Retrying | 否 |

### 3. 响应式与可访问性设计 (A11y)
- 支持 `320px` / `375px` / `640px` 与自适应桌面宽度，确保顶栏不与 System / Subagents 遮挡，且悬浮面板在垂直方向安全滚动。
- 气泡与 Aggregate 面板提供 Tab/Shift+Tab 键盘焦点流，支持 `Escape` 键及点击外部区域关闭，关闭后恢复原有焦点。
- progressbar 正确绑定 `aria-valuenow` 等无障碍描述。
- 状态展示不只依赖红/绿/黄等颜色标记，提供文字及图标作为复合语义支撑。

---

## 给架构师与实现员的实现备注 (Implementation Notes)
- 顶栏 Aggregate 面板扩展仅限扩展 Column 4，保持平铺模型不改变原有 Grok/Kiro 数据 owner。
- Models 账号切换的 Generation 逻辑在 Models UI 进行，避免直接在 global 存储增加多进程冲突。
- 所有 API / SSE / DOM 端点**严格禁止**包含 raw credentials、token 或 GCP ProjectId。

---

## 交付与确认请求 (Review Request)
已在 `./antigravity-provider-multi-account-quota-prototype.html` 生成完整原型的代码实现，主会话可拉起本地浏览器，选择不同的“测试场景”或“用量显示配置”进行交互操作审阅。
请架构师复核并确认原型是否满足需求，确认后即可进行 `implementationPlan` 的保存并准备 transition。
