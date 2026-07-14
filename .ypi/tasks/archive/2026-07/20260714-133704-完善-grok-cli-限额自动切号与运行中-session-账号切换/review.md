# Review

## Verdict: Pass（有一处低风险 a11y 已由检查员修复）

实现员采用 **Path B（Grok 独立 controller）**，未抽 shared core。`lib/chatgpt-account-failover.ts` 与 HEAD 字节一致；OpenCode Go / Studio runner / Grok 既有测试全绿。

### 关键结论对照

| 检查项 | 结论 |
| --- | --- |
| 手动 Active 后明确限额/限流可切号重试 | Pass。controller 无 lock/pin/manual 门禁；run 前快照 Active；命中后 Activate+reload+retry |
| GPT 生产逻辑零漂移 | Pass。chatgpt 生产文件未改；contract 25/25；Settings GPT 文案保留“普通 429/rate limit 不触发” |
| OpenCode Go / Studio runner | Pass。behavior 54、detect 59、sdk-runner 通过 |
| classifier 负例 | Pass。network/timeout/5xx/auth/裸 429/模糊 rate 文本不触发 |
| Session pin 退役 | Pass。main inference / resume / fork / Studio child 无 bind/restore/unbind |
| UI 与批准原型 | Pass。Settings“明确限额或限流”；Models 全局 Active 非锁定；Chat 无 Session selector；terminal 不伪称 Retrying |
| 文档 | Pass。overview/library/frontend/api/integrations/troubleshooting 已迁到 global Active |

### Findings Fixed

- `components/SettingsConfig.tsx` `ToggleField` 补 `role="switch"` / `aria-checked` / `aria-label`（对齐原型与 FR-5 a11y；ChatGPT/OpenCode/Grok 共用控件一并受益）。

### Remaining Findings

- **非阻塞：** 多数 Grok/GPT 测试为 source/fixture 契约测试，未做真实多 Session 并发与真实 Grok rate-limit 网络演练；人工验收仍建议主会话按 checks 清单走一遍。
- **非阻塞：** Grok classifier 对 `rate[_ -]?limit(?:ed|ing)?` 的文本匹配比 GPT 更宽（产品要求），依赖 fuzzy 负例与 fixture；若上游出现新型模糊文案需再加负例。
- **非阻塞：** `lib/grok-session-isolation.test.ts` 仍测已退役 pin helper 的可调用性（兼容保留），不代表 pin 仍接入主路径。

### Verification（检查员实跑）

- `npm run test:chatgpt-failover-contract` — 25 passed
- `npm run test:grok-global-auth` — 7 passed
- `npm run test:grok-failover-adapter` — 29 passed
- `npm run test:grok-failover-runtime` — 9 passed
- `npm run test:opencode-go-failover-behavior` — 54 passed
- `npm run test:opencode-go-failover-detect` — 59 passed
- `npm run test:studio-sdk-runner` — passed
- `npm run test:grok-provider` — 36 passed
- `npm run test:grok-accounts` — 70 passed
- `npm run test:grok-quota` — 48 passed
- `npm run test:grok-session-isolation` — 24 passed
- `npm run test:oauth-accounts` — passed
- `npm run lint` — 0 errors（仅既有无关 warning）
- `node_modules/.bin/tsc --noEmit` — clean

### Path 证据

- 无 `lib/oauth-account-failover.ts`
- Grok 状态键 `__piGrokFailover` 独立
- 链：`patchGrok → patchOpencodeGo → patchChatGpt → Pi native`
