# Implement：GPT 用量小组件统一为 Grok 风格

## 实现前提

- 用户已批准 [计划审批书](./plan-review.md)、[UI 说明](./ui.md) 与 [HTML 原型](./gpt-usage-panel-grok-style-prototype.html)。
- 主会话已通过 Studio approval gate 将任务合法转入 `implementing`。
- 实现员只处理分配的 `subtaskId`；不得把 GPT 强转为 Grok schema，不得新增 API/config，也不得顺手重构 Grok。

## 优先阅读顺序

1. `AGENTS.md`、`docs/modules/frontend.md`、`docs/modules/api.md`、`docs/modules/library.md`、`docs/standards/code-style.md`
2. 本任务 `brief.md`、`prd.md`、`ui.md`、HTML 原型、`design.md`、`checks.md`
3. `components/ChatGptUsagePanel.tsx`
4. `components/GrokUsagePanel.tsx`（只作为交互/视觉基准）、`components/GrokQuotaView.tsx`（理解不可复用的 schema 边界）
5. `components/AppShell.tsx` 与 `app/globals.css` 的 `.app-top-usage-panel` / reduced-motion 规则
6. `lib/quota-display.ts`、`components/ModelsConfig.tsx` 中 GPT quota 消费点
7. 既有 API：`app/api/auth/accounts/[provider]/**`、`app/api/auth/quota/[provider]/route.ts`、`app/api/chatgpt/usage-refresh/**`

## 人类可读子任务表

| ID | 阶段 | 顺序 | 依赖 | 子任务 | 主要文件 | 可并行 |
| --- | --- | ---: | --- | --- | --- | --- |
| GPT-USAGE-01 | component-state | 1 | — | 重构 GPT 状态编排、安全中文投影和 Grok 风格面板 | `components/ChatGptUsagePanel.tsx`, `lib/quota-display.ts` | 是 |
| GPT-USAGE-02 | shell-integration | 1 | — | 接入 Models 恢复入口和 reduced-motion/焦点样式 | `components/AppShell.tsx`, `app/globals.css` | 是 |
| GPT-USAGE-03 | regression-docs | 2 | 01, 02 | 增加回归契约、运行验证并更新文档 | `scripts/test-chatgpt-usage-panel.mjs`, `package.json`, `docs/modules/frontend.md`, `docs/modules/library.md` | 否 |

`GPT-USAGE-01` 与 `GPT-USAGE-02` 文件不重叠，可并行执行；二者通过已定义的 `onOpenModels?: () => void` prop 和 spinner/focus class 名契约汇合。主会话应按 `maxConcurrency=2` 同轮填满两个槽位。

## Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "sourceArtifact": "implement.md",
  "summary": "在不改 API/schema/config/Grok 语义的前提下，以独立 GPT 状态模型重构顶部用量面板，并保留 Reset credits 与 scheduler/lock 专属能力。",
  "strategy": "parallel GPT component-state and shell wiring, then regression/docs barrier",
  "maxConcurrency": 2,
  "scheduler": {
    "failFast": true,
    "defaultFailurePolicy": "block_dependents"
  },
  "subtasks": [
    {
      "id": "GPT-USAGE-01",
      "title": "重构 GPT 用量状态编排与 Grok 风格面板",
      "phase": "component-state",
      "order": 1,
      "dependsOn": [],
      "relation": "parallel",
      "parallelGroup": "gpt-usage-foundation",
      "files": [
        "components/ChatGptUsagePanel.tsx",
        "lib/quota-display.ts"
      ],
      "instructions": [
        "为 ChatGptUsagePanel 增加可选 onOpenModels 回调；按 GrokUsagePanel 对齐 trigger、fixed viewport clamp、外部点击、Escape、显式关闭、焦点恢复、dialog/aria-live/progressbar 语义。",
        "保持 SubscriptionQuota/QuotaDisplayTier/Reset credits/scheduler provider-specific；不得导入或构造 GrokQuotaResultV1，不得修改 Grok 组件。",
        "实现按 accountId 隔离的本页最后成功 quota 快照；成功 metadata cache 与成功 quota GET 可写入快照，任何失败不得覆盖；刷新失败时保留同账号数据，切号后禁止跨账号回退。",
        "挂载、前台 30 秒、focus/visibility 恢复和展开只重读 accounts metadata；手动刷新和 Activate 后才调用 quota GET。使用 AbortController、generation 和 accountId 检查阻止旧响应覆盖新 Active。",
        "刷新、Activate、Reset 操作按统一 busy 规则禁用并显示中文进行中反馈；Activate 成功但 quota 失败时保留新 Active 并使用准确文案。",
        "把 five_hour/seven_day 显示为 5 小时/7 天（周），不伪造月度；未知额度为空态而非 0%。",
        "所有 accounts/quota/cache/credential/reset/scheduler/repair 失败使用 Design allowlist 固定中文文案，不透传 error、credentialMessage、quotaCache.error、scheduler lastError/lastAccountError、HTTP body、路径或 token。",
        "保留 Reset credits 确认/数量/过期和 scheduler/lock reload/repair，放在主额度与账号之后的默认展开次级区。",
        "若在 lib/quota-display.ts 增加中文 helper，保留现有 QUOTA_TIER_LABELS 和 formatQuotaQueriedAt 的行为，避免 Models 回归。"
      ],
      "acceptance": [
        "收起态与展开态匹配已审批 HTML 原型且全部用户可见文案为中文（约定专业术语除外）。",
        "GPT 始终显示真实 5 小时/7 天窗口，无月度标签或伪造字段。",
        "手动刷新失败不清空同账号上次成功数据；切换账号不复用其他账号快照。",
        "Activate 失败保留旧 Active；Activate 成功后 quota 失败保留新 Active并准确提示。",
        "Reset credits、scheduler status/reload/lock repair 均保留且位于次级区。",
        "DOM 不直接出现未知服务端错误原文、token、路径或原始响应。"
      ],
      "validation": [
        "node_modules/.bin/tsc --noEmit",
        "浏览器验证刷新失败回退、切号隔离、Reset 和 scheduler/repair 状态"
      ],
      "risks": [
        "并发 accounts/quota 响应造成旧账号数据闪回",
        "失败状态误覆盖成功快照",
        "修改共享英文 formatter 造成 Models 文案回归"
      ],
      "parallelizable": true,
      "member": "implementer",
      "failurePolicy": "block_dependents",
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "GPT-USAGE-02",
      "title": "接入 Models 恢复入口与响应式无障碍样式",
      "phase": "shell-integration",
      "order": 1,
      "dependsOn": [],
      "relation": "parallel",
      "parallelGroup": "gpt-usage-foundation",
      "files": [
        "components/AppShell.tsx",
        "app/globals.css"
      ],
      "instructions": [
        "AppShell 向 ChatGptUsagePanel 传入打开现有 Models modal 的回调，与 Grok 接线方式一致。",
        "保持单一 app-top-usage-panel、GPT→Grok 顺序、showAnyProviderUsage 和一次 rightPanelTogglePadding，不重做 host。",
        "只增加 GPT spinner/focus-visible/reduced-motion 所需的最小样式；不要改变全局 topbar 断点、Grok 业务样式或右侧抽屉逻辑。",
        "确保 320/375/640px 下 host 继续横向可访问，GPT trigger flex-shrink:0，fixed panel 由组件 clamp 到 8px gutters。"
      ],
      "acceptance": [
        "无账号/重新登录时可通过 GPT 面板打开 Models，关闭面板后没有焦点丢失或重复 host。",
        "GPT/Grok 四种开关组合的顺序、间距、右侧留白与现状一致。",
        "reduced-motion 下非必要 spinner/过渡停止但运行中文字仍可见。",
        "未修改 chatgpt.usagePanelEnabled 默认值、Settings 或 Grok schema/行为。"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "浏览器验证 320/375/640/desktop 与 GPT/Grok 四种开关组合"
      ],
      "risks": [
        "重复右侧 padding 或改变 GPT→Grok 顺序",
        "CSS 选择器过宽影响其他 spinner/顶部组件"
      ],
      "parallelizable": true,
      "member": "implementer",
      "failurePolicy": "block_dependents",
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "GPT-USAGE-03",
      "title": "补齐 GPT 面板回归契约、文档和整体验证",
      "phase": "regression-docs",
      "order": 2,
      "dependsOn": [
        "GPT-USAGE-01",
        "GPT-USAGE-02"
      ],
      "relation": "barrier",
      "files": [
        "scripts/test-chatgpt-usage-panel.mjs",
        "package.json",
        "docs/modules/frontend.md",
        "docs/modules/library.md"
      ],
      "instructions": [
        "增加最小 test:chatgpt-usage-panel 契约，优先测试可导入的纯 helper；源码契约断言只用于 API 接线、中文安全边界和不引入 Grok schema等无法轻量执行的部分。",
        "覆盖 5 小时/7 天标签、中文相对时间、credential 固定映射、同账号回退设计接线、onOpenModels、aria/fixed clamp、30 秒只重读 accounts 和专属 Reset/scheduler 保留。",
        "运行 lint、tsc、新测试、现有 Grok 面板/quota/accounts/global-auth 测试；不得直接运行 next build。",
        "更新 frontend/library 文档，准确说明 GPT cache 只有实时/已缓存/页面回退，不声称 Grok fresh/stale；API 文档无 route 变化时不做无意义改写。",
        "按 checks.md 完成浏览器人工验收并记录未覆盖项。"
      ],
      "acceptance": [
        "自动验证通过且 Grok 现有测试无回归。",
        "文档与最终 GPT/Grok provider 边界一致，不宣称新增 API/config/cache TTL。",
        "人工验收覆盖关键状态、窄屏、键盘、焦点、中文文案和 GPT 专属能力。",
        "工作区既有无关改动未被覆盖或重置。"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "npm run test:chatgpt-usage-panel",
        "npm run test:grok-usage-panel",
        "npm run test:grok-quota",
        "npm run test:grok-accounts",
        "npm run test:grok-global-auth"
      ],
      "risks": [
        "只做源码断言而遗漏运行时 race/焦点问题",
        "文档把页面回退误写成服务端 stale cache",
        "测试或 package.json 与工作区已有 Grok 改动冲突"
      ],
      "parallelizable": false,
      "member": "implementer",
      "failurePolicy": "block_dependents",
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    }
  ],
  "execution": {
    "mode": "mixed",
    "maxParallel": 2,
    "groups": [
      {
        "id": "foundation",
        "title": "GPT 面板与壳接线并行",
        "relation": "parallel",
        "subtaskIds": [
          "GPT-USAGE-01",
          "GPT-USAGE-02"
        ]
      },
      {
        "id": "regression",
        "title": "回归、文档与整体验证",
        "relation": "barrier",
        "dependencies": [
          "foundation"
        ],
        "subtaskIds": [
          "GPT-USAGE-03"
        ]
      }
    ]
  }
}
```

## 验证命令

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:chatgpt-usage-panel
npm run test:grok-usage-panel
npm run test:grok-quota
npm run test:grok-accounts
npm run test:grok-global-auth
```

不直接运行 `next build`；只有发布验证才使用 `npm run build`。

## 评审门禁

1. 未批准本计划和 HTML 原型前，不得进入 `implementing`。
2. 每个实现子任务需局部检查；所有子任务完成后仍需独立 checker 对照 [Checks](./checks.md) 和原型执行整体验收。
3. 以下任一变化必须退回主会话确认：新增 API/schema/config；把 GPT 改成月度；给 GPT 声称 Grok fresh/stale；删除或隐藏 Reset/scheduler；修改 Grok 业务语义；扩大为通用 provider 组件重构。
4. checker 必须实际使用浏览器验证至少一个桌面和一个 320–375px 窄屏流程，不能只读源码。

## 回滚方案

1. 运维止血：关闭现有 `chatgpt.usagePanelEnabled`，组件卸载且停止浏览器轮询。
2. 回滚 `ChatGptUsagePanel` 与 AppShell callback/CSS；不动账号 metadata、quota cache、Reset credits 或 scheduler 数据。
3. 若中文 helper 引发 Models 回归，只回滚新增 helper 调用并保留 GPT 局部 formatter；不改既有共享 helper 语义。
