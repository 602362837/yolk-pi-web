# UI：SuperGrok 登录、账号与额度（原型准备说明）

## 门禁结论

**触发 UI HTML 原型门禁。** 本任务新增用户可见 provider、OAuth 登录方式、多账号激活/删除、会话账号归属与额度状态。

已产出可直接打开并交互验证的完整 HTML 原型：
[supergrok-oauth-accounts-prototype.html](./supergrok-oauth-accounts-prototype.html)

## 原型设计与交互核心

1. **登录方式选择：** 支持 Browser 登录 (OAuth PKCE) 和 Device Code 激活登录。同时提供说明文字，明确 `GROK_CLI_OAUTH_TOKEN` 环境变量绕过的只读属性及其不支持自动刷新的限制。
2. **多账号管理与 Active 状态：** 
   - 标注 ACTIVE 标识表明其为新会话的默认账号（同时镜像到 `auth.json`）。
   - 明确提示并发会话隔离 (Session Pinning) 的产品语义：“已绑定的并发会话: N 个”。
3. **安全删除与迁移逻辑：**
   - 阻止直接删除 Active 账号，须先激活其它账号或进行断开处理。
   - 当删除存在活跃会话绑定的账号时，弹窗提供安全选项：允许一键将受影响会话迁移至当前 Active 账号，或强制删除以在会话中手动重绑。
4. **额度卡片 (Quota Card)：**
   - 完整展示 Monthly 额度（Used/Limit/ResetsAt，且包含使用百分比进度条）。
   - 动态判定 Weekly 额度（有周额度的订阅展示比例，无则显示未包含说明）。
   - 实现缓存状态说明（数据新鲜、Stale 缓存降级、凭证失效/需要重新登录）。

## 后续指派

主会话需派发 **UI 设计员**，要求其读取：

- `components/ModelsConfig.tsx`（重点 `OAuthDetail`、OpenAI Codex saved-account UI、OAuth SSE 状态）
- `components/ChatGptUsagePanel.tsx`（额度的 loading/stale/refresh 表达参考）
- `components/ModelSelect.tsx`、`components/ChatInput.tsx`（provider/model 选择上下文）
- `app/globals.css` 的 modal/model/auth 样式与 CSS variables
- 本任务 `brief.md`、`prd.md`、`design.md`

## HTML 原型交付

- 任务目录文件建议：`supergrok-oauth-accounts-prototype.html`。
- `ui.md` 后续改为链接该 HTML，并记录用户审批结论；纯 Markdown 不满足门禁。
- 原型应复用现有深浅主题变量和 Models 设置弹窗信息架构，不另造独立设置应用。

## 必须覆盖的页面/组件

1. Models → Grok CLI provider detail：未连接 / 已连接。
2. 登录方式选择：Browser、Device code、可用时 Existing Grok Build；说明 external env token 不可刷新。
3. OAuth 状态：打开浏览器、手工粘贴、device code 倒计时、progress、cancel、error、success。
4. 多账号卡片：备注、masked identity、ACTIVE、当前会话引用/数量（若实现查询）、last activated、quota last updated。
5. 额度卡：monthly used/limit/remaining/reset；weekly 可选；fresh/loading/stale/error/reauth required。
6. 操作：添加、重新登录、激活、编辑备注、刷新额度、删除。
7. 风险确认：删除 active、删除被会话引用账号、迁移会话或取消。
8. active 语义文案：推荐“激活作为新会话默认账号；已有会话继续使用其已绑定账号”。
9. 空、慢网、429、5xx、refresh 失败、weekly 缺失、账号无额度权限等状态。
10. 桌面和窄屏布局、键盘焦点、dialog semantics、减少动态效果。

## 审批阻塞

在以下事项完成前不得建议进入 implementing：

- 用户确认 session-account pinning 产品语义；
- 用户确认是否接受加载 `pi-grok-cli` 完整扩展能力；
- UI 设计员 HTML 原型已产出；
- 用户明确审批原型与计划。
