# IMP-001 Brief — GitHub unattended implementer 首请求 transport failure

## 反馈摘要

attempt 906 的 **GitHub automation / YPI Studio child implementer** 在 child Pi 首次 provider 请求前/时出现 `provider_transport_failure`；runner 随后把该运行期失败写成 `check_runtime_unavailable` 并阻断。上一版误把它规划为普通 Chat retry，现已废弃。

## 已核对代码证据

- `lib/github-automation-session.ts#runGithubFullAgentMember()` 启动 GitHub unattended implementer 的 SDK child；当前返回值只有 `status/output/warnings`，没有受限、可审计的 child request/run 失败分类或 attempt provenance。
- `lib/github-automation-runner.ts` implementer catch 依赖 `details.retryable` 和 `runtime_lost|ECONNRESET|timed out` 文本；固定 20 秒重试且没有 durable retry ordinal/backoff/provenance。正常 failed status 直接 `implementer_failed` 阻断。
- 同一 runner 的 checker 分支专门使用 `check_runtime_unavailable` 作为 WorkTree Check reservation/policy 失败 reason。它不应承载 implementer provider transport failure。
- 当前 `GithubAutomationRunnerStateV1` 只记录 `lastMember/lastRunId`；不足以证明某个 implementer child 是否在首次 provider 请求前失败、是否已修改 WorkTree、或该 retry 是否已被消费。

## 范围

只处理 GitHub unattended pipeline 的 implementer child：错误映射、有限 retry/backoff、attempt/session/run provenance、以及在 retry/resume 下防止重复实现或重复发布。

不处理普通 Chat、Chat UI、provider SDK/AnyRouter retry 算法、checker WorkTree Check policy 或发布器业务逻辑。
