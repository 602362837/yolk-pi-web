# Kiro provider 最终复查（KIRO-11）

## Verdict

**Ready。** KIRO-10 的两个阻塞项均已关闭：Kiro cold Auth/Models 的真实 Next dev 路径不再解析 `proper-lockfile` 或 nested `package.json`，并且 refresh–Activate 并发检查现通过真实生产 `getKiroAccessToken()` 路径，而非测试内 credential 写入模拟。

## Findings Fixed / Confirmed

- `lib/kiro-account-lock.ts` 仅以 Node `fs/promises.mkdir()` 的独占目录锁协调 refresh/Activate；不存在 `proper-lockfile`、`createRequire` 或 `@earendil-works/pi-coding-agent/package.json` 的静态解析。
- 隔离 `PI_CODING_AGENT_DIR` 的真实 Next dev smoke（port 30143）：冷 `GET /api/auth/providers` 返回 **200** 且含 `kiro`，冷 `GET /api/models` 返回 **200** 且有 `modelList`；dev 日志没有 `Module not found` / `Can't resolve` / error diagnostics。
- `test:kiro-refresh-activate-race` 以注册的受控 OAuth provider 驱动真实 `getOAuthApiKey → provider.refreshToken → atomic credential write → lock-held Active CAS`；覆盖 `refresh(A)+Activate(B)`、`refresh(B)+Activate(A)`，以及 refresh 持锁时的 Activate 竞争，均确认最终 `accounts.json` Active 和 `auth.json` mirror 属于新 Active。
- 浏览器实测 Settings 左侧同级的 ChatGPT / Grok / Kiro 分节；全局「顶部额度组件简要显示」仅位于 Usage，Kiro 分节仅含 Kiro panel/failover 开关。启用 GPT/Grok/Kiro panel + compact 后，顶栏顺序为 GPT → Grok → Kiro；Kiro compact fallback 为「Kiro 登录」，点击仍打开详细面板，Escape 关闭。320px 下 `document/body.scrollWidth === innerWidth === 320`，无文档横向溢出；浏览器 console 无应用错误。

## Verification

- `npm run lint` — passed; 0 errors, 6 pre-existing warnings.
- `node_modules/.bin/tsc --noEmit` — passed.
- `git diff --check` — passed.
- `npm run test:kiro-cold-auth` — 14 passed.
- `npm run test:kiro-refresh-activate-race` — 4 passed.
- `npm run test:kiro-provider` — 30 passed.
- `npm run test:kiro-accounts` — 28 passed.
- `npm run test:kiro-quota` — 37 passed.
- `npm run test:kiro-failover-adapter` — 40 passed.
- `npm run test:kiro-failover-runtime` — 10 passed.
- `npm run test:kiro-integration` — 29 passed; explicitly records absent local real Kiro credentials.
- `npm run test:provider-usage-compact` — passed.
- `npm run test:chatgpt-usage-panel` — passed.
- `npm run test:grok-all` — passed.
- `npm run test:opencode-go-failover-behavior` — 54 passed.
- Isolated Next dev + browser smoke — passed; cold routes HTTP 200, no resolver diagnostics, Settings/compact desktop and 320px check passed.

## Remaining Risks

- No local Kiro OAuth credentials are available. Real Builder ID/social login, model inference, GetUsageLimits values, multi-account Activate, and live quota-failover remain unexecuted and are not claimed as accepted. This is an environment limitation recorded by the integration test, not a code blocker.
