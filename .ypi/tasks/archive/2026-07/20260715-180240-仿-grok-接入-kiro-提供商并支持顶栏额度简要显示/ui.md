# UI：Kiro 账号/额度与顶部简要模式

## 门禁状态

**已满足 UI HTML原型门禁。**

HTML原型文件路径：
`./kiro-provider-usage-compact-prototype.html`

本任务包含：
- 新增 Models → Kiro OAuth多账号与额度 UI；
- 新增 Settings 左栏分节导航并并列加入 Kiro 分节（与 Grok/ChatGPT 具有同等的放置与视觉风格）；
- 新增 Settings → Kiro 开关与说明；
- 新增 Settings全局「顶部额度组件简要显示」开关（置于 Usage 分节）；
- 改变 GPT/Grok顶栏 trigger信息密度，并新增 Kiro trigger/panel；
- 改变可见状态、切号提示和窄屏布局。

## 状态矩阵与交付说明

| 场景 / Kiro 状态 | 顶栏简要显示 | 顶栏详细面板 | Models 配置区域 | 自动切号候选 |
| --- | --- | --- | --- | --- |
| **未配置账号 (no_account)** | `Kiro 登录` | 提示未登录，提供 Models 链接 | 显示空列表与 OAuth 选项 | Fail-closed |
| **正在刷新中 (loading)** | `Kiro 加载中` (带 Spinner) | 显示“正在从 GetUsageLimits 读取...” | 列表展示只读加载态 | Fail-closed |
| **实时正常 (live)** | `Kiro 剩余 125M` | 展示 AWS Credits & Requests 详情与 progress bar | 完整操作卡片与 progress bar | 正常候选 |
| **缓存陈旧 (stale)** | `Kiro 已缓存` | 详细信息卡片 + 橙色警告条与刷新失败提示 | 警示文字与刷新失败降级提示 | Fail-closed |
| **需要重新登录 (reauth)** | `Kiro 需登录` | 红色错误条，提示凭证过期失效 | 各账号 relogin 入口与过期高亮 | Fail-closed |
| **额度不可用 (unavailable)**| `Kiro 不可用` | 橙色警告条，提示 Region / ValidationException | 仅展示账号列表，额度卡片提示错误 | Fail-closed |

## 状态与用户反馈修订说明

1. **Settings 放置风格已按用户反馈修订**：
   - 生产环境 `components/SettingsConfig.tsx` 是「左侧分节导航 + 右侧具体内容」的布局。
   - 原型已被修订，从原先的「单页堆叠卡片」布局改为完全一致的左导航布局：左侧导航加入并列的 **ChatGPT**、**Grok**、**Kiro**（新增，与 Grok 视觉、文案结构完全对齐）等分节。
   - 全局简要显示（Compact Mode）开关属于全局控制，已统一且唯一放置在 **Usage** 分节中。
   - Kiro 专有的 `Kiro 用量悬浮面板` 及 `明确限额或限流时自动切换可用账号` 开关与说明则放置在 **Kiro** 分节下。这解决了 Kiro 放置风格异于 ChatGPT 和 Grok 的问题。

## 待用户确认点

1. **全局还是单 Provider 控制 Compact 模式？**
   - 架构与设计均推荐**全局控制**，因为在窄屏与多 Provider 同显时，若单独控制将导致严重的信息密度不对齐与顶栏跳变。
2. **Kiro Compact 模式主数字的选择：**
   - 原型中主数字使用了剩余额度值：`Kiro 剩余 124.5 USD` (简化显示为 `剩余 125M` 以配合 AWS 额度特征)。相较于使用率百分比，由于 AWS 包含不同维度的 buckets (如 Credits 和 Agentic Requests)，点数剩余值是用户最核心关注的指标，故优先采纳点数剩余值。
3. **Failover 候选账号的额度未知判定：**
   - 一律禁止作为自动切换候选 (Fail-closed)。

## 推荐文案
- 自动切号时 Chat 界面通知：“`[Kiro 账号切换通知] 检测到当前 Active 账号已达到 AWS 额度上限。正在自动切换到备用账号...`”
- Kiro 账号激活说明：“`Activate 只设置 Kiro 的全局当前 Active，不属于锁定。切换将作用于所有 live/new Session 后续请求，in-flight 请求不换 Token。`”
