# UI：Grok CLI 重新登录原型门禁

## 门禁结论

**触发 UI 原型门禁。** 本任务改变 Models → Grok 的账号行操作、登录失效信息结构、确认体验、OAuth 方法选择与成功/失败反馈，并增加 Top-bar 到目标账号的恢复路径。

进入实现前必须由 **UI 设计员（`ui-designer`）** 基于当前 `ModelsConfig`、`GrokQuotaView`、`GrokUsagePanel` 和项目 CSS token 产出自包含 HTML 原型，并由主会话/用户审批。

当前架构师成员会话没有可用的 Studio member delegation 工具，未能实际派发 UI 设计员。以下内容是主会话应直接交给 UI 设计员的任务契约，不是 HTML 原型，也不能替代原型。

## UI 设计员委派契约

### 目标

为 Grok managed OAuth accounts 设计“指定账号原位重新登录”体验。优先复用现有 Models 双栏 modal、账号列表、quota 卡片、AppPrompt dialog 和现有主题变量，不引入第二套账号管理视觉体系。

### 必须阅读

1. [brief.md](./brief.md)
2. [prd.md](./prd.md)
3. [design.md](./design.md)
4. `components/ModelsConfig.tsx`
5. `components/GrokQuotaView.tsx`
6. `components/GrokUsagePanel.tsx`
7. `components/AppPromptDialog.tsx`
8. `app/globals.css`
9. 既有 Grok 用量原型：`../20260715-151549-为-grok-提供商增加类似-gpt-的用量小组件与开关配置/grok-usage-panel-prototype.html`

### HTML 交付

已交付自包含 HTML 原型：[grok-cli-reauth-prototype.html](./grok-cli-reauth-prototype.html)

必须是自包含、可点击演示的 HTML；`ui.md` 的文字说明不能替代该文件。

### 必须覆盖的页面/状态

1. **有效账号默认态**
   - Active 与非 Active 两种账号行。
   - 每行有清晰但不过度拥挤的“重新登录”入口。
   - 备注、详情、查看、启用、删除、quota 刷新与新入口的层级合理。

2. **已有账号但 provider `loggedIn=false`**
   - Grok 仍出现在 Models 左侧已有订阅/账号管理区域。
   - Header 不误称“没有账号”，表达“已保存 N 个账号，当前凭据需恢复”。

3. **选中账号 `reauthRequired`**
   - `GrokQuotaView` 危险 banner。
   - 明确账号摘要和“重新登录此账号”CTA。
   - 有 stale quota 时旧数据保留但标为旧缓存；无缓存时不伪造额度。

4. **重新登录确认 dialog**
   - 显示目标显示名、masked id、Active/非 Active 影响。
   - Active：成功后仍为全局 Active，影响当前/新会话后续请求。
   - 非 Active：成功后不会改变全局 Active。
   - 明示“系统无法可靠验证与原 xAI 身份相同，请在浏览器确认账号”；不要用误导性的“验证同一账号”。

5. **登录方法选择**
   - Browser PKCE（推荐）
   - Device Code（远程/headless）
   - 复用 Grok Build (`~/.grok/auth.json`)
   - 取消与返回。

6. **OAuth 过程状态**
   - connecting、auth/manual callback、device code、progress、fallback select、取消。
   - 操作期间目标行和冲突操作 disabled；其他无关账号仍可读。

7. **终态**
   - Active 成功：“已更新全局 Active 凭据”。
   - 非 Active 成功：“账号凭据已更新，未改变全局 Active”。
   - 失败可重试，原账号不变。
   - 取消无错误。
   - 授权期间账号被删除/变化的冲突提示。

8. **Top-bar 恢复路径**
   - standalone 与 aggregate 的 Grok `reauthRequired` 详情。
   - 点击“在 Models → Grok 重新登录”后展示聚焦目标账号的 Models 状态。
   - 不直接从悬浮层启动外部 OAuth。

9. **窄屏与长内容**
   - 375px 下 Models/账号行动作可用，不横向溢出。
   - 长 label、masked id、错误文案、device code。
   - light/dark 至少可切换或并排说明。

### 交互建议

- 推荐“账号行 CTA + quota banner CTA”复用同一 reauth controller。
- 推荐先确认影响，再显示登录方式；不要一点账号行就立即打开浏览器。
- 推荐使用现有 AppPrompt confirm 的视觉语法；若信息量超出 confirm 能力，可设计专用小 modal，但必须说明为何不能复用。
- 推荐成功后保持 Models 打开并选中原账号，展示 quota 强刷进度；不要自动关闭整个 Models。
- 登录方式使用上游真实 id 语义 `browser | device | existing`，UI 可使用中文标签。

### 可访问性

- Dialog 使用 `role=dialog`、`aria-modal=true`，打开后初始焦点明确，Escape 可取消，关闭还焦触发按钮。
- 危险/成功状态有文本和 `role=alert/status`，不只依赖颜色。
- 每个账号行按钮有包含账号语境的 accessible name。
- Device code 可选择/复制；复制成功有 polite feedback。
- 窄屏触控目标建议至少 36px。

## UI 审批请求模板

HTML 原型完成后，主会话需请用户重点确认：

1. “重新登录”是原位替换账号槽位，而不是新增账号；
2. Active/非 Active 的影响说明是否足够清楚；
3. 无法强校验同一 xAI 身份的风险文案；
4. 账号行操作密度和 375px 响应式布局；
5. Top-bar 只深链 Models、不直接启动 OAuth；
6. 完整 loading/success/error/cancel/conflict 状态。

**未获得 HTML 原型和用户明确审批前，不得进入实现。**
