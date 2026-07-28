# IMP-001 PRD — GitHub implementer transport retry

## 目标

当 GitHub unattended implementer child 的首次 provider 请求发生已确认的 transport failure 时，保留其真实原因并在同一 job/generation/WorkTree 中进行**有界、持久化、幂等**重试；不得误写为 `check_runtime_unavailable`、重复执行实现，或越过 checker/final-diff/publisher 门禁。

## 需求

- **R1 分类边界：**新增 implementer 专属 allowlisted reason（建议 `implementer_provider_transport_failure`）；`check_runtime_unavailable` 仅保留给 checker restricted runtime/reservation 语义。未知、认证、配额、上下文、取消、policy 与代码失败不得提升为 transport retry。
- **R2 结构化错误：**child session runner/session adapter 必须从 public Pi child result/error 产出 server-owned、无原文的 `{ kind, stage, retryable }`。禁止 runner 解析 sanitize 后 message；`provider_transport_failure` 仅作为内部 allowlisted kind，绝不投影 raw diagnostic。
- **R3 有界退避：**仅 `stage=before_first_provider_request` 且 `kind=provider_transport_failure` 可自动 retry。推荐最多 2 次 retry（总 3 个 implementer run），指数退避 20s/60s ± bounded jitter；deadline/取消/暂停优先。超过预算稳定阻断为 implementer 专属 reason，operator 才能重新驱动。
- **R4 durable provenance：**runner state 记录 generation-scoped implementer attempt ordinal、run id、child session opaque id/hash、request-started boolean、failure kind、backoff/retry due；safe event 只投影 ordinal/kind/retryability，不含 prompt/output/path/token。
- **R5 幂等：**只允许 `requestStarted=false` 且 WorkTree baseline/diff guard 未显示 child implementation evidence 的 automatic retry。一次 child 请求已开始、child run 成功/不确定、检测到 WorkTree 新 diff，或任何 checking/publishing effect 已存在时，自动 retry fail closed 并转 operator；resume 必须复用 durable fence，不能重新生成同一 attempt。
- **R6 流程：**retry 回到 `implementing`，不得进入 checker/validation/publish；成功 implementer 才可一次性推进 `checking`。已有 checker report、validation、PR/effect marker 时不得重新启动 implementer。
- **R7 测试：**通过真实 GitHub runner → session adapter → controlled child failure boundary验证，不使用 `checkResult` override 或 message regex 代替。

## 非目标

不改普通 Chat/UI、不改 Pi provider 重试策略、不增加 Settings/按钮、不把所有网络异常视作 retryable、不自动 retry 已开始的实现或发布。
