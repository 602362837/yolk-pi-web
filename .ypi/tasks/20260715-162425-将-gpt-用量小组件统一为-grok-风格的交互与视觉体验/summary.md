# Summary：将 GPT 用量小组件统一为 Grok 风格的交互与视觉体验

## 结果

用户验收通过。GPT 顶部用量入口已与 Grok 统一为同一交互语言，同时保留 ChatGPT/Codex 真实额度语义与 GPT 专属运维能力。

## 交付内容

- `ChatGptUsagePanel`：Grok 风格 pill / fixed viewport clamp 面板、中文状态、Escape / 外部点击 / 关闭还焦、dialog/ARIA
- 真实窗口语义：收起态「5 小时 / 周」，展开态「5 小时额度 / 7 天额度」；不伪造月度
- GPT 独立 cache 模型：`live | cached | page_fallback | none`；同账号本页最后成功数据回退；不套用 Grok fresh/stale
- AppShell：GPT 接入 `onOpenModels`；保持单一 `.app-top-usage-panel`、GPT→Grok 顺序与一次右侧留白
- 专属次级区：Reset credits、scheduler/lock reload/repair 保留且不进入 Grok
- 契约测试与文档：`scripts/test-chatgpt-usage-panel.mjs`、`docs/modules/frontend.md`、`docs/modules/library.md`

## 主要文件

- `components/ChatGptUsagePanel.tsx`
- `components/AppShell.tsx`
- `lib/quota-display.ts`
- `app/globals.css`
- `scripts/test-chatgpt-usage-panel.mjs`
- `package.json`
- `docs/modules/frontend.md`
- `docs/modules/library.md`

## 验证

- `npm run lint` / `tsc --noEmit`：pass
- `test:chatgpt-usage-panel` 与 Grok 回归测试：pass
- Checker 浏览器：桌面挂载、320px clamp、Escape/关闭还焦：pass
- Checker 期间修复：page_fallback 优先级、凭据失效可见性、scoped 样式 class 接线

## 边界

- 未改 API/schema/配置默认；`chatgpt.usagePanelEnabled` 仍默认关闭
- 未改 Grok 数据语义与 AppShell 顺序
- 未对真实账号执行 Activate / Reset / lock repair 写操作

## 状态

`review` → `user_acceptance`（用户验收通过）→ 可 completed 归档。
