# Implement：Grok 用量小组件

## 实现前提

- 用户已批准 [plan-review.md](./plan-review.md) 与 [grok-usage-panel-prototype.html](./grok-usage-panel-prototype.html)。
- 任务已由主会话合法进入 `implementing`。
- 实现员不得扩展到 Grok quota/OAuth/failover 协议改造。

## 优先阅读顺序

1. `AGENTS.md`、`docs/modules/frontend.md`、`docs/modules/api.md`、`docs/modules/library.md`、`docs/integrations/README.md`
2. `components/ChatGptUsagePanel.tsx`、`components/AppShell.tsx`
3. `components/ModelsConfig.tsx` 中 `GrokQuotaView` 与 Grok account handlers
4. `components/SettingsConfig.tsx` 中 ChatGPT/Grok 分区和保存逻辑
5. `lib/pi-web-config.ts`
6. `app/api/auth/quota/[provider]/route.ts`、`app/api/auth/accounts/[provider]/**`
7. `lib/grok-subscription-quota.ts`、`lib/oauth-accounts.ts`
8. 本任务 PRD/Design/UI/Checks/HTML 原型

## 人类可读子任务表

| ID | 阶段 | 顺序 | 依赖 | 子任务 | 主要文件 | 可并行 |
| --- | --- | ---: | --- | --- | --- | --- |
| GROK-USAGE-01 | config | 1 | — | 增加配置契约和 Settings 开关 | `lib/pi-web-config.ts`, `components/SettingsConfig.tsx` | 是 |
| GROK-USAGE-02 | component | 1 | — | 抽取共享 Grok quota view，新增顶部 Grok 面板 | `components/GrokQuotaView.tsx`, `components/ModelsConfig.tsx`, `components/GrokUsagePanel.tsx` | 是 |
| GROK-USAGE-03 | integration | 2 | 01, 02 | 接入 AppShell 单一 usage host 与响应式布局 | `components/AppShell.tsx`, `app/globals.css` | 否 |
| GROK-USAGE-04 | verification-docs | 3 | 03 | 回归、测试、文档和浏览器验收 | `scripts/*`（如需要）, `docs/**` | 否 |

## Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "strategy": "parallel-ready DAG",
  "maxConcurrency": 2,
  "subtasks": [
    {
      "id": "GROK-USAGE-01",
      "title": "增加 Grok 用量面板配置契约与 Settings 开关",
      "phase": "config",
      "order": 1,
      "dependsOn": [],
      "files": [
        "lib/pi-web-config.ts",
        "components/SettingsConfig.tsx"
      ],
      "instructions": [
        "为 PiWebGrokConfig 增加 usagePanelEnabled:boolean，默认 false。",
        "在 normalize、validate 和现有 Grok patch merge 路径保持旧配置兼容与 autoFailover 保留。",
        "在 Settings → Grok 使用现有 ToggleField 增加独立开关，中文文案说明顶部位置、默认关闭和按需 quota 请求。",
        "保持恢复默认值、dirty 比较、保存后 onConfigChange 的现有行为。"
      ],
      "acceptance": [
        "旧 pi-web.json 缺失字段时规范化为 false。",
        "非 boolean 保存被 400 拒绝并指向 grok.usagePanelEnabled。",
        "只切换该字段不会覆盖 grok.autoFailover。",
        "Settings 保存后 AppShell 可立即读取新值。"
      ],
      "validation": [
        "node_modules/.bin/tsc --noEmit",
        "人工调用 GET/PUT /api/web-config 验证缺失、true、false 和 invalid 值"
      ],
      "risks": [
        "严格校验若未合并 currentConfig 会让旧客户端 partial patch 失败",
        "默认值误设 true 会在升级后自动触发顶部请求"
      ],
      "parallelizable": true,
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "GROK-USAGE-02",
      "title": "复用 Grok quota 展示并实现顶部 GrokUsagePanel",
      "phase": "component",
      "order": 1,
      "dependsOn": [],
      "files": [
        "components/GrokQuotaView.tsx",
        "components/ModelsConfig.tsx",
        "components/GrokUsagePanel.tsx",
        "components/ActionFlowIcon.tsx",
        "components/iconFlow.ts"
      ],
      "instructions": [
        "把 ModelsConfig 内现有 GrokQuotaView 及其纯 formatter/颜色映射抽为共享展示组件，保持 Models props 和行为。",
        "新增 GrokUsagePanel，采用 ChatGptUsagePanel 的入口/弹层模式，但直接消费 GrokQuotaResultV1，不转换成 GPT tiers。",
        "账号用 GET /api/auth/accounts/grok-cli；quota 用 GET /api/auth/quota/grok-cli；Activate 用既有 POST activate。",
        "自动重验证只发普通 quota GET；手动刷新和 Activate 后使用 refresh=1。",
        "实现 AbortController 或 request generation，确保旧 Active 响应不覆盖新 Active；卸载清理 interval/listeners/requests。",
        "非 2xx quota 响应仍解析安全投影；内部 stale+monthly 继续显示数据，并展示中文的缓存过期警告。",
        "所有用户可见标签、按钮、状态、错误、空状态、toast、title 和 aria-label 使用中文；Grok、GPT、Settings、Models、Active、quota、cache、OAuth、API 等专业术语可保留。",
        "收起态使用月/周标签；按钮使用刷新、设为 Active、正在刷新、正在切换等中文表达。",
        "不加入 reset credit、warmup、scheduler 或全账号 quota 轮询。"
      ],
      "acceptance": [
        "收起态和展开态匹配已审批 HTML 原型。",
        "加载中/无账号/实时/缓存新鲜/缓存过期/需重新登录/错误/刷新中/切换中均有中文可读状态。",
        "已保存账号可通过“设为 Active”快速触发 Activate，失败不乐观切换。",
        "Models → Grok 继续使用同一共享 quota view 且功能无回归。",
        "DOM/中文错误文案不包含任何 credential、token、raw billing payload 或路径。"
      ],
      "validation": [
        "npm run test:grok-quota",
        "npm run test:grok-accounts",
        "node_modules/.bin/tsc --noEmit",
        "浏览器用 mock/真实脱敏响应逐一验证中文状态和操作文案"
      ],
      "risks": [
        "抽取 view 时破坏 Models selected-account 或 refresh 绑定",
        "轮询/聚焦/展开并发导致旧 quota 闪回",
        "把 HTTP error 直接 throw 会丢失 reauth/error 安全投影"
      ],
      "parallelizable": true,
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "GROK-USAGE-03",
      "title": "接入 AppShell 顶部共同布局和窄屏样式",
      "phase": "integration",
      "order": 2,
      "dependsOn": [
        "GROK-USAGE-01",
        "GROK-USAGE-02"
      ],
      "files": [
        "components/AppShell.tsx",
        "app/globals.css"
      ],
      "instructions": [
        "派生 showChatGptUsage/showGrokUsage/showAnyProviderUsage。",
        "仅渲染一个 app-top-usage-panel host，内部按 GPT 后 Grok 顺序条件渲染并设置固定 gap。",
        "SessionStatsChips 只有在不存在任一 provider usage 时承担 rightPanelTogglePadding；usage host 只承担一次右侧留白。",
        "保持无 Session Stats 时 host margin-left:auto 和现有 mobile topbar 横向滚动。",
        "弹层宽度限制为不超过 viewport，不遮挡右侧抽屉切换条。"
      ],
      "acceptance": [
        "四种开关组合布局正确且无空占位。",
        "双开时 GPT→Grok，右侧 padding 不重复。",
        "320px/375px/640px/桌面宽度均可访问两个入口，展开面板不越界。",
        "关闭 Grok 后组件卸载并停止其请求。"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "浏览器验证四种配置组合和四种宽度"
      ],
      "risks": [
        "现有 mobile CSS 对每个 usage host 加 84px padding",
        "SessionStats padding 计算错误导致右侧抽屉按钮覆盖"
      ],
      "parallelizable": false,
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "GROK-USAGE-04",
      "title": "完成配置、Grok 回归、文档与用户流验证",
      "phase": "verification-docs",
      "order": 3,
      "dependsOn": [
        "GROK-USAGE-03"
      ],
      "files": [
        "docs/modules/frontend.md",
        "docs/modules/api.md",
        "docs/modules/library.md",
        "docs/integrations/README.md",
        "scripts/test-grok-quota.mjs"
      ],
      "instructions": [
        "更新组件、配置字段、quota API 消费位置和 Grok 集成说明；不声称新增 API。",
        "为新增的纯配置/展示 helper 增加最小轻量测试；避免只依赖脆弱源码字符串断言。",
        "按 checks.md 完成自动与人工检查，记录无法执行项和原因。",
        "确认 cacheWrite、OAuth、failover、session lifecycle 等无关边界未改动。"
      ],
      "acceptance": [
        "lint、typecheck 和 Grok quota/accounts/global-auth 测试通过。",
        "人工验收覆盖开关、双组件、全部关键中文状态、切号、窄屏和键盘。",
        "文档与最终代码行为一致。",
        "无生产构建污染；未直接运行 next build。"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "npm run test:grok-quota",
        "npm run test:grok-accounts",
        "npm run test:grok-global-auth"
      ],
      "risks": [
        "只做静态审查而遗漏定时器和响应式运行时问题",
        "文档误写成 Grok 有 GPT reset/scheduler 能力"
      ],
      "parallelizable": false,
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    }
  ],
  "execution": {
    "groups": [
      {
        "order": 1,
        "subtaskIds": [
          "GROK-USAGE-01",
          "GROK-USAGE-02"
        ]
      },
      {
        "order": 2,
        "subtaskIds": [
          "GROK-USAGE-03"
        ]
      },
      {
        "order": 3,
        "subtaskIds": [
          "GROK-USAGE-04"
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
npm run test:grok-quota
npm run test:grok-accounts
npm run test:grok-global-auth
```

## 评审门禁

1. 实现员完成后必须由 checker 检查，不能以实现员自报通过替代独立检查。
2. checker 必须对照已批准 HTML 原型，并实际验证顶部四种开关组合、Grok 中文状态、按钮、错误提示、辅助说明与 `aria-label`。
3. 任何新增 API/schema/config 语义、默认改为开启或后台全账号刷新均属于范围变化，必须退回主会话审批。

## 回滚顺序

1. 配置层将 `grok.usagePanelEnabled` 设为 false，立即止血并停止浏览器轮询。
2. 回滚 AppShell 挂载和 Settings 入口，不动 accounts/quota API。
3. 如 Models 共享 view 抽取有回归，将展示内联回 `ModelsConfig.tsx`；保留其他无回归部分。
