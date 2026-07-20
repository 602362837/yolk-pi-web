# Checks：Grok CLI 重新登录

## 1. 规划/审批门禁

- [ ] `brief.md`、`prd.md`、`design.md`、`implement.md`、`checks.md` 内容一致。
- [ ] UI 设计员已产出自包含 `grok-cli-reauth-prototype.html`，不是纯 Markdown 替代。
- [ ] 用户已批准 HTML 原型及 plan-review 四项产品决策。
- [ ] 主会话已保存 implementationPlan 并合法进入 implementing。
- [ ] 实现范围仍为 Grok-only；未擅自开放 Kiro/Antigravity/Codex reauth。

## 2. 需求覆盖检查

### 已有账号与失效展示

- [ ] `loggedIn=false + accountCount>0` 的 Grok 仍出现在 Models 已有账号区域。
- [ ] 状态文案区分“无 saved account”和“已有账号但当前凭据失效”。
- [ ] 有 saved accounts 时仍请求选中 Grok quota，并解析 401 body 的安全投影。
- [ ] `reauthRequired` 在 Models quota card、standalone usage、aggregate usage 均可识别。
- [ ] stale 数据有明确旧缓存提示；新 credential 下不会使用旧账号 stale quota。

### 账号级操作

- [ ] 每个 Grok account 行有 target-aware “重新登录”。
- [ ] quota banner CTA 与账号行进入同一 controller/target。
- [ ] Active/非 Active 确认文案不同。
- [ ] 用户被明确告知系统无法可靠校验同一 xAI 远端身份。
- [ ] 点击前需确认；不会立即打开外部 OAuth。
- [ ] Browser、Device、Existing Grok Build 三种方式可用，真实 method id 为 `browser|device|existing`。
- [ ] 上游 options 不匹配时 fallback，而不是提交未知 method。

### 终态

- [ ] Active 成功：opaque id 不变、Active 不变、auth.json 更新、live reload、后续请求使用新凭据。
- [ ] 非 Active 成功：opaque id 不变、Active/auth.json 不变、不做不必要 reload。
- [ ] 备注、补充信息、createdAt、lastActivatedAt 保留，updatedAt/安全 masked diagnostic 更新。
- [ ] 成功后不增加 accountCount，不创建重复槽位。
- [ ] 成功后目标仍被选中，accounts/provider status 重载，并强刷新目标新 quota。
- [ ] 失败/取消零写入并保留 Active/原 credential/cache。
- [ ] 授权期间 target 被删除时返回冲突/not found，不重新创建。

### Top-bar 深链

- [ ] reauth link 打开 Models 并聚焦 Grok。
- [ ] 有 target 时选中对应 account。
- [ ] focus context 只消费一次，关闭后普通打开 Models 不残留。
- [ ] hover/focus usage panel 不直接启动 OAuth。

## 3. API 与存储检查

- [ ] `accountMode` 只接受空、`add`、`reauth`。
- [ ] `reauth` 仅允许 `provider=grok-cli`，accountId 必填且必须已存在。
- [ ] add 携带 target/未知 mode 被拒绝，避免歧义。
- [ ] OAuth 使用 isolated in-memory CredentialStore；成功前 durable store 不变。
- [ ] commit 前 lock-time 重读 target 和 Active。
- [ ] accountId 只作为 store key，通过 encode/校验 helper；不直接拼接不受控路径。
- [ ] credential 与 metadata atomic replace，权限为 0600，目录 0700。
- [ ] 双文件第二阶段失败有 best-effort rollback/固定错误，日志无 secret/path。
- [ ] Active mirror 使用 Web `CredentialStore.modify`，不导入 AuthStorage/private ModelRegistry。
- [ ] route/API/SSE 不返回 access、refresh、idToken、auth code、callback URL、raw upstream body、绝对路径。
- [ ] Grok login error 不原样透传第三方 response text。
- [ ] OAuth SSE cleanup 覆盖 disconnect、cancel、provider switch、unmount。

## 4. 并发与一致性检查

- [ ] Grok refresh、Activate、reauth 共用明确的 process + cross-process lock boundary。
- [ ] 锁层级无递归获取同一非重入锁。
- [ ] 场景 A：旧 refresh 先开始，reauth 后开始；最终为 reauth credential。
- [ ] 场景 B：reauth 先开始，refresh 后开始；refresh 重读新 credential。
- [ ] 场景 C：Activate 与 reauth 并发；commit-time Active 为权威。
- [ ] reauth 后 invalidates token flight。
- [ ] quota generation bump 后旧 in-flight 响应不会写内存/持久化。
- [ ] `.quota-cache.json` 对 target 的旧 entry 被删除，其他账号 entry 保留。
- [ ] quota cache 文件并发写不会误删其他账号。

## 5. UI/可访问性检查

- [ ] 与用户批准的 HTML 原型逐状态比对。
- [ ] 账号行动作在桌面层级清楚，不把危险删除和主要 reauth 混淆。
- [ ] 375px 下不横向溢出；按钮仍有可识别文案/触控尺寸。
- [ ] 长 displayName、masked id、extraInfo 和错误文案不撑破布局。
- [ ] Dialog 有 `role=dialog`/`aria-modal`、初始焦点、focus trap、Escape、焦点恢复。
- [ ] 每个 reauth action accessible name 包含账号语境。
- [ ] error/success/progress 使用 alert/status 文本，不只依赖颜色/动画。
- [ ] Device code 可读取/复制，复制反馈可访问。
- [ ] reduced-motion 下仍能理解 connecting/progress。
- [ ] light/dark 主题均复用项目 token，无固定夜色背景回归。

## 6. 自动验证

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:grok-reauth
npm run test:grok-provider
npm run test:grok-accounts
npm run test:grok-quota
npm run test:grok-global-auth
npm run test:grok-usage-panel
npm run test:grok-failover-adapter
npm run test:grok-failover-runtime
```

检查要求：

- [ ] `test:grok-reauth` 优先调用真实 store/service helper，包含临时 agent dir 和故障注入，不只做 source string assertions。
- [ ] fixture 不含真实 token、callback URL、device code 或用户路径。
- [ ] 所有命令记录 exit code；失败必须说明是代码问题还是环境限制。
- [ ] 不直接运行 `next build`；本任务非 release validation。

## 7. 人工验收矩阵

| 场景 | 前置 | 操作 | 预期 |
| --- | --- | --- | --- |
| Active 有效主动 reauth | 1 个 Active | 账号行 → reauth → Browser → 成功 | slot/Active 保留，auth mirror/reload，新 quota |
| Active 失效恢复 | quota reauthRequired | banner CTA → Device → 成功 | 明确恢复态消失，新 quota，不重复账号 |
| 非 Active 恢复 | 2 个账号 | 备用账号 reauth | 当前 Active 不变，备用 slot 更新 |
| Existing Grok Build | 本地 credential 可用 | 选择“复用 Grok Build” | 自动选择 upstream existing，原位提交 |
| 取消确认 | 任意账号 | 点击 reauth 后取消 | 不打开 OAuth、零写入 |
| OAuth 中取消 | Browser/device 进行中 | 取消 | EventSource 关闭，原账号不变 |
| OAuth 错误 | 授权拒绝/超时 | 等待终态 | 固定安全错误，可重试，零写入 |
| 误用另一 xAI 身份 | 测试账号 | 在浏览器切换身份并成功 | UI 不声称同一身份；slot 更新、masked diagnostic 更新、旧 quota 清空 |
| target 被删除 | OAuth 进行中 | 另一窗口删除 target，再完成授权 | commit 拒绝，不重建 target |
| Top-bar standalone | Grok panel 非 aggregate | 点击 reauth link | Models 聚焦 Grok/Active，不自动 OAuth |
| Top-bar aggregate | aggregate 开启 | 同上 | aggregate 关闭/Models 打开，目标正确 |
| env token only | 仅 `GROK_CLI_OAUTH_TOKEN`，无 saved account | 打开 Grok | 不显示虚假的指定账号 reauth；保留 bypass 提示 |
| 375px | 窄屏 | 完整确认/方法/失败/成功 | 无横向溢出，键盘/触控可用 |

## 8. 回归风险

- [ ] Grok add-account 仍分配新 opaque id。
- [ ] 普通 provider-wide login 行为不变。
- [ ] Grok Activate、delete-active protection、remarks、extraInfo、quota refresh 正常。
- [ ] Grok auto-failover detector/runtime tests 正常，reauth 不触发自动切号。
- [ ] Kiro/Antigravity account list、login method、quota guard 无行为变化。
- [ ] Codex raw/CPA/SUB2API import 与 warmup 无变化。
- [ ] Top-bar standalone/compact/aggregate provider 顺序和 polling ownership 不变。
- [ ] `@earendil-works/pi-*`、`pi-grok-cli`、jiti pins 不变。
- [ ] 不出现 root `AuthStorage`、`ModelRegistry.create()` 或 private provider deep import。

## 9. Checker 阻塞条件

出现任一项必须阻塞：

1. 没有已批准 HTML 原型。
2. reauth 仍创建新 slot。
3. 非 Active reauth 改变 Active/auth.json。
4. 旧 refresh/quota 能覆盖或污染新 credential。
5. UI/文档声称可验证同一 xAI 身份。
6. 错误/SSE/日志泄漏 credential、callback 或 raw upstream body。
7. route 对非 Grok provider 开放 reauth。
8. 自动测试只有脆弱源码字符串断言，没有 service/race 行为覆盖。
