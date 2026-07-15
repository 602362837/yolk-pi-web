# Design：Grok 顶部用量小组件

## 方案摘要

采用“共享现有数据与展示、隔离 provider 业务状态”的方案：

- 配置层为 `grok` 增加 `usagePanelEnabled`。
- 从 `ModelsConfig.tsx` 抽取共享的 `GrokQuotaView`；Models 与新顶部面板共同消费同一 `GrokQuotaResultV1` 展示组件。
- 新建 `GrokUsagePanel.tsx` 管理账号、quota、展开、轮询、刷新与 Activate；不把 Grok schema强行转换成 ChatGPT `SubscriptionQuota`。
- `AppShell` 将 GPT/Grok 放入同一个 usage host，解决同时开启时 margin/padding/mobile 安全留白重复问题。

该方案复用 GPT 的交互模式和现有 Grok quota UI，但不做高风险的通用 provider 状态机重构，也不改变 ChatGPT 业务行为。

## 影响模块和边界

| 模块 | 变更 | 边界 |
| --- | --- | --- |
| `lib/pi-web-config.ts` | Grok 配置类型、默认、读取、校验 | 仅新增布尔字段；保留未知/既有字段和 `autoFailover` |
| `components/SettingsConfig.tsx` | Settings → Grok 开关及说明 | 复用 `ToggleField` 和现有保存/dirty 逻辑 |
| `components/GrokQuotaView.tsx`（新） | 从 Models 抽取月/周 quota 卡 | 纯展示；不发请求、不持有账号切换状态 |
| `components/ModelsConfig.tsx` | 改用共享 `GrokQuotaView` | Models 现有登录、账号、额度语义不变 |
| `components/GrokUsagePanel.tsx`（新） | 顶部入口、展开面板、账号/quota 生命周期 | 只调用既有 accounts/quota/activate API |
| `components/AppShell.tsx` | 条件挂载和顶部共同布局 | 不改变会话统计口径或右侧抽屉逻辑 |
| `app/globals.css` | 必要的 usage host gap/窄屏/面板 class | 优先复用变量；不引入新设计系统 |
| 文档/测试 | 模块图、集成说明、验证 | 不新增 API route |

## 配置契约

```ts
interface PiWebGrokConfig {
  usagePanelEnabled: boolean;
  autoFailover: PiWebGrokAutoFailoverConfig;
}
```

- 默认：`false`。
- 兼容读取：旧配置缺失字段时 `readBoolean(undefined, false)`。
- 写入：现有 Grok PATCH 合并继续保留未更新的 `autoFailover`；完整 Settings 保存带上新字段。
- 校验：存在完整 Grok 配置时 `requireBoolean(value.usagePanelEnabled, "grok.usagePanelEnabled")`。
- 回滚：删除/忽略该字段即可隐藏组件；旧配置文件无需迁移或重写。

## 数据流

```text
GET /api/web-config
  → AppShell reads grok.usagePanelEnabled
  → mount GrokUsagePanel
      ├─ GET /api/auth/accounts/grok-cli
      │    → activeAccountId + sanitized accounts
      └─ GET /api/auth/quota/grok-cli[?accountId=...][&refresh=1]
           → GrokQuotaResultV1
           → shared GrokQuotaView

Activate account
  → POST /api/auth/accounts/grok-cli/activate { accountId }
  → server updates global Active + reloadRpcAuthState()
  → reload accounts
  → GET quota for new account with refresh=1
```

### 请求规则

1. 挂载：加载账号；有 Active 后加载该账号 quota（普通请求）。
2. 每 30 秒且 `document.hidden === false`：重取账号和 Active quota，不带 `refresh=1`。
3. `window.focus` / visibility 恢复 / 面板展开：立即轻量重验证。
4. 手动刷新：当前 Active 的 `refresh=1`。
5. Activate 成功：以返回账号列表确定新 Active，再用该 storage id `refresh=1`。
6. 新请求应 abort 前一批请求或使用 request generation 防止旧 Active 响应覆盖新 Active。
7. 组件卸载时清理 interval、event listener、AbortController。

不对所有账号自动发 quota 请求。账号列表只显示脱敏身份和 Active/切换状态；完整 quota 始终对应当前 Active（或明确选择的新 Active）。

## API / 文件契约

不新增或修改 API。复用：

- `GET /api/auth/accounts/grok-cli`
- `POST /api/auth/accounts/grok-cli/activate`
- `GET /api/auth/quota/grok-cli`
- `GET /api/auth/quota/grok-cli?accountId=<opaque>&refresh=1`

quota 客户端即使收到 401/502 也先解析 `GrokQuotaResultV1`，再根据 `success/cache/monthly/reauthRequired/error` 渲染；不能只抛出 `HTTP status` 丢失安全错误投影。

安全边界保持：不请求 secret、不展示原始 billing payload、不持久化 browser quota cache、不改变 `no-store`。

## UI 与布局契约

### 用户可见文案

- 除 Grok、GPT、Settings、Models、Active、quota、cache、OAuth、API 等专业术语外，标签、按钮、状态、错误提示、空状态、刷新/切换反馈和辅助说明全部使用中文。
- 内部 `live/fresh/stale/none/loading/reauth/error` 仅作为数据状态，不直接展示；对应文案为“实时/缓存新鲜/缓存过期/无缓存/加载中/需要重新登录/错误”。
- 收起态使用“月 34% / 周 12%”，不再展示 `M/W`；按钮使用“刷新”“设为 Active”“正在刷新…”“正在切换…”“在 Models → Grok 管理/重新登录”等中文表达。
- 固定错误映射使用中文安全文案，仍只按 allowlist error code 选择，不透传上游原始内容。
- 所有面向辅助技术的 `aria-label`、标题和状态播报也使用中文。

- AppShell 计算：
  - `showChatGptUsage = webConfig?.chatgpt.usagePanelEnabled === true`
  - `showGrokUsage = webConfig?.grok.usagePanelEnabled === true`
  - `showAnyProviderUsage = showChatGptUsage || showGrokUsage`
- `SessionStatsChips.paddingRight` 在存在任一 provider usage 时为组件间距，否则保留右侧抽屉安全留白。
- 只渲染一个 `.app-top-usage-panel`，内部 `display:flex; gap`；host 负责一次 `paddingRight`。
- 顺序固定 GPT 后 Grok；单开任一组件不留空位。
- 面板宽度使用已交付原型的 `min(392px, calc(100vw - 16px))`，顶部 mobile 横向滚动保持现有策略。

中文文案、HTML 原型和状态细节见 [ui.md](./ui.md) 与 [grok-usage-panel-prototype.html](./grok-usage-panel-prototype.html)。

## 兼容性与迁移

- 旧 `pi-web.json` 无需迁移，默认隐藏。
- API、OAuth metadata、quota cache、session JSONL 均不变。
- GPT 单独开启时应保持当前视觉和行为；两者都关时恢复当前无 usage host 布局。
- ModelsConfig 抽取是代码移动，必须对月/周、缓存过期、重新登录和刷新状态做回归；内部 schema 值不变。

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 两个顶部入口导致右侧留白叠加或窄屏溢出 | 单一 usage host；留白只由 host 承担；浏览器验证四种开关组合 |
| 轮询触发过多上游 billing 请求 | 30 秒客户端轻量重验证 + 服务端 60 秒 fresh/single-flight；只有显式动作强刷 |
| 切号后旧 quota 覆盖新 Active | AbortController/request generation + accountId 一致性检查 |
| 502/401 时丢失安全错误内容 | 非 2xx 仍解析 `GrokQuotaResultV1` 并按 schema 渲染 |
| 抽取 GrokQuotaView 回归 Models | 仅搬迁展示与 formatter，props/行为保持；手工对比 Models 与原型状态 |
| 默认开启造成意外占位/请求 | 默认关闭，用户显式选择后才挂载 |

## 回滚

1. UI 紧急回滚：将 `grok.usagePanelEnabled` 设为 `false`，无需删除账号或 cache。
2. 代码回滚：移除 AppShell 挂载和 Settings 开关；保留 Grok accounts/quota API。
3. 若共享 view 抽取引发 Models 回归，可先把 view 内联回 Models；quota 服务和配置数据不受影响。
