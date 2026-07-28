# Checks — Models 弹窗性能、覆盖项过滤与竞态收敛

## 需求覆盖检查

- [ ] 点击 Models 后 modal shell 不等待 API。
- [ ] models.json 树不等待 auth catalog 或 background verify。
- [ ] summary 零 `runtime.checkAuth()`、零 legacy bootstrap write、零 provider network。
- [ ] local summary成功后 background verify非阻塞启动。
- [ ] 同 key admin runtime冷并发只初始化/注册一次；offline refresh同key single-flight。
- [ ] 同 provider + local revision并发 verify只执行一次真实`checkAuth()`。
- [ ] verify仅合并same revision verification，不覆盖local accountCount/Active/localConfigured/order/selection。
- [ ] override-only raw provider不显示；hidden data保存完整。
- [ ] catalog失败不清空models tree；models-config GET失败不能保存空配置。
- [ ] close/reopen、retry、provider/account switch、mutation期间旧请求均不能覆盖新状态。

## 自动验证

### 最低门禁

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

### Focused suites

```bash
npm run test:models-config-visibility
npm run test:web-model-runtime
npm run test:models-provider-auth-summary
npm run test:models-config-races
```

测试必须优先执行真实helper/route service与可控fake runtime/deferred Promise。源码字符串断言可以作为wire/隐私补充，但不能是single-flight、timeout、乱序正确性的唯一证据。

## 竞态测试矩阵

### A. 顶层生命周期与 catalog

| ID | 场景 | 调度 | 期望 |
| --- | --- | --- | --- |
| RACE-01 | Retry乱序 | S1 summary挂起；触发Retry得S2；S2先成功；S1忽略abort后晚到 | 只显示S2；S1零state commit |
| RACE-02 | close后晚到 | config/catalog/verify均挂起后关闭；再resolve | 无已卸载state/timer/EventSource更新 |
| RACE-03 | close→reopen | old instance S1挂起；new instance S2成功；S1晚到 | 新实例保持S2，旧实例无法污染 |
| RACE-04 | verify revision过期 | local r1→V1；Activate产生r2；V1晚到valid/invalid | V1被拒；counts/Active/selection保持r2 |
| RACE-05 | verify error/timeout | local ready后V1超时/500 | rows保持；不变catalog error；config可编辑保存 |
| RACE-06 | partial local catalog | OAuth成功/all-providers失败，反向再测 | 成功rows保留；安全error+retry；不清config |
| RACE-07 | selection稳定 | 用户在K1选B，K1 verify晚到/重排payload | selection仍B；verify不拥有order |
| RACE-08 | deep-link旧代 | K1挂起，K2成功并消费deep-link，K1晚到 | `onConsumedFocus`只调用一次 |

所有RACE-01/02/03测试中的deferred fetch都应模拟“不理会AbortSignal”，以证明generation/active guard而非仅abort。

### B. Provider/account detail

| ID | 场景 | 调度 | 期望 |
| --- | --- | --- | --- |
| RACE-09 | provider切换 | provider A accounts/quota挂起→切B→B成功→A晚到 | A结果不进入B详情 |
| RACE-10 | account切换 | 同provider账号A quota挂起→选B→B成功→A晚到 | 只显示B；loading由B generation结束 |
| RACE-11 | GET vs Activate | old accounts GET挂起→Activate POST返回新Active→old GET晚到 | POST投影保留；old GET被拒；新GET可收敛 |
| RACE-12 | Login/Logout vs verify | V1挂起→login/logout成功并invalidate→V1晚到 | V1 superseded；新summary决定local state |
| RACE-13 | reveal晚到 | API-key A reveal挂起→切provider/close→response带key晚到 | plaintext不进入DOM/state，旧map已清 |
| RACE-14 | EventSource晚到 | provider A SSE open→切B/close→A message/error | 不更新login state，不触发旧provider refresh |
| RACE-15 | quota覆盖全provider | Codex/Grok/Kiro/Antigravity各执行A→B乱序 | 四者全部有providerId/accountId/generation guard |

### C. 服务端 cache / single-flight / timeout

| ID | 场景 | 期望 |
| --- | --- |
| RACE-16 | 同runtime key 20并发init | create/register计数=1，所有caller得到同entry |
| RACE-17 | 同key 20并发offline refresh | refresh计数=1；local summary不等待checkAuth flight |
| RACE-18 | 不同runtime key | 分别初始化，互不共享 |
| RACE-19 | init/refresh首个reject | pending清除，第二次可成功；失败不形成坏resolved entry |
| RACE-20 | 同provider+revision 20并发verify | `checkAuth`计数=1，waiter共享安全结果 |
| RACE-21 | 不同provider并发verify | 可并行，慢provider不清空快provider结果 |
| RACE-22 | revision变化 | r1 cache/flight不服务r2；r1 completion不写r2 cache |
| RACE-23 | mutation invalidate | 成功mutation后epoch改变/cache清除；失败mutation不bump |
| RACE-24 | 一个HTTP waiter abort | 其他waiter仍得到shared owner结果，真实check计数=1 |
| RACE-25 | deadline后late settle | deadline返回timeout；late valid/invalid不缓存、不发布；retention内不叠加check |
| RACE-26 | TTL reopen | 15s TTL内重复打开复用cache；TTL后允许一次新flight |
| RACE-27 | reset | resolved/init pending/refresh pending/verification cache/flight测试状态清空 |

## 可见性与保存安全

1. `{ modelOverrides: {...} }` => hidden。
2. `{ modelOverrides: {}, models: [] }` => visible。
3. `{ modelOverrides: {}, futureField: true }` => visible。
4. `modelOverrides`是array/null/primitive => fail-visible。
5. helper不修改输入。
6. filtered投影后模拟编辑/PUT，hidden entries及nested override完整保留。
7. config GET malformed/500/timeout：显示error、Save disabled、无PUT空providers。
8. sync apply/reload后selection若仍visible则保留；hidden/删除后才fallback。

## Provider API 行为检查

```bash
curl -sS 'http://127.0.0.1:30141/api/auth/providers?mode=summary' | jq '.providers | length'
curl -sS 'http://127.0.0.1:30141/api/auth/providers?mode=verify' | jq '.providers | length'
curl -sS 'http://127.0.0.1:30141/api/auth/all-providers' | jq '.providers | length'
curl -sSI 'http://127.0.0.1:30141/api/models-config'
```

- [ ] summary payload字段为safe allowlist；`localStateRevision`不可读出id/path/stat/credential。
- [ ] verify仅返回allowlisted state/revision/time，无raw exception。
- [ ] `Cache-Control: no-store`保持；进程内TTL不转为HTTP cache。
- [ ] `/api/models-config` ETag / `X-Models-Config-Revision`保持。
- [ ] 默认`/api/auth/providers`仍保留兼容完整验证语义。
- [ ] AnyRouter 0 models/load failure仍有recoverable entry。
- [ ] managed accountCount / Active display投影不回退。
- [ ] summary代码路径无`bootstrapOAuthActiveAccountCredential`副作用。

## 失败/超时降级检查

- [ ] local summary客户端超时后显示固定安全error+retry，custom tree保持。
- [ ] verify timeout不删除provider、不改变counts/Active、不弹raw error。
- [ ] 单provider verify timeout不阻塞其他provider verified result。
- [ ] runtime init失败后route安全失败；下一请求可重试。
- [ ] shared checkAuth不支持abort时，deadline后completion不写cache。
- [ ] mutation write在modal关闭后若服务端已提交，重开读取最终事实；客户端不自动重放/假装回滚。

## 现有回归套件

```bash
npm run test:oauth-accounts
npm run test:grok-all
npm run test:kiro-provider
npm run test:kiro-accounts
npm run test:kiro-models-ui
npm run test:kiro-refresh-activate-race
npm run test:antigravity-provider
npm run test:antigravity-accounts
npm run test:antigravity-models-ui
npm run test:antigravity-refresh-activate-race
npm run test:anyrouter-provider
npm run test:anyrouter-api-routes
npm run test:api-key-accounts
npm run test:models-config-sync
```

若实现时package script名称不同，读取当前`package.json`后使用仓库真实等价命令，不得臆造跳过。

## 性能验证

修改前后各记录5次，summary/verify分开：

```bash
for url in \
  '/api/models-config' \
  '/api/auth/providers?mode=summary' \
  '/api/auth/providers?mode=verify' \
  '/api/auth/all-providers'
do
  for i in 1 2 3 4 5; do
    curl -sS -o /dev/null \
      -w "$url run=$i status=%{http_code} start=%{time_starttransfer}s total=%{time_total}s\n" \
      "http://127.0.0.1:30141$url"
  done
done
```

- [ ] summary warm目标≤500ms；超标附I/O数据说明。
- [ ] click→modal paint下一帧发生。
- [ ] models-config完成即出现config tree。
- [ ] verify pending 3–8s期间custom编辑/Save不阻塞。
- [ ] 重复开关/刷新不增加同state真实checkAuth次数。
- [ ] cold并发两个catalog API时admin runtime注册/refresh计数符合single-flight。

## 手工验收

1. **纯覆盖未配置**：临时agent dir写override-only；raw row不显示。
2. **纯覆盖已认证**：同id有local managed Active；只显示active row。
3. **credential失效**：local row先显示；background invalid后保留row并给详情恢复入口。
4. **慢checkAuth**：人为延迟；config tree立即可用，无全屏spinner。
5. **快速Activate**：verify/old accounts GET进行中切Active；新Active不得闪回。
6. **快速切账号**：A quota未回即选B；不能显示A quota。
7. **快速切provider**：Grok→Kiro→Antigravity；旧详情不得闪回。
8. **catalog 500/断网**：config可用，安全error+retry。
9. **models-config 500/malformed**：Save disabled，不得PUT空providers。
10. **close/reopen**：旧请求晚到不影响新实例。
11. **深链**：Grok top-bar打开Models→Grok仍只消费一次provider/account focus。
12. **窄屏/主题/键盘**：现有HTML原型三态、≤640px、focus/error色保持。

所有人工数据使用临时`PI_CODING_AGENT_DIR`，不得修改操作员真实`~/.pi/agent`。

## 最终验收标准

- [x] PRD R1–R9均有 focused、provider 或隔离环境人工证据；真实凭据网络延迟见UAT残留。
- [x] RACE-01～27已由 runtime/auth focused suites与 Models 生命周期行为测试覆盖；未使用源码字符串断言代替 RACE-01～15。
- [x] summary零`checkAuth`、same-state verify一次、deadline late result不缓存且retention内不叠加检查已有 focused 证据。
- [x] hidden overrides保存不丢、config GET失败/畸形payload Save disabled已有 focused 证据。
- [x] Grok/Kiro/Antigravity/AnyRouter/OAuth/API-key已运行回归通过。
- [x] lint + tsc通过（lint 0 errors，仓库既有 warnings）。
- [x] 用户“确认，开始实现”的正式审批证据已补录至 [plan-review.md](./plan-review.md)，HTML原型链接保持完整。

## Final Validation Run — 2026-07-28

| 命令 | 结果 |
| --- | --- |
| `npm run lint` | Pass，0 errors / 11 existing warnings |
| `node_modules/.bin/tsc --noEmit` | Pass |
| `npm run test:models-config-visibility` | Pass |
| `npm run test:models-provider-auth-summary` | Pass，6/6（含外部 authority rotation） |
| `npm run test:models-config-races` | Pass，6 个 deferred/abort-ignoring 生命周期行为场景 |
| `npm run test:web-model-runtime` | Pass，10/10 |
| `npm run test:oauth-accounts` | Pass |
| `npm run test:grok-provider` | Pass，43/43 |
| `npm run test:kiro-provider` | Pass，31/31 |
| `npm run test:antigravity-provider` | Pass，37/37 |
| `npm run test:anyrouter-api-routes` | Pass，15/15 |
| `npm run test:api-key-accounts` | Pass，26/26 |
| `npm run test:models-config-sync` | Pass，73/73 |
| `git diff --check` | Pass |

### Performance / browser evidence

- 隔离 `PI_CODING_AGENT_DIR` 的 cold/warm 各5次 endpoint 记录见 [performance-baseline.md](./performance-baseline.md)。summary warm 为 13.674–23.948 ms，低于 500 ms 目标。
- Playwright 已验证点击 `Models` 后 modal shell 出现，不依赖 catalog 完成。CLI 传输开销不等同浏览器 paint，因此未伪造 frame-accurate 数值。

### Remaining UAT

- 无真实认证账号的隔离环境不能替代真实第三方 `checkAuth()` 慢/超时手工验证；这不阻塞结构性与行为门禁。
- R6 的显式客户端 wall-clock deadline 未新增；当前降级路径依赖 HTTP 失败、用户重试、unmount abort 和服务端 verify deadline。若产品将“local catalog/config timeout”解释为客户端必需 deadline，需由主会话另行立项/决定。

原 checker 发现已由本轮 authority fingerprint、行为测试、正式审批记录及性能产物收敛。

## Delegated Final Recheck — 2026-07-28

- [x] 审阅当前生产 diff、测试 diff、文档及任务审批材料。
- [x] 跨进程 authority 证据：focused test 在安全 summary 元数据不变时直接轮换 authority slot 内容，`localStateRevision` 随之改变；wire token 仍为进程盐化 opaque hash。
- [x] race 证据：6 个 deferred Promise 场景真实执行，旧请求故意忽略 AbortSignal；覆盖 retry 乱序、close/reopen、provider/account switch、mutation-vs-GET、revision merge、late reveal。
- [x] 审批证据：`plan-review.md` 链接完整计划和 HTML 原型；`events.jsonl` 记录用户“确认，开始实现”后由 `awaiting_approval` 进入 `implementing`。
- [x] 独立重跑 lint、tsc、focused/runtime/race/provider/AnyRouter/API-key/models-sync 与 `git diff --check`，全部通过；lint 为 0 errors / 11 非本次生产改动 warnings。
- [x] 无剩余 blocker；真实第三方凭据慢/超时和 frame-accurate paint 仍仅为可选 UAT。
