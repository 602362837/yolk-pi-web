# UI：Models 端点同步模型列表

## UI 原型门禁状态

**触发门禁：是。原型已交付，待用户审批。**

自包含交互原型：[`models-endpoint-sync-prototype.html`](./models-endpoint-sync-prototype.html)

本任务改变 `ModelsConfig` 的 provider detail 信息结构，并新增预览、勾选、确认、快捷写入、错误恢复和结果反馈。UI 设计员已基于现有 `ModelsConfig`、`AppPromptDialog`、`Checkbox` 与 `pi-modal` 样式完成原型；用户批准前仍不得进入实现。

### 原型场景切换

- 使用页面顶部场景标签切换可同步、禁用原因、Built-in / Fixed、Loading、Empty、Mixed、All existing、两类确认、Success、Errors / Busy 与 375px 场景。
- “禁用原因”场景底部可继续切换 dirty draft、未保存 provider、无效 Base URL、非 OpenAI API。
- “Errors / Busy”场景内可切换认证失败、超时/网络、无效响应/过大、预览过期与 Apply busy。
- “Mixed”与“375px”场景支持真实搜索、逐项勾选新增模型、全选新增、清空选择；两个写入按钮都会进入对应 AppPrompt 风格确认。

### 已覆盖关键状态

1. clean eligible 入口可用；
2. dirty draft、未保存 provider、无效 Base URL、非 OpenAI 协议的禁用原因；
3. Built-in / fixed provider 不展示同步入口；
4. preview loading、remote empty、mixed、all existing；
5. 选择性写入确认、全部新增快捷写入确认；
6. success 结果与 added/skipped/不覆盖摘要；
7. auth、timeout/network、invalid/too large、stale revision、apply busy；
8. 375px 下全屏二级 modal、纵向 footer actions 与可滚动模型列表。

### 已固定设计决策

- 同步区域位于 Provider API 字段之后，作为独立配置卡片；使用“仅新增”“需确认”文字标签表达安全边界。
- 二级预览 modal 宽 720px，沿用 860px Models split modal 的深色主题、紧凑字号、5–7px 圆角和 mono model id。
- Mixed 默认全选全部新增模型；已存在模型保持可见但 checkbox 禁用，避免误解为远端镜像。
- “写入所选”与“全部新增并写入”视觉层级不同，但都必须二次确认；快捷路径不直接写盘。
- 成功结果留在预览 modal 内，由用户点击“完成”关闭；随后实现应刷新 Models 树并保持 provider 选中。
- 原型不展示 apiKey、headers、完整端点或 raw upstream error；API Key 字段仅以掩码表现。

## 设计依据与实现交付契约

### 必读材料

1. `components/ModelsConfig.tsx`：`ProviderDetail`、主 split modal、左侧 custom provider/model tree、footer Save。
2. `components/AppPromptDialog.tsx` / `components/AppPromptProvider.tsx`：确认与结果提示模式。
3. `components/SelectDropdown.tsx`、`components/Checkbox.tsx`：现有控件语言。
4. `app/globals.css`：`pi-modal-*`、主题变量、窄屏规则。
5. 本任务 `brief.md`、`prd.md`、`design.md`。

### 设计目标

- 保持现有 Models 860px split modal 和轻量配置工具风格，不引入第二套视觉系统。
- 让“远端发现”明显区别于“Save models.json”和“Test model connection”。
- 默认安全：先预览，再确认；快捷动作不能静默写入。
- 明确传达 merge 语义：“只新增，不覆盖、不删除”。
- 不展示/回显 apiKey、headers 或远端 raw error。

## 推荐信息架构

### 1. Provider Detail 同步区域

位置：`ProviderDetail` 的 API 字段之后，作为独立的“Model discovery / 模型发现”区块。

内容建议：

- 标题：`从端点同步模型`
- 辅助说明：`读取已保存 Base URL 的 OpenAI-compatible /models 列表。只新增模型 ID，不覆盖已有价格和手工配置。`
- 主入口按钮：`预览远端模型`
- 安全 tag：`仅新增` / `需确认`

资格状态：

| 场景 | 入口表现 |
| --- | --- |
| clean + custom + OpenAI + valid baseUrl | 可用按钮 |
| Models 有未保存更改 | 禁用，说明“请先保存当前 Models 更改” |
| provider 尚未保存 | 禁用，说明“请先保存提供商” |
| API 为 Anthropic/Google | 禁用或隐藏，若显示则说明“仅支持 OpenAI-compatible API” |
| baseUrl 缺失/无效 | 禁用并指向 Base URL 字段 |
| built-in/OAuth/API-key/fixed provider detail | 不出现可执行同步入口 |

### 2. Preview Modal

建议是叠加于 Models modal 之上的二级 modal，宽度约 680–760px，移动端全屏/接近全屏。

Header：

- `从端点同步模型`
- provider id（mono，可截断）
- 关闭按钮

Summary row：

- `远端 42`
- `新增 12`
- `已存在 30`
- 安全说明：`只会写入新增模型 ID`

Toolbar：

- 搜索框：`搜索模型 ID…`
- `全选新增`
- `清空选择`
- 选择计数：`已选 8`

List/table row：

- checkbox（只有新增项可选）
- model id（mono，ellipsis + title）
- optional owned-by（弱化，仅预览）
- 状态 tag：`新增` / `已存在`

Footer：

- `取消`
- 普通主路径：`写入所选（N）`
- 快捷路径：`全部新增并写入（N）`

两个写入动作都必须进入明确确认；不得直接在 click 时写盘。

### 3. Confirm

复用 AppPrompt confirm，文案必须区分动作：

**选择性写入**

- 标题：`确认写入 N 个模型？`
- 内容：`将向 provider-id 追加 N 个模型 ID。已有模型、价格、手工字段和 modelOverrides 不会被覆盖；远端缺失的本地模型不会删除。`
- 按钮：`返回预览` / `确认写入`

**全部新增快捷写入**

- 标题：`写入全部 N 个新增模型？`
- 内容同上，并标明这是全部新增项。
- 按钮：`取消` / `全部写入`

### 4. Result

成功后可在 modal 内切换为结果状态，再由用户关闭；或显示 status panel + toast。原型需明确一种一致方案。

必须包含：

- `已新增 N 个模型`
- `已跳过 M 个已存在模型`
- `没有覆盖已有配置`
- `完成` 按钮

完成后 Models 左侧树刷新并保持当前 provider 选中。

## 必须覆盖的原型状态

HTML 原型至少可切换展示以下状态：

1. Provider 可同步默认态。
2. Provider dirty/未保存禁用态。
3. 非 OpenAI protocol 禁用态。
4. Preview loading。
5. Mixed list（新增 + 已存在）与搜索结果。
6. Remote empty。
7. All existing。
8. Auth failed（401/403）+ 重试。
9. Timeout/network + 重试。
10. Invalid response/response too large。
11. Preview expired/stale revision，要求重新预览。
12. Apply busy，按钮防重复提交。
13. Success result。
14. 375px narrow layout。

## 错误文案建议

| code 类别 | 用户文案 |
| --- | --- |
| credential unavailable | `无法解析该提供商的已保存凭据，请检查 API Key 配置后重试。` |
| auth failed | `端点拒绝了凭据，请检查 API Key 或自定义认证 Header。` |
| endpoint not found | `未在已保存 Base URL 下找到 /models 或 /v1/models。` |
| timeout | `读取模型列表超时，请检查服务状态后重试。` |
| network | `无法连接到已配置的模型服务。` |
| invalid response | `端点返回的不是可识别的 OpenAI 模型列表。` |
| too large | `远端模型列表超过安全读取上限。` |
| stale revision | `Models 配置已发生变化，请重新预览后再写入。` |
| unsupported | `仅支持已保存的自定义 OpenAI-compatible 提供商。` |

禁止显示 raw upstream body、完整 Authorization、custom header 或 key。

## 交互与可访问性要求

- 二级 modal 有 `role="dialog"`、`aria-modal="true"`、标题关联、focus trap 和关闭后焦点恢复。
- Escape 关闭非 busy modal；apply busy 时需明确是否阻止关闭或允许后台完成，不得产生重复提交。
- 搜索输入自动聚焦不应抢占确认弹窗焦点。
- 状态不可只靠颜色；tag 有文字。
- checkbox 有可读 label；已存在项 disabled 原因可感知。
- 长 model id 省略但 hover/focus 可看完整值。
- 375px 下 footer actions 可纵向排列；列表保持可滚动，header/footer 固定。
- `prefers-reduced-motion` 下关闭装饰动画。

## 推荐复用

- 主题变量：`var(--bg)`、`var(--bg-panel)`、`var(--bg-hover)`、`var(--bg-selected)`、`var(--border)`、`var(--text*)`、`var(--accent)`。
- 现有 `pi-modal-overlay` / `pi-modal-panel`。
- `Checkbox`、AppPrompt confirm/toast。
- Models 中现有 11–13px 字体、mono id、5–7px 圆角和紧凑 toolbar。

## UI 审批请求

请用户审阅并批准 [`models-endpoint-sync-prototype.html`](./models-endpoint-sync-prototype.html)，重点确认：

1. Provider detail 中同步入口的位置、说明与禁用原因是否清晰；
2. 预览列表默认全选新增、已存在项不可选的选择逻辑；
3. “写入所选”与“全部新增并写入”两条二次确认路径；
4. 成功结果、错误重试、stale revision 与 busy 防重复提交反馈；
5. 375px 下全屏预览与纵向操作按钮布局。

用户批准原型与 `plan-review.md` 前不得进入 implementing；若需调整，请先更新 HTML 原型并重新请求审批。