# UI：Settings → Links → GitHub Device Authorization

## UI Summary

- **设计目标**：把 Settings → Links 的默认体验从 token 粘贴改为 **GitHub OAuth Device Flow**：点击连接 → 展示短期 user code 与官方验证页 → 服务端轮询授权 → 显示安全身份摘要与多账号管理。
- **用户价值**：终端用户无需创建 OAuth App，也无需理解/创建/粘贴任何 secret；只需在 GitHub 官方页面输入设备码并批准。
- **信息架构**：Settings 左侧 root-level `Links` leaf（Studio 之后、模型与用量之前）→ 单 provider 卡片 GitHub → 空态/授权面板/活动连接列表。
- **保存语义**：Links CRUD/授权即时生效；全局 Save/Reset 在 Links view 禁用并明确说明仅作用于 `pi-web.json`。

## 用户路径

1. 打开 Settings → Links。
2. 空态点击 **连接 GitHub**（主按钮）。
3. 若产品 OAuth client 未配置：显示不可用状态，**不**退回 token 输入。
4. 启动成功：显示短期 user code、复制、打开 `https://github.com/login/device`、剩余时间、等待进度。
5. 可选：popup 被拦截时仍可手动打开官方验证页。
6. 服务端独立轮询；SSE 可断线重连；成功后刷新活动连接卡片。
7. 可继续连接另一个不同 GitHub identity；重复 identity 显示 409 并高亮现有卡片。
8. 断开：确认「只删除本机 OAuth 凭据，不撤销 GitHub 远端授权」→ busy → 成功移除或失败保留。

## HTML 原型

- **文件**：[links-github-connections-prototype.html](links-github-connections-prototype.html)
- **形式**：自包含 HTML（CSS + 轻量状态切换脚本），适合 task-local CSP sandbox preview。
- **主路径**：**无 token/PAT 输入**。默认主操作是「连接 GitHub」与 Device Flow 设备码面板。
- **原型控制器可切换**：
  - 加载、空态、OAuth 未配置
  - 启动 busy、设备码等待、弹窗拦截、slow_down
  - 拒绝、过期、本机取消、网络/超时、SSE 重连
  - 成功单账号、多账号、重复 identity 409、列表加载失败
  - 断开确认 / busy / 失败
  - light/dark、≤640px、keyboard focus、reduced motion

## 状态矩阵

| 场景 | 展示 | 用户操作 | 反馈 |
| --- | --- | --- | --- |
| 加载 | skeleton + “正在读取本机 GitHub 连接” | 无 | aria-busy |
| 空态 | 说明 Device Flow；主按钮连接 GitHub | 连接 | 进入启动/设备码 |
| 未配置 | warning：缺少产品 client id | 连接按钮 disabled | 不出现 token 表单 |
| 启动 | busy “联系 GitHub Device Flow” | 取消 | 取消 → cancelled |
| 设备码 | user code、复制、打开官方页、倒计时、步骤条、等待 | 复制/打开/取消 | 可选择复制码；不展示 device_code |
| 弹窗拦截 | warning + 手动打开主按钮 | 打开官方页 | 仍继续等待 |
| slow_down | 中性 info：轮询已放慢 | 继续等待/取消 | 非失败 |
| 拒绝 / 过期 / 网络 | 安全错误文案 | 重新连接 | 无凭据落盘 |
| 取消 | 本机已停止轮询 | 重新连接 | 不静默接收稍后批准 |
| SSE 重连 | info + 当前 user code/等待 | 继续 | 后台授权不因断线取消 |
| 成功 | 成功条 + 连接卡片 | 连接另一个 / 断开 | 无 token |
| 多账号 | ≥2 张独立卡片 | 各自断开 | 身份/scope 不串号 |
| 重复 409 | warning + 高亮现有卡片 | 先断开或连其他账号 | 现有 secret 不变 |
| 断开确认 | AppPrompt 风格 alertdialog | 取消/确认 | 文案明确远端不撤销 |
| 断开 busy/失败 | 仅目标卡片 busy；失败保留 | 重试 | 不伪造成功 |

## 安全 UI 边界

- **可显示/复制**：GitHub 为用户设计的短期 `userCode`。
- **永不进入浏览器**：`device_code`、access/refresh token、client secret、Authorization header、上游 raw body。
- **不提供**：token/PAT 输入、import、reveal、copy token、masked token、fingerprint。
- **scopes**：请求固定 `read:user`；区分 requested / granted；不推断 repo 权限。
- **终态清理**：取消、过期、拒绝、切 view、unmount 后清除 user code 与倒计时（实现约束；原型用状态切换表达）。

## 实现说明

### 推荐复用

- `SettingsTreeNavigation` / Settings modal tree 与 responsive shell。
- `AppPromptProvider` 断开确认与 focus restore。
- 主题变量：`var(--bg*)`, `--text*`, `--border`, `--accent`, success/warning/danger。
- `ModelsConfig` device-code 交互仅作参考；**不得**复用 `/api/auth/login`、OAuth account store 或 ModelRuntime。

### 组件与改动点

- 新增 `components/LinksConfig.tsx`：catalog、authorization、SSE、connections、disconnect owner。
- `SettingsTreeNavigation.tsx`：稳定 leaf `links`（Studio 后）。
- `SettingsConfig.tsx`：渲染 Links view；不参与 web-config dirty/save。
- `app/globals.css`：设备码面板、连接卡片、错误/窄屏/focus/reduced motion。

### 响应式与可访问性

- ≤640px 单列；user code 可键盘选择/复制；外链有明确名称。
- 状态不只靠颜色；确认框 focus trap/restore；`aria-live` 适度播报，避免高频闪烁。
- reduced motion 关闭 spinner/进度位移动画。

## Review Request

- 请用户审阅 [links-github-connections-prototype.html](links-github-connections-prototype.html)。
- **用户批准本 HTML 与 plan-review 前，不得进入生产实现。**
- 批准后实现员必须以本原型为 UI 验收基线；偏离需重新审批。

## UI Checks

- [ ] 默认主操作是「连接 GitHub」，无 token/PAT 表单。
- [ ] 设备码状态含 user code、复制、官方验证页、过期提示、安全说明。
- [ ] 未配置状态 fail closed，不回退 token 输入。
- [ ] 多账号卡片独立可读/可断开；重复 409 高亮现有连接。
- [ ] 断开确认明确“只删本机凭据，不撤销 GitHub 远端授权”。
- [ ] 全局 Save/Reset 禁用/弱化且有即时保存说明。
- [ ] light/dark、窄屏、键盘 focus、reduced motion 可用。
- [ ] DOM/Network 检查无 access token / device_code。
