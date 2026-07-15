# Checks：Grok 用量小组件

## 需求覆盖检查

- [x] `grok.usagePanelEnabled` 类型、默认、兼容读取、严格校验、保存合并均完成。（`test:grok-usage-panel` + 代码审查）
- [x] Settings → Grok 有独立开关，默认关闭，说明展示位置与数据刷新语义。（代码审查 `SettingsConfig.tsx`）
- [x] AppShell 四种组合均正确：GPT/Grok 都关、仅 GPT、仅 Grok、两者都开。（代码审查条件挂载；checker 浏览器验证双开/仅 GPT；默认关与仅 Grok 由条件挂载覆盖）
- [x] 同时开启顺序为 GPT → Grok；右侧抽屉安全留白只计算一次。（`AppShell` + 单一 `.app-top-usage-panel`；浏览器确认 GPT 在左、Grok 在右、host `padding-right: 84px` 一次）
- [x] Grok 收起态与展开态符合已审批 HTML 原型；除约定专业术语外，用户可见标签、按钮、状态、错误提示、说明和辅助技术文案均为中文。（静态文案审查 + checker 浏览器）
- [x] 展开面板只使用现有 accounts/quota/activate API；无 reset credit/scheduler/warmup。
- [x] Models 与顶部共同复用 Grok quota 展示，不存在两份月/周/缓存过期/重新登录映射；内部 schema 状态值不变。

## 自动验证

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:grok-quota
npm run test:grok-accounts
npm run test:grok-global-auth
npm run test:grok-usage-panel
```

| Command | Result (GROK-USAGE-04 + checker) |
| --- | --- |
| `npm run lint` | pass（0 errors；既有无关 warnings） |
| `node_modules/.bin/tsc --noEmit` | pass |
| `npm run test:grok-quota` | pass 48/48 |
| `npm run test:grok-accounts` | pass 70/70 |
| `npm run test:grok-global-auth` | pass 7/7 |
| `npm run test:grok-usage-panel` | pass 6/6 |

若实现新增专用纯 helper/脚本，再运行其对应测试。不得直接运行 `next build`；只有发布验证才使用 `npm run build`。本轮未运行 `next build`，工作区无 `.next` 污染。

## 配置检查

- [x] 旧配置 `{ grok: { autoFailover: ... } }` 读取后 `usagePanelEnabled === false`。（`test:grok-usage-panel`）
- [x] PUT 只修改 `grok.usagePanelEnabled` 时保留 `grok.autoFailover` 和其他顶层配置。（`writePiWebConfigPatch` 单测）
- [x] 非 boolean 值返回 400，错误指向 `grok.usagePanelEnabled`。（`validatePiWebGrokConfig` 单测；路由沿用既有校验错误）
- [x] Settings 保存后无需刷新页面即可挂载/卸载顶部面板。（checker 浏览器：开启保存后立即出现 `Grok 用量`；关闭保存后立即卸载）
- [x] “恢复默认值”后开关回到关闭，只有点击“保存设置”才落盘。（代码审查：`resetToDefaults` 仅改 draft/`dirty`，`saveConfig` 才 PUT；默认 `usagePanelEnabled=false`）

## API / 数据检查

- [x] 初次挂载先解析账号 Active，再展示对应 quota。（`GrokUsagePanel` 代码审查）
- [x] 普通自动重验证不带 `refresh=1`；手动刷新和 Activate 后带 `refresh=1`。
- [x] 401/502 响应仍解析安全 `GrokQuotaResultV1`，不只显示 HTTP 状态。
- [x] 内部 `stale + monthly` 同时存在时继续展示额度，并有明显的中文“缓存已过期”警告。
- [x] `weekly` 缺失不报错；`reauthRequired` 有中文“需要重新登录”引导。
- [x] 切号失败不乐观修改 Active；切号成功后旧请求不会覆盖新账号 quota。（Abort + request generation 代码审查）
- [x] hidden 时无 interval 请求；卸载后 interval/listener/request 均清理。（代码审查）
- [x] 浏览器响应和界面不包含 access/refresh/id token、原始 billing body、base URL 或文件路径。（quota/accounts 测试 + 源码审查）

## 人工 UI 验收

> checker 在 worktree `next dev -p 30142` 对照原型完成关键路径；实现员未跑浏览器。

1. [x] 在 Settings → Grok 切换开关并保存，观察顶部立即显示/隐藏。
2. [x] 同时开启 GPT/Grok，确认顺序、间距、会话统计和右侧抽屉按钮无覆盖。（单一 host，GPT→Grok，`padding-right` 一次）
3. [x] 关键状态：实时/缓存新鲜、缓存过期+需重新登录（切到失效账号）、手动刷新后实时；加载中/无账号/无缓存错误由代码与共享映射覆盖，未逐一注入夹具。
4. [x] 展开列表通过“设为 Active”切换非 Active 账号，确认全局影响提示与新 Active/quota 更新；失败路径代码审查为非乐观切换。
5. [x] 375px/桌面宽度验证；检查员修复 absolute 溢出后 375px 面板 clamp 至 8px gutters。320/640 未逐一截图，逻辑同 clamp。
6. [x] 入口/刷新/`设为 Active` 可聚焦；`type="button"`、`aria-expanded`、中文 `aria-label`、progressbar 属性齐全；Escape 关闭面板。
7. [x] Models → Grok 共享 `GrokQuotaView`：月度/周、缓存新鲜、Active/全局当前中文展示无回归。
8. [~] 状态不只靠颜色（有中文文案）；深色/浅色与 reduced-motion 未完整截图回归（非阻塞）。
9. [x] 界面文案审查：用户可见标签/按钮/状态/错误/aria 为中文；保留 Grok/GPT/Settings/Models/Active/quota/cache/OAuth/API；日期 `toLocaleString` 可能随系统 locale 显示英文月名（非阻塞）。

## 重点回归风险

- `components/ModelsConfig.tsx` 的 Grok quota card 在抽取后丢失 refresh 或 selected-account 语义。
- `SessionStatsChips.paddingRight` 在只开 Grok或双开时错误。
- mobile `.app-top-usage-panel` 的 84px 右侧留白对两个子入口重复应用。
- 自动重验证意外使用 `refresh=1`，绕开服务端缓存并增加 xAI 请求。
- Active 切换期间并发请求出现旧数据闪回。

## 审批门禁

- [x] `grok-usage-panel-prototype.html` 已由用户审阅并明确批准。
- [x] `plan-review.md` 已获用户批准。
- [x] 批准前任务必须停留在 `awaiting_approval`，不得进入 `implementing`。（本任务已合法进入 implementing）
