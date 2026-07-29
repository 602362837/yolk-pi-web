# Checks — handler readiness / retry / startup recovery

## 1. 需求覆盖

- [ ] Production scheduler 直接绑定唯一 analysis handler。
- [ ] 冷启动首 job 不进入 default fallback。
- [ ] Handler 未初始化时零 lease、零 `job_started`、零 attempt 增量。
- [ ] `retry_due.nextRetryAt` 无外部 wake 也能到期执行。
- [ ] 过早 tick 不会吞掉 future deadline。
- [ ] server startup 自动恢复 overdue v2 analysis job。
- [ ] paused/disabled 不执行，恢复后 bounded 继续。
- [ ] result/effect checkpoint 幂等不变。
- [ ] status/verify GET 仍为零 scheduler side effect。
- [ ] UI/API现有字段和布局不变。

## 2. 自动化测试矩阵

| ID | 场景 | 必须证明 |
| --- | --- | --- |
| HNR-COLD-01 | Webpack production bundle 首次加载 runner | 首次执行真实 handler；无 `handler_not_ready` |
| HNR-LEASE-02 | production handler 初始化失败 fixture | attempt不变，无job_started |
| HNR-TIMER-03 | 5s retry + 2s early tick | 5s到期后再次lease，无外部wake |
| HNR-TIMER-04 | 较晚schedule请求覆盖较早deadline | 最早deadline保留 |
| HNR-IDLE-05 | tick时只有future retry | timer持续存在直到due |
| HNR-START-06 | server启动前已有overdue retry_due | 启动ensure后继续 |
| HNR-START-07 | 两个process/ensure竞争同job | filesystem lease/fence只执行一次 |
| HNR-PAUSE-08 | pending job + paused→unpaused | paused零lease，恢复后bounded继续 |
| HNR-NOSPIN-09 | handler no-progress/retry budget | 无立即queued spin，backoff/blocked保持 |
| HNR-CKPT-10 | result_ready/comment remote-confirmed | 不重跑模型/不重复评论关闭 |
| HNR-READ-11 | status/verify polling | 不启动scheduler、不改job |
| HNR-PRIV-12 | events/job/API递归扫描 | 无body/prompt/path/token/stack/raw error |

## 3. Production artifact smoke 门禁

1. 使用 `npm run build`（不得直接 `next build`）。
2. 以 temp `PI_CODING_AGENT_DIR` 准备 enabled v2 config 和 retry_due v2 job。
3. 加载 `.next/server/app/api/github-automation/jobs/[jobId]/route.js` 的真实 POST route 并触发 Retry。
4. Fixture 必须在任何真实 GitHub/model网络调用前由真实 handler 确定性结束。
5. 轮询 temp job，断言：
   - `attempt` 增加一次；
   - reason 不是 `handler_not_ready`；
   - event 不含 `default_handler_defensive_fallback`；
   - 无真实网络、无用户 agentDir 写入。
6. 仅检查源码/bundle字符串不能替代该 smoke。

## 4. 现场验收（部署后）

### 4.1 #25 恢复

- 部署前确认是否需先 `paused=true`。
- 新进程启动后，不点击 Retry、不制造第二个 webhook。
- 观察 #25 从 `received/retry_due` 进入真实 analysis checkpoint。
- 首次真实 lease 后 attempt 预期从历史 1 变为 2；历史 attempt 不重写。
- 不再出现 `default_handler_defensive_fallback`。
- 若完成评论，确认只有一个 v3 marker；若保持 open/close，符合现有门禁。

### 4.2 冷进程新 Issue

在测试 App/测试仓库新建人类 Issue：

- webhook 202；
- 首 job 无 `handler_not_ready`；
- confirmed/inconclusive/not_applicable 保持 open；
- 不以 mock green 代替真实 UAT。

## 5. 验证命令

```bash
npm run test:github-automation
npm run lint
node_modules/.bin/tsc --noEmit
npm run build
npm run test:github-automation-production-runtime
git diff --check
```

`npm run build` 是本缺陷必须的 production-bundle 验证，不属于日常开发构建；禁止直接运行 `next build`。

## 6. 重点评审风险

- [ ] static handler import 没有 runtime circular initialization。
- [ ] test-only override 不可从 production request 控制。
- [ ] startup bootstrap 仅 Node runtime 执行。
- [ ] timer handle/nextWakeAt 在 fire、cancel、reschedule 后一致。
- [ ] early tick 和 job finally 不能清除唯一 future deadline。
- [ ] scheduler 在无 pending job 时停止，不持续高频扫盘。
- [ ] paused pending job 的配置重检不是业务 lease。
- [ ] multi-process fencing仍覆盖 comment/close副作用。
- [ ] temp smoke不读取真实凭据、不请求GitHub、不写用户目录。

## 7. 当前已运行验证

- `npm run test:github-automation`：通过（10 + 24 + 9 + 7 + 18）。
- 该绿测同时证明现有 suite 未覆盖 production bundle 冷加载、自动 timer 到期和 startup recovery，因此不能作为修复完成证据。
- 已只读核对 0.8.10 production bundle、运行进程、safe status projection、job与event时间线；未修改job、未点击Retry、未产生GitHub副作用。
