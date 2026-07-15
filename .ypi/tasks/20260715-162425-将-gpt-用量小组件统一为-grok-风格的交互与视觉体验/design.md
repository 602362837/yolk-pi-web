# Design：GPT 用量小组件统一为 Grok 风格

## 方案摘要

采用“**交互壳对齐、provider 状态隔离、现有 API 原样复用**”方案：

- 以当前 `GrokUsagePanel` 的 pill、viewport-clamped fixed 面板、关闭/焦点/窄屏模式为视觉和交互基准，重构 `ChatGptUsagePanel`。
- GPT 继续直接消费 `SubscriptionQuota`、`QuotaDisplayTier[]`、账号 metadata `quotaCache`、Reset credits 与 scheduler 状态；不转换成 `GrokQuotaResultV1`，不引入 Grok 的 `live/fresh/stale/none` TTL 语义。
- `AppShell` 仅给 GPT 接入现有 Models 打开回调；保留单一 `.app-top-usage-panel`、GPT → Grok 顺序和一次右侧安全留白。
- 本任务**不抽取通用 provider shell/ring 组件**。当前两个组件的 cache 状态、颜色阈值、额度字段、错误语义和专属操作差异较大；为少量 JSX 原语改动已稳定的 Grok 会放大回归面。实现时按 Grok 结构对齐，但保持 GPT 内部局部 `UsageRing` / `StatusDot`。待两者稳定且有行为测试后，再单独评估 provider-neutral 原语抽取。

## 影响模块与边界

| 模块 | 计划变更 | 明确边界 |
| --- | --- | --- |
| `components/ChatGptUsagePanel.tsx` | 重构状态编排、中文投影、pill、fixed 面板、键盘/焦点、账号/刷新/Reset/scheduler 分区 | 不改变 quota、Reset、Activate、scheduler API schema |
| `lib/quota-display.ts` | 可增加 GPT 中文 tier/相对时间等纯展示 helper | 不改变现有 `QUOTA_TIER_LABELS` / `formatQuotaQueriedAt`，避免影响 Models 现有文案 |
| `components/AppShell.tsx` | 向 GPT 面板传 `onOpenModels` | 不重做 usage host、不改顺序/留白/Settings 配置 |
| `app/globals.css` | 仅增加 GPT spinner/focus/reduced-motion 所需的窄小 class（如确有需要） | 不改变 Grok quota 语义或全局 topbar 布局算法 |
| `scripts/test-chatgpt-usage-panel.mjs`（建议新增） | 覆盖纯 helper、安全文案和关键接线契约 | 不以测试脚本替代浏览器交互验收 |
| `docs/modules/frontend.md`、必要时 `docs/modules/library.md` | 更新 GPT 面板行为与 helper 说明 | API route 未变化，不宣称新增后端能力 |

`components/GrokUsagePanel.tsx`、`components/GrokQuotaView.tsx`、Settings/config 和 API routes 默认不修改。若实现员认为必须共享原语，应先报告范围变化，不得顺手重构 Grok。

## 前端状态模型

### 1. 账号状态

```text
accountsLoading
  ├─ success → accounts + activeAccount
  └─ failure → 固定中文 accountsError（不透传 body）

activeAccount
  ├─ null → 无账号 / 打开 Models → ChatGPT
  └─ accountId → 只展示该账号的 quota/cache/操作状态
```

- `GET /api/auth/accounts/openai-codex` 是账号列表、Active 和 metadata cache 的事实源。
- 初次挂载、面板展开、前台每 30 秒、window focus、visibility 恢复时只重读账号 metadata；页面隐藏时跳过。
- 轻量重读不能调用 quota 上游；卸载清理 interval、listener、AbortController。
- 如果外部操作改变 Active，新的账号响应应中止/失效旧账号 quota 请求，并按新 `accountId` 选择数据，不能短暂展示旧账号额度。

### 2. quota 展示来源

为当前账号派生 provider-specific 展示来源：

```ts
type ChatGptQuotaSource = "live" | "cached" | "page_fallback" | "none";
```

优先级：

1. 当前账号最近一次成功 quota GET → `live`；
2. 当前 accounts 响应中 `quotaCache.success === true` → `cached`；
3. 当前页面为**同一 accountId**保存的最后成功快照 → `page_fallback`；
4. 否则 `none`。

建议用 `Map<accountId, SuccessfulQuotaSnapshot>` 或等价 ref/state 保存本页成功快照。成功的 metadata cache 和成功 GET 都可更新对应账号快照；失败 payload 不覆盖成功快照。切换账号只读取目标账号 key，禁止跨账号回退。

显示文案：

| 来源/动作 | 文案 | 语义 |
| --- | --- | --- |
| quota GET 成功 | `实时` | 本次显式查询成功 |
| metadata quotaCache 成功 | `已缓存 · <相对时间>` | 账号 metadata 中已有成功缓存；不评价新鲜/过期 |
| 手动刷新失败且有同账号快照 | `刷新失败，正在展示本页上次成功数据` | 纯页面级回退，不伪装服务端 stale cache |
| 无成功数据 | `无缓存` / 明确空态 | 未知不显示为 0% |

不得使用 GPT 无法证明的“缓存新鲜”“缓存已过期”。

### 3. 操作状态与并发

保留独立状态，但统一用 `operationBusy = refreshing || resetting || activatingAccountId !== null` 约束冲突操作：

- **手动刷新**：仅当前 Active，调用现有 quota GET；建议显式带 `accountId` 以校验响应归属。旧内容保留，按钮/文字显示“正在刷新…”。
- **Activate**：POST 成功后立即采用响应中的新 Active，再查询该账号 quota。Activate 失败保留旧 Active；Activate 成功但 quota 失败时保留新 Active，并显示“账号已切换，额度刷新失败”。
- **Reset credits**：确认后调用现有 quota POST；成功结果更新当前账号成功快照和 accounts metadata，失败不清空旧额度。
- **scheduler status/reload/repair**：与 quota 操作可以按现有风险收敛为禁用冲突写操作；repair 必须继续使用危险确认文案。

所有 quota 请求使用 AbortController + request generation/accountId 一致性检查。开始 Activate 或发现 Active 改变时 abort 旧 quota；组件卸载时使所有 generation 失效。

## 视觉与交互契约

### 收起态

- 与 Grok 一致：26px pill、玻璃背景、999px 圆角、展开高亮、品牌 + 状态点/spinner + rings。
- 品牌为 `GPT`；状态为 `加载中 / 登录 / 实时 / 已缓存 / 无缓存 / 重新登录 / 错误 / 正在刷新…`。
- `five_hour` 显示 `5 小时`，`seven_day` 显示 `周`；未知窗口为空环或不显示，不伪造月度。
- trigger：中文 `title` / `aria-label`、`aria-expanded`、`aria-controls`。

### 展开态

- `position: fixed`，右侧优先对齐 trigger 后 clamp；宽 `min(392px, calc(100vw - 16px))`，左右至少 8px，max-height 视口内，内部滚动。
- 标题区：`ChatGPT 用量`、来源/更新时间、刷新按钮、显式关闭按钮。
- 主路径顺序：Active 账号 → 安全状态告警 → 5 小时/7 天额度卡 → 账号列表/切换 → Models 管理入口。
- 次级区顺序：Reset credits → 后台自动刷新 scheduler/lock。默认展开但视觉降级，保持当前运维信息可见。
- 外部点击关闭；Escape 关闭并还焦 trigger；显式关闭按钮关闭并还焦；滚动/resize 时重新 clamp。
- `role="dialog"`、`aria-live="polite"`、进度条 `role="progressbar"` + min/max/now；长账号字段 ellipsis + `title`。
- reduced-motion 下 spinner/非必要过渡停止，仍用“正在刷新/切换/重置”文字表达。

## API 复用与请求契约

不新增 route、不改变 schema：

| API | 用途 | 请求规则 |
| --- | --- | --- |
| `GET /api/auth/accounts/openai-codex` | 账号、Active、metadata quotaCache | 挂载/30 秒前台/focus/visibility/展开轻量重读 |
| `POST /api/auth/accounts/openai-codex/activate` | 设置 Active | 用户显式切换；成功后查询新 Active quota |
| `GET /api/auth/quota/openai-codex?accountId=<opaque>` | 当前账号 quota | 仅手动刷新或 Activate 后；不用于 30 秒轮询 |
| `POST /api/auth/quota/openai-codex` | 消耗 Reset credit | 现有 `{ accountId }` body 与确认流程不变 |
| `GET /api/chatgpt/usage-refresh/status` | scheduler/lock 投影 | 展开和显式重载 |
| `POST /api/chatgpt/usage-refresh/repair-lock` | 风险确认后 repair | 现有 `{ confirm: true }` 不变 |

`accountId` 继续是 saved-account opaque id；前端不读取真实 credential id 或 token。

## 错误与安全文案映射

客户端只按已知状态/操作上下文选择固定中文文案：

| 输入 | 固定投影 |
| --- | --- |
| `credentialStatus=expired` | `登录已失效，需要重新登录。` |
| `credentialStatus=not_found` | `未找到 OAuth 凭据，请在 Models → ChatGPT 重新登录。` |
| `credentialStatus=parse_error` | `无法读取 OAuth 凭据，请在 Models → ChatGPT 重新登录。` |
| accounts 请求失败 | `无法加载 ChatGPT 账号列表，请稍后重试。` |
| quota 网络/API 失败且无快照 | `无法获取额度，请检查网络后重试。` |
| quota 失败且有同账号快照 | `刷新失败，正在展示本页上次成功数据。` |
| Activate 失败 | `切换 Active 账号失败，已保留当前账号。` |
| Activate 成功、quota 失败 | `账号已切换，额度刷新失败。` |
| Reset 失败 | `Reset credits 消耗失败，未更新当前额度。` |
| scheduler 状态失败 | `无法读取后台自动刷新状态。` |
| scheduler `lastError` / `lastAccountError` 非空 | `最近一次后台刷新失败。` / `最近一次账号刷新失败。` |
| repair 失败 | `修复刷新锁失败，请确认没有健康进程占用后重试。` |

不得直接渲染未知 `error`、`credentialMessage`、quotaCache error、scheduler 错误原文、HTTP body、token、URL 或 lock path。

## 兼容性、迁移与回滚

- 无配置迁移；`chatgpt.usagePanelEnabled` 保持默认 `false`，Settings 保存链路不改。
- 无 API/schema/OAuth metadata/quota cache/session JSONL 迁移。
- Models 内 GPT quota UI 不在本任务重构范围；`lib/quota-display.ts` 现有英文 helper 保持兼容。
- Grok 组件、Grok schema、月/周含义、缓存 TTL 和账号行为不变。
- 回滚优先级：关闭现有 ChatGPT usage 开关止血；再回滚 GPT component/AppShell callback/CSS；不回滚账号、quota、Reset 或 scheduler 服务端能力。

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 失败刷新清空旧额度 | 请求开始不置空；按 accountId 保存最后成功快照 |
| 旧账号响应覆盖新 Active | Abort + generation + response accountId 校验 |
| 把 cache 年龄误称 stale/fresh | GPT 只用“已缓存”，不套用 Grok TTL 文案 |
| 英文化 helper 改动波及 Models | 新增 GPT 中文 helper，不改变既有导出语义 |
| scheduler 原始错误泄露路径/内部异常 | 只展示布尔/时间/lock 枚举和固定中文失败文案 |
| fixed panel 在窄屏越界 | 复用 Grok clamp 算法，320/375/640/desktop 浏览器验证 |
| 为共享 UI 改坏 Grok | 本任务不抽通用 shell/ring，不修改 Grok 业务组件 |
