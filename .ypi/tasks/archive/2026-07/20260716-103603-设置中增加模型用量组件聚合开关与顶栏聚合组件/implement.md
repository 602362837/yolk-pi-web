# Implement：模型用量组件聚合（v6 多环、流光与焦点分栏版）

## 实现前提

- 主会话已指派 UI 设计员把 `ui.md` 与 `model-usage-aggregate-prototype.html` 更新为 **v6**，并取得用户对同一 revision 的明确批准。
- v5 的 accordion、Grok 中心月、Kiro 默认 single、弱层色和 click-primary 聚合交互均已废止，不能作为实现依据。
- 主会话需重新保存本文件 machine-readable implementationPlan；批准前不得进入实现。

## 优先阅读

1. `AGENTS.md`、`docs/modules/frontend.md`、`docs/modules/library.md`、`docs/modules/api.md`、`docs/standards/code-style.md`
2. 本任务 `plan-review.md`、获批 UI v6/HTML、`prd.md`、`design.md`、`checks.md`
3. `components/ProviderUsageTrigger.tsx`
4. `components/ChatGptUsagePanel.tsx`、`components/GrokUsagePanel.tsx`、`components/KiroUsagePanel.tsx`
5. `components/AppShell.tsx`、`components/SettingsConfig.tsx`、`lib/pi-web-config.ts`
6. `app/globals.css` 与 provider usage tests

## 人类可读子任务表

| ID | 阶段 | 顺序 | 依赖 | 子任务 | 可并行 |
| --- | --- | ---: | --- | --- | --- |
| USAGE-AGG-01 | config-settings | 1 | — | 配置与 Settings 开关 | 是 |
| USAGE-AGG-02 | ring-shell | 1 | — | shared N-ring、层色、流光、aggregate hover/focus 分栏壳 | 是 |
| USAGE-AGG-03 | provider-adapter | 2 | 02 | GPT 外周内5h、中心最内层 | 是 |
| USAGE-AGG-04 | provider-adapter | 2 | 02 | Grok 外月内周、中心周 | 是 |
| USAGE-AGG-05 | provider-adapter | 2 | 02 | Kiro 统一 1/N 窗口 adapter | 是 |
| USAGE-AGG-06 | integration | 3 | 01,03,04,05 | AppShell 互斥与 N-ring/hover 契约测试 | 否 |
| USAGE-AGG-07 | validation-docs | 4 | 06 | 文档、全量验证、UI v6 浏览器验收 | 否 |

执行建议：并行 01/02；02 后并行 03/04/05（`maxConcurrency=3`）；06/07 barrier 收口。

## Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "sourceArtifact": "implement.md",
  "summary": "新增默认关闭的 providerPanelsAggregated；Full、Compact、aggregate 统一 shared N-ring，1窗口1环、N窗口N个外长内短同心环，中心始终最内圈；层色/笔触明显区分且逐层阈值叠加，used arc 有 reduced-motion-safe 流光；aggregate 用 hover/focus 打开并按 provider 分栏，无 accordion、无总环；Kiro 遵循同一安全多窗口规则且 remaining 不换算百分比。",
  "strategy": "parallel config and shared N-ring/focus-hover column shell, then three provider adapters in parallel, followed by AppShell integration and validation/docs barriers",
  "maxConcurrency": 3,
  "scheduler": {
    "failFast": true,
    "defaultFailurePolicy": "block_dependents"
  },
  "subtasks": [
    {
      "id": "USAGE-AGG-01",
      "title": "新增聚合配置与 Settings 开关",
      "phase": "config-settings",
      "order": 1,
      "dependsOn": [],
      "relation": "parallel",
      "parallelGroup": "foundation",
      "files": [
        "lib/pi-web-config.ts",
        "components/SettingsConfig.tsx",
        "scripts/test-kiro-config.mjs"
      ],
      "instructions": [
        "在 PiWebUsageConfig、default、normalize、validate 中加入 providerPanelsAggregated:boolean，default/missing=false，非 boolean 返回固定字段路径错误。",
        "保持 partial usage merge，不能丢 includeArchived、providerPanelsCompact、explicitFreeModels、pricingAssistant 或 fallback。",
        "Settings Usage 增加模型用量组件聚合 toggle并更新 dirty compare。",
        "aggregated=true 时禁用 Compact toggle但保留 checked/config 值，说明关闭聚合后恢复，不得写回 false。",
        "更新配置测试覆盖 missing、invalid、partial patch、save/reload 和 Settings placement。"
      ],
      "acceptance": [
        "新旧配置默认关闭且保存重载稳定。",
        "Compact 值在 aggregate on/off 间保留。",
        "无关 usage 字段不丢失。"
      ],
      "validation": [
        "npm run test:kiro-config",
        "node_modules/.bin/tsc --noEmit",
        "浏览器验证 Settings 保存与恢复默认值"
      ],
      "risks": [
        "dirty compare 漏字段",
        "partial patch 覆盖其他 usage 配置",
        "禁用 Compact 时误写配置"
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
      "id": "USAGE-AGG-02",
      "title": "建立 shared N-ring、层色流光与 aggregate hover/focus 分栏壳",
      "phase": "ring-shell",
      "order": 1,
      "dependsOn": [],
      "relation": "parallel",
      "parallelGroup": "foundation",
      "files": [
        "components/ProviderUsageTrigger.tsx",
        "components/ProviderUsagePanelContract.ts",
        "components/ProviderUsageAggregatePanel.tsx",
        "app/globals.css",
        "scripts/test-provider-usage-compact.mjs"
      ],
      "instructions": [
        "把现有独立 conic UsageRing 抽成 shared N-ring primitive；contract 使用非空 layers 数组，顺序 outer→inner，1 window=1 layer，N windows=N layers；所有安全layers必须渲染，禁止+N替代或静默截断，3+层按获批UI v6自适应。",
        "写死 centerLayerId===layers[layers.length-1].id；center label/value只来自最内层，percent null 显示—或允许的安全短余量，不借外层percent；不满足 invariant 时开发测试失败。",
        "每层独立 clamp/tone：>=95 danger、>=80 warning、其余 normal；percent:null为muted empty arc且无aria-valuenow=0。",
        "按获批UI v6实现固定可区分layer hue/stroke token，不能只靠透明度；warning/danger作为本层第二通道叠加，不能抹掉相邻层身份。",
        "为可信percent>0的used arc增加CSS-only subtle sheen/flow overlay，mask只覆盖used arc且不改变弧长；null/0无流光；prefers-reduced-motion下完全停止流光与非必要过渡。",
        "Full、Compact、aggregate共用 primitive；Compact正常quota改为provider label+一个N-ring unit，standalone Full/Compact仍由原click打开detail。",
        "建立aggregate安全projection contract，禁止accountId、credential、profileArn、raw error/response。",
        "实现aggregate非accordion分栏壳：所有enabled provider card同时存在，Desktop 1–3列、窄屏响应式单列/两列且不隐藏provider；壳不fetch。",
        "实现hover/focus状态机：trigger pointerenter或键盘/程序化focus打开；trigger与panel任一区域有pointer/focus则保持；全部离开后固定220ms grace delay关闭，重入取消timer；focusout检查activeElement避免portal瞬断。",
        "Escape关闭并设置suppression，panel内焦点可回trigger但不得因focus立刻重开；suppression在trigger blur或新pointerenter后清除；普通mouseleave/blur不抢焦点；清理timer/listener。",
        "aggregate trigger提供aria-haspopup/expanded/controls；panel非模态、viewport-clamped、Tab可进入各provider列，不设focus trap；点击不是必需toggle。",
        "更新primitive/compact/shell tests覆盖1/2/N rings、层顺序、中心最内层、独立阈值、unknown、层token、flow/reduced-motion CSS、hover bridge、delayed close、focusout、Escape suppression和非accordion结构。"
      ],
      "acceptance": [
        "Full、Compact、aggregate共用一套N-ring primitive。",
        "层身份明显且风险独立叠加；unknown不伪造0%。",
        "used arc有静态可降级流光，reduced-motion无动画。",
        "aggregate hover/focus可稳定跨入panel，Escape不重开。",
        "所有provider按分栏同时展示，无accordion或总环，shell无fetch。"
      ],
      "validation": [
        "npm run test:provider-usage-compact",
        "node_modules/.bin/tsc --noEmit",
        "浏览器验证N-ring/flow/reduced-motion及hover/focus columns at 320/375/640/Desktop"
      ],
      "risks": [
        "层色在tone覆盖后趋同",
        "流光造成进度增长错觉或GPU开销",
        "Escape focus回传触发重开",
        "trigger-panel间隙闪退",
        "portal Tab顺序不可达",
        "N层极限尺寸未由UI v6确认"
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
      "id": "USAGE-AGG-03",
      "title": "适配 GPT 外周内5h与最内层中心",
      "phase": "provider-adapter",
      "order": 2,
      "dependsOn": ["USAGE-AGG-02"],
      "relation": "parallel",
      "parallelGroup": "provider-adapters",
      "files": [
        "components/ChatGptUsagePanel.tsx",
        "scripts/test-chatgpt-usage-panel.mjs"
      ],
      "instructions": [
        "新增默认standalone的aggregate presentation并复用同一detail body；aggregate不渲染自身trigger/dialog/outside handler。",
        "将安全window投影为layers：[week,5h]；两者存在时外周内5h，中心始终最内层5h；single按实际窗口。",
        "5h percent unknown但窗口存在时仍保留内层与center 5h/—，week可独立填充；只有5h窗口不存在时才center周。",
        "Full/Compact/Aggregate复用同unit；正常Compact不构造文字summaries。",
        "保持accounts polling、同accountId page fallback、generation/account guards、刷新/Activate/Reset/scheduler/repair；detail列未需要时不额外加载次级scheduler，Models前关闭aggregate。",
        "测试层顺序、center invariant、unknown、single fallback、layer tone/flow props、standalone click及无重复请求/秘密字段。"
      ],
      "acceptance": [
        "GPT双窗口为一个外周内5h unit，中心5h。",
        "5h unknown不借week percent，only-week中心同步为周。",
        "provider操作与race/fallback语义无回归。"
      ],
      "validation": [
        "npm run test:chatgpt-usage-panel",
        "npm run test:provider-usage-compact",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "内外层颠倒",
        "unknown借用外层percent",
        "分栏detail破坏GPT专属工具"
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
      "id": "USAGE-AGG-04",
      "title": "适配 Grok 外月内周与最内层中心",
      "phase": "provider-adapter",
      "order": 2,
      "dependsOn": ["USAGE-AGG-02"],
      "relation": "parallel",
      "parallelGroup": "provider-adapters",
      "files": [
        "components/GrokUsagePanel.tsx",
        "scripts/test-grok-usage-panel-config.mjs"
      ],
      "instructions": [
        "新增默认standalone的aggregate presentation并复用detail；aggregate不创建自身trigger/dialog/outside handler。",
        "month/week都存在时投影layers=[month,week]，外月内周，centerLayerId必须为最内层week；这替代旧中心month规则。",
        "week percent unknown但窗口存在时中心周/—且month独立填充；只有week窗口不存在时single month并中心月。",
        "stale且有可信同账号数据时逐层保留并标warning context；reauth/error无可信quota时发布短fallback。",
        "保持metadata、force refresh、Activate、generation/accountId guards、Models恢复；Models前关闭aggregate。",
        "测试外月内周、中心周、week unknown、only-month/only-week、逐层tone/flow props、standalone click和安全文案。"
      ],
      "acceptance": [
        "Grok双窗口中心为最内层周，不再为月。",
        "week unknown不借month percent，single fallback同步。",
        "stale/reauth/cache/race语义无回归。"
      ],
      "validation": [
        "npm run test:grok-usage-panel",
        "npm run test:grok-quota",
        "npm run test:grok-accounts",
        "npm run test:provider-usage-compact",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "沿用v5中心月旧逻辑",
        "week unknown借用month percent",
        "stale误标fresh"
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
      "id": "USAGE-AGG-05",
      "title": "适配 Kiro 统一1/N窗口多环、remaining与安全排序",
      "phase": "provider-adapter",
      "order": 2,
      "dependsOn": ["USAGE-AGG-02"],
      "relation": "parallel",
      "parallelGroup": "provider-adapters",
      "files": [
        "components/KiroUsagePanel.tsx",
        "scripts/test-provider-usage-compact.mjs"
      ],
      "instructions": [
        "新增默认standalone的aggregate presentation并复用detail；aggregate不创建自身trigger/dialog/outside handler。",
        "取消Kiro默认primary single特例：遍历所有safe normalized buckets；1个安全窗口=single，多个安全且有可靠duration/order证据的窗口全部按long→short进入layers。",
        "center始终最内层bucket；percent只能来自该bucket自身可信utilization，label来自安全normalized label/resourceType。",
        "remaining仅经formatKiroRemaining进入unknownCenterValue、shortValue或title，不得换算percent或参与排序。",
        "无法安全投影/排序的bucket不强排，留在detail并使用固定安全说明；禁止reset、remaining、unit、数组顺序或产品常识推断，禁止全局硬编码Credit。",
        "保持GetUsageLimits、generation/accountId/safeQuota guards、刷新/Activate/Models；Models前关闭aggregate。",
        "测试1 window、2/N ordered windows、中心最内层、innermost unknown、部分不可排序降级、remaining-only、utilization来源、layer flow/tone props及无AWS秘密字段。"
      ],
      "acceptance": [
        "Kiro遵循统一1/N ring规则，不再默认single。",
        "仅安全且可靠排序窗口进入多环，中心为最内层。",
        "remaining无假percent，安全/race边界无回归。"
      ],
      "validation": [
        "npm run test:provider-usage-compact",
        "npm run test:kiro-quota",
        "npm run test:kiro-accounts",
        "npm run test:kiro-refresh-activate-race",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "把primary误当唯一可展示层",
        "remaining/数组顺序被误作排序依据",
        "N层极端数量布局",
        "AWS字段泄露"
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
      "id": "USAGE-AGG-06",
      "title": "接入 AppShell 互斥挂载并补N-ring与hover/focus契约测试",
      "phase": "integration",
      "order": 3,
      "dependsOn": [
        "USAGE-AGG-01",
        "USAGE-AGG-03",
        "USAGE-AGG-04",
        "USAGE-AGG-05"
      ],
      "relation": "barrier",
      "files": [
        "components/AppShell.tsx",
        "scripts/test-provider-usage-aggregate.mjs",
        "package.json"
      ],
      "instructions": [
        "AppShell读取providerPanelsAggregated；false保留standalone/displayMode/click detail，true只渲染一个aggregate panel并传enabled providers/onOpenModels。",
        "保持showAnyProviderUsage、SessionStatsChips padding、single host/right padding；零provider不挂载host。",
        "新增aggregate tests覆盖配置默认、互斥JSX、provider顺序、每provider一个N-ring unit、GPT中心5h、Grok中心周、Kiro 1/N统一规则、innermost unknown、逐层identity/tone、flow/reduced-motion、无总环与projection安全。",
        "覆盖非accordion columns、hover/focus open、trigger→panel grace bridge、focusout activeElement检查、Escape suppression、普通blur不抢焦点和timer cleanup。",
        "断言Compact不走正常文字summary，standalone Full/Compact仍click detail。",
        "真实浏览器Network对比aggregate on/off，确认每provider accounts/quota请求不翻倍。"
      ],
      "acceptance": [
        "aggregate=false standalone稳定且click detail保留。",
        "aggregate=true只有一个focus/hover trigger与分栏panel，无hidden standalone/accordion/总环。",
        "1/2/3 provider正确，0 provider隐藏，无双状态或秘密字段。",
        "Escape、延迟关闭、reduced-motion正确。"
      ],
      "validation": [
        "npm run test:provider-usage-aggregate",
        "npm run test:provider-usage-compact",
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "浏览器Network与键鼠交互验证"
      ],
      "risks": [
        "hidden standalone仍挂载",
        "hover/focus timer在热切换后残留",
        "portal焦点路径不可进入columns",
        "壳层二次解释窗口顺序"
      ],
      "parallelizable": false,
      "member": "implementer",
      "failurePolicy": "block_dependents",
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "USAGE-AGG-07",
      "title": "完成文档、全量验证与UI v6验收",
      "phase": "validation-docs",
      "order": 4,
      "dependsOn": ["USAGE-AGG-06"],
      "relation": "barrier",
      "files": [
        "docs/architecture/overview.md",
        "docs/modules/frontend.md",
        "docs/modules/api.md",
        "docs/modules/library.md",
        "docs/integrations/README.md",
        "docs/operations/troubleshooting.md"
      ],
      "instructions": [
        "文档说明aggregate默认关闭、shared N-ring、外长内短、中心最内层、层identity+逐层tone、used-arc flow/reduced-motion、Kiro统一安全多窗口规则、hover/focus分栏、standalone click、无总环/新API。",
        "troubleshooting记录providerPanelsAggregated=false止血，并说明Compact偏好、credentials/cache不删除。",
        "运行lint、tsc、aggregate、compact、config和provider tests；不得直接运行next build。",
        "对照获批UI v6验证Full/Compact/Aggregate 1/2/N rings、明显层色、独立tone、innermost center/unknown、flow/reduced-motion、provider columns、hover bridge、keyboard focus、Escape suppression、Desktop/640/375/320。",
        "检查Network无双轮询；DOM/tooltip/projection无accountId、credential、profileArn、raw body/path；记录环境限制。"
      ],
      "acceptance": [
        "自动验证通过且provider操作无回归。",
        "N-ring层级、中心、层色、tone、flow与UI v6一致。",
        "hover/focus分栏在键鼠与窄屏可用。",
        "文档不宣称accordion、Grok中心月、Kiro默认single、总环或新quota API。"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "npm run test:provider-usage-aggregate",
        "npm run test:provider-usage-compact",
        "npm run test:kiro-config",
        "npm run test:chatgpt-usage-panel",
        "npm run test:grok-usage-panel",
        "npm run test:grok-quota",
        "npm run test:grok-accounts",
        "npm run test:kiro-quota",
        "npm run test:kiro-accounts",
        "npm run test:kiro-refresh-activate-race"
      ],
      "risks": [
        "源码测试通过但hover/focus/reduced-motion视觉回归",
        "N层真实数据超过v6样例",
        "真实账号不足导致状态矩阵未覆盖"
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
    "maxParallel": 3,
    "groups": [
      {
        "id": "foundation",
        "title": "配置与shared N-ring/focus-hover分栏壳并行",
        "relation": "parallel",
        "subtaskIds": ["USAGE-AGG-01", "USAGE-AGG-02"]
      },
      {
        "id": "provider-adapters",
        "title": "三家provider统一多窗口adapter并行",
        "relation": "parallel",
        "dependencies": ["foundation"],
        "subtaskIds": ["USAGE-AGG-03", "USAGE-AGG-04", "USAGE-AGG-05"]
      },
      {
        "id": "integration",
        "title": "AppShell集成与N-ring/hover契约测试",
        "relation": "barrier",
        "dependencies": ["provider-adapters"],
        "subtaskIds": ["USAGE-AGG-06"]
      },
      {
        "id": "validation-docs",
        "title": "验证与文档收口",
        "relation": "barrier",
        "dependencies": ["integration"],
        "subtaskIds": ["USAGE-AGG-07"]
      }
    ]
  }
}
```

## 验证命令

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:provider-usage-aggregate
npm run test:provider-usage-compact
npm run test:kiro-config
npm run test:chatgpt-usage-panel
npm run test:grok-usage-panel
npm run test:grok-quota
npm run test:grok-accounts
npm run test:kiro-quota
npm run test:kiro-accounts
npm run test:kiro-refresh-activate-race
```

不直接运行 `next build`。

## 检查门禁

1. UI 设计员必须交付并由用户批准 v6：明显层色/stroke、used-arc flow、reduced-motion、center innermost、Kiro统一N-ring、hover/focus分栏与窄屏。
2. 主会话重新保存本 revision implementationPlan，保持 `awaiting_approval`；批准后才进入 implementing。
3. 每项局部 checker；最终 checker 验证 Network、320–375px、键鼠/Focus/Escape、reduced-motion。
4. 出现以下变化立即停下确认：center 不再最内层、恢复 accordion/click-primary、总环/总百分比、新 API、remaining 推导 percent、默认开启 aggregate、改写 Compact 值。

## 回滚

1. `providerPanelsAggregated=false` 恢复 standalone。
2. flow overlay 可独立禁用；N-ring renderer 可回滚为静态 renderer，不改 quota/config 数据。
3. Compact renderer可独立回滚；不重写 auth、quota cache、Reset/scheduler、models、session JSONL 或 ledger。