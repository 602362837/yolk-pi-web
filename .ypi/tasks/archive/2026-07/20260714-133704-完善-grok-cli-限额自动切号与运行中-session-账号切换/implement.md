# Implement：Grok 全局 Active 自动切号（GPT 零回归）

## 实现前置条件

1. 用户批准 [`plan-review.md`](plan-review.md)。
2. UI 设计员已把 `grok-global-account-failover-prototype.html` 修订为“明确限额/限流”，并由用户批准。
3. 主会话保存本文件的 implementationPlan。
4. 任务由主会话显式进入 `implementing`。

当前仍为 `awaiting_approval`，不得修改生产代码。

## 优先阅读

1. `AGENTS.md`
2. `docs/integrations/README.md`
3. `docs/architecture/overview.md`
4. `docs/modules/api.md`, `docs/modules/frontend.md`, `docs/modules/library.md`
5. `docs/standards/code-style.md`
6. `lib/chatgpt-account-failover.ts`
7. `lib/rpc-manager.ts` 的 `patchChatGptAccountFailover()`、`patchOpencodeGoAccountFailover()`、`reloadRpcAuthState()`
8. `lib/oauth-accounts.ts`, `lib/subscription-quota.ts`, Activate route
9. installed Pi 0.80.6 `docs/extensions.md` 与 `dist/core/agent-session.js`
10. `lib/grok-subscription-quota.ts`, `lib/grok-account-token.ts`
11. `lib/pi-provider-extensions.ts`, `lib/grok-session-account.ts`
12. `lib/pi-web-config.ts`, `app/api/web-config/route.ts`
13. `hooks/useAgentSession.ts`, `components/ModelsConfig.tsx`, `components/SettingsConfig.tsx`, `components/ChatInput.tsx`
14. `lib/ypi-studio-child-session-runner.ts` 及现有 runner tests（只用于无回归，不把内部边界交给用户决策）
15. 用户批准的修订 HTML；旧 `.superseded.html` 禁止使用

## 实施策略门禁

### 先固化 GPT，后决定是否共享

第一步只建立 GPT characterization/contract，不能先抽 core。必须覆盖：

- 手动 Activate A 后明确 GPT quota/rate-limit detector 命中并 A→B；
- default-off/provider gate/现有 detector 正负例；
- run 前 trigger Active capture；
- 1 attempt / 1 switch、success reset；
- cooldown/min interval/circular candidate order/cache-query；
- active-changed after lock / before activate；
- Activate/reload、failed assistant identity removal、same-turn continue；
- SSE status/event；
- OpenCode Go wrapper chain。

### Path A：允许共享的证据

只有同一组 GPT fixture 在抽取前后全部通过，且 source review确认以下内容都未变，才可新增 `lib/oauth-account-failover.ts`：

- exports/status/reason/message；
- detector；
- budget mutation时机；
- candidate顺序与 quota query；
- lock/cooldown/min interval；
- reload调用；
- wrapper early-return、消息移除和事件。

### Path B：默认安全回退

任一 GPT 差异无法解释或测试无法稳定复现，停止共享重构：

- 保留 `lib/chatgpt-account-failover.ts` 和 `patchChatGptAccountFailover()` 生产逻辑；
- 新建 Grok 独立 controller及 provider-scoped process state；
- 在 `rpc-manager` 以 Grok-only外层 patch接入，对非 Grok直接透传；
- 只共享纯类型或无状态 utility。

实现评审必须记录选择 Path A/B 的测试证据，不能以“代码更漂亮”为理由修改 GPT。

## 人类可读子任务表

| ID | 阶段 | 顺序 | 依赖 | 内容 | 可并行 |
| --- | --- | ---: | --- | --- | --- |
| `gpt-failover-characterization` | tests | 1 | 无 | 固化 GPT 手动 Active、detector、预算、锁、reload、retry/event contract | 否 |
| `grok-global-active-auth` | backend | 2 | GPT baseline | 退役 Grok Session pin，打通全局 Active + live reload | 是 |
| `grok-provider-adapter` | backend | 2 | GPT baseline | 明确限额/限流 classifier、quota candidate、config、token force refresh | 是 |
| `grok-runtime-integration` | integration | 3 | auth, adapter | 证据选择 shared/independent path，接入 runtime retry/SSE | 否 |
| `grok-global-ui` | frontend | 4 | runtime, 批准原型 | Models/Settings/Chat 按修订原型实现 | 否 |
| `grok-regression-docs` | checks/docs | 5 | 全部 | GPT/Grok/其他 provider/后台流程回归与文档迁移 | 否 |

## 执行说明

### 1. GPT characterization

- 测试使用临时 `PI_CODING_AGENT_DIR`、fake clock/quota/activate/reload 或隔离 child process，禁止读取真实账户和网络。
- 若必须增加 test seam，只做 additive dependency injection，生产默认依赖和调用顺序不变。
- 把当前 GPT detector 的准确正负例写成 golden contract；不要借机放宽/收紧。
- 明确测试 manual Activate A 没有 lock语义，后续 detector命中仍会 failover。

### 2. Grok 全局 Active auth

- 从 Web main inference extension list移除 `grokSessionAccountExtension`，保留 `grokCliExtension`。
- 移除 set_model/resume/fork/destroy/后台 child 创建的 bind/restore/inherit/unbind。
- 保留 `SessionHeader.grokAccountStorageId?` 为 deprecated ignored，不重写 JSONL。
- reload后以 registry中同 provider/model identity 的最新 descriptor替换 live内存对象；不调用 `setModel()`、不写 `model_change`。
- 测试两个 live Grok Session 手动 A→B 后下一请求均使用 B，in-flight仍为 A。

### 3. Grok provider adapter

- classifier结构化 code/type优先，再使用脱敏文本 allowlist。
- positive至少覆盖确认的 quota/usage/credits/monthly/weekly exhaustion 与明确 rate-limit-exceeded/too-many-requests；裸状态/模糊帮助文本为 negative。
- auth/network/timeout/5xx/context/content/model errors为 negative。
- quota candidate校验 fresh monthly/weekly/reauth/credential。
- `getGrokAccessToken(...,{forceRefresh:true})` 必须即使 token未过期也刷新；billing 401/403最多重试一次。
- 增加独立 `grok.autoFailover` 配置，默认 false，旧 config兼容。
- fixed token覆盖 managed OAuth 时返回安全 bypass，不产生“已切换但请求没换 token”的假成功。

### 4. Runtime integration

- 根据 GPT tests选择 Path A 或 B，并在评审记录证据。
- request/run前快照 Active；Pi original post-run返回 false后才处理 Grok。
- `switched` / `already_switched_by_other_session` 才 retry。
- 仅当失败 assistant仍为最后一条且 identity相同才移除。
- Grok每 turn默认最多 1 attempt、1 switch、1 retry；成功 turn重置。
- 新增 sanitized `grok_account_failover`；ChatGPT event不改。
- 回归 OpenCode Go wrapper顺序和语义。

### 5. UI

- 只按用户批准的修订 HTML实现。
- Models说明 global Active、manual Active非锁定、in-flight不变。
- Settings开关默认关闭，文案为“明确限额或限流”；不得保留“普通 rate limit 一律不触发”。
- Chat复用 notice/retry area，不新增 current Session selector。
- 只有 `retry:true` 显示正在重试；no candidate/budget/failed 为 terminal notice。

### 6. 验证与文档

- 先运行 GPT contract，再运行 Grok adapter/runtime/global auth。
- 浏览器验证 manual Activate→明确限流→自动切号、并发、无候选、in-flight。
- 更新 architecture/API/frontend/library/integrations/troubleshooting，移除 Session pin与“新 Session 默认”陈旧说明。
- 对其他 provider和后台 runner执行现有回归，不要求用户理解内部边界。

## Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "maxConcurrency": 2,
  "subtasks": [
    {
      "id": "gpt-failover-characterization",
      "title": "固化 ChatGPT/Codex 自动切号实际行为",
      "phase": "tests",
      "order": 1,
      "dependsOn": [],
      "files": [
        "lib/chatgpt-account-failover.ts",
        "lib/rpc-manager.ts",
        "scripts/test-chatgpt-failover-contract.mjs",
        "package.json"
      ],
      "instructions": [
        "先对当前实现建立 characterization tests，不先抽共享 core。",
        "覆盖手动 Activate A 后 quota/rate-limit detector 命中并切到 B、预算、锁、双检、候选、reload、retry/event。",
        "使用临时 agent dir 和 fake/isolated dependencies，不读取真实账号或网络；必要 test seam必须 additive且生产默认行为不变。"
      ],
      "acceptance": [
        "GPT 当前 detector、status、reason、message、预算和候选顺序被测试固定。",
        "证明 manual Activate 不产生锁定，后续 eligible error仍会 failover。",
        "Pi native retry/compaction先于 failover，OpenCode Go patch chain有基线证据。"
      ],
      "validation": [
        "npm run test:chatgpt-failover-contract",
        "npm run test:opencode-go-failover-behavior",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "现有 controller依赖全局状态和文件存储，测试需隔离进程/clock。",
        "不得借测试 seam改变 GPT生产依赖。"
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "grok-global-active-auth",
      "title": "退役 Grok Session pin并打通全局 Active live reload",
      "phase": "backend",
      "order": 2,
      "dependsOn": ["gpt-failover-characterization"],
      "files": [
        "lib/pi-provider-extensions.ts",
        "lib/rpc-manager.ts",
        "lib/grok-session-account.ts",
        "lib/ypi-studio-child-session-runner.ts",
        "lib/types.ts",
        "scripts/test-grok-global-auth.mjs"
      ],
      "instructions": [
        "移除 main inference session-bound Authorization override和全部 pin lifecycle。",
        "保留 grokAccountStorageId为deprecated ignored字段，不迁移历史JSONL。",
        "reload后刷新same-identity model descriptor，不调用setModel、不写model_change。",
        "验证手动Activate影响两个普通live Grok Session的下一请求，in-flight不变。"
      ],
      "acceptance": [
        "manual Activate是全局当前账号且不是Session lock。",
        "resume/fork/旧header不再改变请求auth。",
        "Grok provider/models/tools仍可用，其他后台流程无回归。"
      ],
      "validation": [
        "npm run test:grok-global-auth",
        "npm run test:grok-provider",
        "npm run test:studio-sdk-runner",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "dynamic provider descriptor可能在registry refresh后陈旧。",
        "移除pin消费者必须全仓搜索，不能留隐式restore。"
      ],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "grok-provider-adapter",
      "title": "实现 Grok 限额限流分类、额度候选与 token 强刷",
      "phase": "backend",
      "order": 2,
      "dependsOn": ["gpt-failover-characterization"],
      "files": [
        "lib/grok-account-failover.ts",
        "lib/grok-subscription-quota.ts",
        "lib/grok-account-token.ts",
        "lib/pi-web-config.ts",
        "app/api/web-config/route.ts",
        "scripts/test-grok-failover-adapter.mjs",
        "package.json"
      ],
      "instructions": [
        "用结构化code/type和脱敏fixture建立明确quota与rate-limit allowlist，拒绝宽泛limit/rate regex。",
        "实现monthly/weekly/freshness/reauth candidate判定。",
        "增加grok.autoFailover默认关闭配置。",
        "实现forceRefresh:true和401/403单次refresh+retry，处理fixed-token bypass假成功风险。"
      ],
      "acceptance": [
        "明确限额/限流fixture触发，auth/network/timeout/5xx/context/content/model和模糊文本不触发。",
        "fresh usable候选可选，exhausted/stale/reauth/query failure不可选。",
        "未过期token也可强制刷新，billing最多重试一次。"
      ],
      "validation": [
        "npm run test:grok-failover-adapter",
        "npm run test:grok-quota",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "缺少真实脱敏rate-limit fixture会导致漏报，不能用过宽匹配掩盖。",
        "固定env token可能使managed Activate不是实际凭据来源。"
      ],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "grok-runtime-integration",
      "title": "按 GPT 零回归证据接入 Grok runtime failover",
      "phase": "integration",
      "order": 3,
      "dependsOn": ["grok-global-active-auth", "grok-provider-adapter"],
      "files": [
        "lib/oauth-account-failover.ts",
        "lib/chatgpt-account-failover.ts",
        "lib/grok-account-failover.ts",
        "lib/rpc-manager.ts",
        "hooks/useAgentSession.ts",
        "scripts/test-grok-failover-runtime.mjs"
      ],
      "instructions": [
        "先用GPT tests决定Path A shared core或Path B Grok独立patch；任何未解释GPT差异必须选Path B。",
        "在Pi原生post-run返回false后处理Grok，请求前捕获trigger Active。",
        "仅switched/already-switched允许retry，并用对象identity保护失败assistant移除。",
        "新增sanitized Grok SSE；ChatGPT event和UI映射不改。"
      ],
      "acceptance": [
        "手动Activate A后明确限额/限流可A→B并同turn重试一次。",
        "并发Session最多一次实际switch，后进入者不切C。",
        "GPT contract全绿；不能证明共享安全时GPT生产controller保持原样。",
        "OpenCode Go行为无回归。"
      ],
      "validation": [
        "npm run test:chatgpt-failover-contract",
        "npm run test:grok-failover-runtime",
        "npm run test:opencode-go-failover-behavior",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "Pi private method shape或wrapper顺序变化。",
        "共享重构诱发GPT subtle budget/event漂移。"
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "grok-global-ui",
      "title": "按批准原型实现 Grok 全局 Active与限额限流反馈",
      "phase": "frontend",
      "order": 4,
      "dependsOn": ["grok-runtime-integration"],
      "files": [
        "components/ModelsConfig.tsx",
        "components/SettingsConfig.tsx",
        "components/ChatInput.tsx",
        "hooks/useAgentSession.ts",
        "app/globals.css",
        "docs/modules/frontend.md"
      ],
      "instructions": [
        "只在修订HTML经用户批准后实施。",
        "Models说明global Active、manual Active非锁定、in-flight边界。",
        "Settings使用明确限额或限流文案且默认关闭。",
        "Chat复用notice/retry，不新增Session账号selector；terminal状态不显示Retrying。"
      ],
      "acceptance": [
        "UI与批准HTML一致且无current-Session pin/lock语义。",
        "用户能理解手动Active也可能在明确限额/限流后自动轮换。",
        "键盘、读屏、窄屏和display-safe要求通过。"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "Playwright桌面与<=640px Models/Settings/Chat流程"
      ],
      "risks": [
        "沿用旧原型的rate-limit排除文案会违背最新需求。",
        "terminal failover状态误显示正在重试。"
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "grok-regression-docs",
      "title": "完成 GPT/Grok及其他功能回归与文档迁移",
      "phase": "checks",
      "order": 5,
      "dependsOn": ["grok-global-ui"],
      "files": [
        "docs/architecture/overview.md",
        "docs/modules/api.md",
        "docs/modules/frontend.md",
        "docs/modules/library.md",
        "docs/integrations/README.md",
        "docs/operations/troubleshooting.md",
        "package.json"
      ],
      "instructions": [
        "运行GPT contract、Grok adapter/runtime/global auth、OpenCode Go、provider、后台runner、lint/typecheck。",
        "浏览器验收manual Activate后限额/限流自动切换、并发、无候选、in-flight。",
        "文档统一为global Active，记录deprecated header和shared/independent实际选择证据。"
      ],
      "acceptance": [
        "PRD每项需求有自动或人工证据。",
        "GPT现有行为零漂移，其他provider/后台功能无回归。",
        "文档和UI不再描述Grok Session pin或manual lock。",
        "输出和截图无真实敏感账号信息。"
      ],
      "validation": [
        "npm run test:chatgpt-failover-contract",
        "npm run test:grok-all",
        "npm run test:grok-global-auth",
        "npm run test:grok-failover-adapter",
        "npm run test:grok-failover-runtime",
        "npm run test:opencode-go-failover-behavior",
        "npm run test:studio-sdk-runner",
        "npm run lint",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "真实限流难稳定复现，需要fixture与受控模拟。",
        "不得直接运行next build；发布验证才使用npm run build。"
      ],
      "parallelizable": false,
      "localReview": true
    }
  ],
  "execution": {
    "groups": [
      { "id": "group-gpt-baseline", "mode": "serial", "subtaskIds": ["gpt-failover-characterization"] },
      { "id": "group-grok-foundation", "mode": "parallel", "subtaskIds": ["grok-global-active-auth", "grok-provider-adapter"] },
      { "id": "group-runtime-ui", "mode": "serial", "subtaskIds": ["grok-runtime-integration", "grok-global-ui"] },
      { "id": "group-validation", "mode": "serial", "subtaskIds": ["grok-regression-docs"] }
    ]
  }
}
```

## 验证命令

现有基线：

```bash
npm run test:grok-all
npm run test:opencode-go-failover-detect
npm run test:opencode-go-failover-behavior
npm run test:studio-sdk-runner
npm run lint
node_modules/.bin/tsc --noEmit
```

新增 scripts 后：

```bash
npm run test:chatgpt-failover-contract
npm run test:grok-global-auth
npm run test:grok-failover-adapter
npm run test:grok-failover-runtime
```

不要直接运行 `next build`；仅发布验证使用 `npm run build`。

## 评审门禁

- GPT baseline review：manual Active、detector、budget、lock、reload、retry/event已被真实行为测试固定。
- Integration strategy review：有明确 Path A/B 证据；任何 GPT 差异已选择 Path B。
- Auth review：无 Session pin残留，旧 header ignored，descriptor refresh不写 `model_change`。
- Adapter review：明确 quota/rate-limit正例、模糊/非限额负例、freshness、force refresh。
- Runtime review：private patch chain、identity removal、单次预算、并发不切 C。
- UI review：逐项对照修订批准 HTML，没有 manual lock/current-session语义。
- Checker：必须实际反证“用户手动 Activate A 后，A仍可因明确限额/限流自动切到 B”。

## 回滚

- 首先关闭 `grok.autoFailover.enabled`。
- 撤下 Grok adapter/event/Settings入口，GPT 保持原路径。
- 若采用 Path A 且回归异常，恢复 GPT facade/controller原实现并转 Path B。
- 必要时恢复旧 Grok pin extension/lifecycle；不迁移或删除历史 header。
- 不删除账号 store、quota cache、auth.json备份或 Session JSONL。
