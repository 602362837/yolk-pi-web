# Checks：GPT 用量小组件统一为 Grok 风格

## 需求覆盖检查

- [ ] 收起 pill 与 Grok 对齐：26px、玻璃背景、展开高亮、状态点/spinner、额度 rings。
- [ ] GPT 只显示真实 `5 小时 / 7 天（周）`；源码、DOM、原型均无 GPT“月度额度”。
- [ ] 展开面板 fixed + viewport clamp，左右至少 8px，超高内部滚动。
- [ ] 外部点击、Escape、显式关闭按钮均关闭；Escape/关闭按钮还焦 trigger。
- [ ] 加载、无账号、实时、已缓存、无缓存、重新登录、错误、刷新/切换/重置中均有中文状态。
- [ ] 手动刷新失败保留同账号本页最后成功数据；切换账号不跨账号回退。
- [ ] Activate 失败保留旧 Active；Activate 成功但 quota 失败保留新 Active 并准确提示。
- [ ] Reset credits 数量、最早过期、确认、成功/失败仍可用。
- [ ] scheduler enabled/running/lock/next/last、重载、lock repair 和风险确认仍可用，位于次级区。
- [ ] 无账号/凭据失效时可打开 Models → ChatGPT。
- [ ] 不新增 API/schema/config；`chatgpt.usagePanelEnabled` 默认仍为 `false`。
- [ ] Grok 面板、Grok 月/周、fresh/stale、Models quota 行为无回归。

## 自动验证

实现后运行：

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:chatgpt-usage-panel
npm run test:grok-usage-panel
npm run test:grok-quota
npm run test:grok-accounts
npm run test:grok-global-auth
```

- [ ] 所有命令退出码为 0；若有既有 warning，记录数量与来源，不把 warning 误报为通过证据。
- [ ] 未直接运行 `next build`；发布验证如有需要只运行 `npm run build`。
- [ ] 新测试至少覆盖可导入的纯 formatter/安全映射；源码断言不替代交互/race 验证。
- [ ] `rg -n "月度|Monthly|month" components/ChatGptUsagePanel.tsx` 不出现把 GPT tier 解释为月度的用户文案。
- [ ] `rg` 审查确认前端不直接渲染未知 `error`、`credentialMessage`、`quotaCache.error`、scheduler error 原文或 lock path。

## API 与请求时序检查

### 账号轻量重读

- [ ] 初次挂载调用 `GET /api/auth/accounts/openai-codex`。
- [ ] 页面可见时每 30 秒只调用 accounts API；`document.hidden` 时不轮询。
- [ ] window focus、visibility 恢复和展开时重读 accounts；展开不清空现有内容。
- [ ] 普通重读不调用 quota GET，不批量查询所有账号 quota。
- [ ] 卸载清理 interval、focus/visibility/resize/scroll/keydown/mousedown listeners 与所有 AbortController。

### quota / Activate / Reset

- [ ] 手动刷新只查询当前 Active；请求归属与响应 `accountId`/generation 一致。
- [ ] Activate 成功后查询新 Active quota；旧账号在途 quota 被 abort 或因 generation 失效。
- [ ] 快速执行“刷新 → 切号”与“切号 → focus 重读”时，旧额度不能闪回到新 Active。
- [ ] 手动刷新开始不清空旧额度；失败有同账号快照时显示页面回退警告。
- [ ] 无同账号成功数据时显示未知/无缓存空态，不显示 0%。
- [ ] POST Reset 继续发送现有 `{ accountId }`；成功更新当前账号数据，失败保留旧额度。
- [ ] 刷新、Activate、Reset 不产生重复并发写操作；disabled 和运行中文案一致。

### scheduler / lock

- [ ] 展开与“重载”调用现有 status API；repair 只在确认后 POST `{ confirm: true }`。
- [ ] lock 状态只显示 `owned / stale / held / none` 的中文投影，不显示 lock.path。
- [ ] `lastError` / `lastAccountError` 只显示固定中文失败状态，不展示内部原文。
- [ ] repair 失败使用固定中文通用文案；取消确认不发请求。

## 状态与安全文案检查

| 场景 | 期望文案/行为 |
| --- | --- |
| `credentialStatus=expired` | `登录已失效，需要重新登录` + Models 恢复入口 |
| `not_found` | `未找到 OAuth 凭据`，不显示服务端 message |
| `parse_error` | `无法读取 OAuth 凭据`，不显示路径/解析异常 |
| accounts 网络/API 失败 | `无法加载 ChatGPT 账号列表，请稍后重试` |
| quota 失败、无数据 | `无法获取额度，请检查网络后重试` 或等价已批准固定文案 |
| quota 失败、有同账号成功快照 | `刷新失败，正在展示本页上次成功数据` |
| Activate 失败 | `切换 Active 账号失败，已保留当前账号` |
| Activate 成功、quota 失败 | `账号已切换，额度刷新失败` |
| Reset 失败 | `Reset credits 消耗失败`，不清空旧额度 |
| scheduler/repair 失败 | 固定中文运维文案，不含路径、URL、token、内部异常 |

- [ ] 用户可见标签、按钮、title、`aria-label`、状态、错误、确认文案均为中文；`GPT / ChatGPT / Codex / Models / Active / OAuth / Reset credits / scheduler / lock` 可保留。
- [ ] 状态不只依赖颜色：每个绿色/黄色/红色点均有可读文字。
- [ ] 长账号名、masked id 单行省略且有完整 `title`；错误可换行，不撑破面板。
- [ ] 浏览器 DOM/Network 展示层不出现 access/refresh/id token、真实 credential id、原始 response body、文件路径或 lock path。

## 人工 UI 验收矩阵

### 顶部 host 与开关组合

在以下四种组合逐一验证：

1. [ ] GPT 关 / Grok 关：无 usage host 空占位。
2. [ ] GPT 开 / Grok 关：GPT 位于会话统计后、右侧抽屉按钮前。
3. [ ] GPT 关 / Grok 开：Grok 现状不变。
4. [ ] GPT 开 / Grok 开：固定 GPT → Grok；gap 正确；右侧安全留白只出现一次。

### 状态夹具/真实脱敏数据

- [ ] 初次加载骨架或 loading spinner。
- [ ] 无账号/无 Active。
- [ ] metadata 成功 cache，显示“已缓存 · 相对时间”。
- [ ] 手动刷新成功，显示“实时”。
- [ ] 手动刷新失败且有同账号快照，旧 rings/cards 保留。
- [ ] 手动刷新失败且无成功数据，显示空态。
- [ ] expired / not_found / parse_error 三种 credential 状态。
- [ ] Activate 成功、Activate 失败、Activate 成功后 quota 失败。
- [ ] Reset credits 为 0、为正数、有/无最早过期、确认取消、成功、失败。
- [ ] scheduler disabled/enabled、running、lock owned/stale/held/none、最近失败、repair 取消/成功/失败。

### 窄屏与滚动

| Viewport | 检查 |
| --- | --- |
| 320px | [ ] 面板宽 ≤304px，左右各 ≥8px；顶部可横向访问 GPT/Grok/抽屉；账号与按钮不溢出 |
| 375px | [ ] fixed 面板 clamp 正确；内部滚动可到 Reset/scheduler 区；背景页面不被水平撑宽 |
| 640px | [ ] mobile topbar 断点下 host 只承担一次 84px clearance；两个 pill 不被压成字符 |
| 桌面 | [ ] 面板右边缘优先对齐 trigger；resize/顶部滚动后仍在视口内；不遮挡为不可恢复状态 |

- [ ] 低高度 viewport 下 max-height 生效，面板内部为唯一滚动区且所有操作可达。
- [ ] 面板打开后 resize、页面/顶部滚动会重新 clamp。

## 键盘与无障碍

- [ ] trigger、刷新、关闭、账号 Activate、Models、Reset、scheduler 重载、repair 都是原生 `button`，Enter/Space 可用。
- [ ] trigger 有 `aria-expanded`、`aria-controls` 和中文可访问名称。
- [ ] 面板有 `role="dialog"`（或经批准等价语义）、稳定 id、中文 label、`aria-live="polite"`。
- [ ] Escape 关闭并还焦 trigger；关闭按钮同样还焦；外部点击关闭不导致意外触发背景危险动作。
- [ ] Tab 顺序符合视觉顺序；focus-visible 清晰；面板内没有不可达或重复焦点目标。
- [ ] 两个额度条有 `role="progressbar"`、`aria-valuemin/max/now` 和中文 label。
- [ ] spinner 具有文字状态；`aria-hidden` 的装饰点/环不会造成重复播报。
- [ ] `prefers-reduced-motion: reduce` 下 spinner/非必要过渡停止，文字仍表达 loading/refreshing/switching/resetting。

## GPT 专属能力回归

- [ ] Reset credits 没有出现在 Grok 组件或 Grok Models quota view。
- [ ] scheduler/lock/repair 没有被抽到通用 provider 组件，也没有出现在 Grok。
- [ ] GPT 账号 Activate、remarks/extraInfo/masked id 展示仍正确。
- [ ] Models 中 GPT quota/reset 展示未因共享 `lib/quota-display.ts` helper 改动而改变既有 tier 标签或英文 formatter。
- [ ] ChatGPT backend auto-refresh scheduler 仍由服务端拥有，浏览器 30 秒轮询没有取代它。

## 重点回归风险

1. 刷新失败时先 `setQuotaResult(null)` 导致旧额度闪空。
2. metadata 轮询将失败 cache 覆盖本页成功快照。
3. Activate 响应成功但 quota 失败时 UI 错称“保留旧账号”。
4. 旧 quota 请求在新 Active 后完成并覆盖新账号。
5. 把缓存年龄阈值错误映射成 Grok“fresh/stale”。
6. 为减少重复而修改 Grok ring/shell，造成 Grok 已完成行为回归。
7. AppShell 再包一个 usage host 或重复 right padding。
8. scheduler raw error/lock path 泄露到用户界面。

## 审批与检查门禁

- [ ] [HTML 原型](./gpt-usage-panel-grok-style-prototype.html) 已由用户明确批准。
- [ ] [计划审批书](./plan-review.md) 已由用户明确批准。
- [ ] 批准前任务停留在 `awaiting_approval`，未进入 `implementing`。
- [ ] 实现后独立 checker 已对照本清单和原型给出通过/阻塞结论。
