# Checks：pi SDK 0.80.10 迁移检查单

## 1. 需求覆盖检查

- [ ] 三个 Pi 核心包均 exact pin `0.80.10`，两个锁文件一致。
- [ ] `app/**`、`lib/**`、运行测试不再从 coding-agent root 导入 `AuthStorage`。
- [ ] 不存在 `ModelRegistry.create()`、`services.authStorage`、`services.modelRegistry`、`inner.modelRegistry`。
- [ ] main Chat、Studio child、Models/Auth、assist、model-price均向目标 ModelRuntime 注入 Grok/Kiro/Antigravity。
- [ ] 自管 CredentialStore 实现 `read/list/modify/delete`，没有 private SDK deep import。
- [ ] OAuth/API-key多账号 Active mirror、CAS、quota/failover不变。
- [ ] 无 Session/account/usage数据迁移，无 UI 结构/交互改动。

## 2. 自动验证

### 安装与静态检查

```bash
npm install
npm run lint
node_modules/.bin/tsc --noEmit
```

禁止 routine validation 直接运行 `next build`；仅在主会话决定做 release validation 时使用 `npm run build`。

### 静态迁移审计

```bash
rg -n 'AuthStorage|ModelRegistry\.create|services\.authStorage|services\.modelRegistry|inner\.modelRegistry' app lib scripts
node -e 'const p=require("./package.json"); for (const n of ["@earendil-works/pi-coding-agent","@earendil-works/pi-ai","@earendil-works/pi-agent-core"]) { if (p.dependencies[n]!=="0.80.10") throw new Error(`${n} not pinned`); }'
npm ls @earendil-works/pi-coding-agent @earendil-works/pi-ai @earendil-works/pi-agent-core pi-grok-cli pi-kiro-provider @yofriadi/pi-antigravity-oauth
```

预期：首个 `rg` 仅允许迁移说明文档/明确 negative assertion 字符串，不允许运行代码导入或调用。

### CredentialStore focused tests

- [ ] 空文件/缺失文件初始化与 `0700/0600` 权限。
- [ ] `read/list/modify/delete` 语义；`modify => undefined` 不删除。
- [ ] 同 provider并发 modify串行；不同 provider并发不丢字段。
- [ ] 跨进程 lock / stale recovery / timeout。
- [ ] atomic rename后始终是完整JSON。
- [ ] malformed JSON写入 fail-closed且原文件字节不变。
- [ ] OAuth附加字段保留。
- [ ] API key literal/env/template/escape/command语义；`list()`不执行command。
- [ ] 错误/日志不包含token或key。

### 现有 focused suites

```bash
npm run test:api-key-accounts
npm run test:oauth-accounts
npm run test:grok-all
npm run test:kiro-provider
npm run test:kiro-accounts
npm run test:kiro-cold-auth
npm run test:kiro-refresh-activate-race
npm run test:kiro-quota
npm run test:kiro-failover-runtime
npm run test:antigravity-provider
npm run test:antigravity-callback-security
npm run test:antigravity-accounts
npm run test:antigravity-refresh-activate-race
npm run test:antigravity-quota
npm run test:antigravity-failover-runtime
npm run test:antigravity-integration
npm run test:model-prices
npm run test:studio-sdk-runner
npm run test:session-model-pin
```

实现员应根据实际新增脚本补充 `test:web-credential-store` / `test:pi-sdk-runtime`，checker按 package.json 最终命令执行。

## 3. API smoke

在隔离 `PI_CODING_AGENT_DIR` 或测试专用 agent dir 启动 `npm run dev` 后：

- [ ] `GET /api/models?cwd=<allowed>` 返回模型、provider显示名、thinking levels。
- [ ] `GET /api/auth/providers` 返回 OAuth providers 和 loggedIn/managed摘要。
- [ ] `GET /api/auth/all-providers` / `GET /api/auth/api-key/xai` 返回 managed状态。
- [ ] single API-key provider POST→GET→DELETE 后 status同步。
- [ ] managed xAI/OpenCode Go add→activate→update→delete后 `auth.json`仅镜像Active。
- [ ] `GET /api/model-prices?cwd=<allowed>` 正常；Models Config test使用临时models路径且不污染默认目录。
- [ ] quota routes保留 `Cache-Control: no-store`，POST限制不变。
- [ ] API错误不返回token、refresh、projectId、raw body或绝对路径。

## 4. 人工 UAT 矩阵

| 场景 | 验收点 |
|---|---|
| 新 Chat | 创建会话、首问、tool调用、后续问答正常 |
| 历史 Session | 0.80.7生成的JSONL可打开续聊；模型存在时恢复，不存在时安全fallback；文件不重写迁移 |
| 模型切换 | 当前session切换成功并写既有model_change；`settings.json`全局默认不被Chat切换改写 |
| OAuth普通登录 | OpenAI/Grok/Kiro/Antigravity现有SSE流程成功，auth.json与managed Active同步 |
| OAuth添加账号 | add模式不覆盖当前Active；新账号可后续Activate |
| Active live reload | 已打开session在Activate后下一次请求使用新账号；in-flight请求不强制切换 |
| Logout | credential清除、provider状态更新、live资源重连，不删除saved-account池 |
| API-key | single与managed路径行为区分保持；reveal仍one-at-a-time/no-store |
| quota/failover | GPT/Grok/Kiro/Antigravity quota可查；enabled failover最多一次switch+retry且安全事件不含账号id |
| Models/价格/assist | 模型列表、config test、价格读取/写后验证、Terminal/Trellis/price assistant均可鉴权调用 |
| Studio SDK child | child session创建、策略模型选择、独立request affinity、prompt完成和audit JSONL更新 |

## 5. 质量与安全重点

- [ ] CredentialStore锁是**auth文件级**而非provider级。
- [ ] 所有写入在锁内reread，不以缓存快照覆盖并发结果。
- [ ] 管理runtime缓存不接收cwd-local extension；session runtime不跨cwd复用。
- [ ] `reloadRpcAuthState` 所有调用方均 await；失败按wrapper隔离。
- [ ] ModelRuntime请求使用 `getAuth(model)` 或 runtime stream/complete，未漏掉model headers/baseUrl/env。
- [ ] fixed provider加载失败隔离，Antigravity callback仍强制127.0.0.1。
- [ ] jiti仍以 `process.cwd()/package.json` anchor；三方TS包仍在 `serverExternalPackages`。
- [ ] 没有secret进入metadata、API、DOM、SSE、日志或测试快照。

## 6. 回归风险与通过标准

**阻断发布/进入 checking 的失败**：lint/tsc失败、任一核心包非0.80.10、auth并发丢写、main/Studio runtime缺fixed provider、Active CAS/race失败、live reload未完成、secret泄漏、历史session不可读。

**可记录但需解释的差异**：0.80.10上游Kimi/xAI/Grok模型目录变化；与本任务无关的既存lint告警必须给出基线证据，不能静默忽略。

只有自动检查、API smoke与UAT高风险项全部通过，checker才可建议进入用户验收。