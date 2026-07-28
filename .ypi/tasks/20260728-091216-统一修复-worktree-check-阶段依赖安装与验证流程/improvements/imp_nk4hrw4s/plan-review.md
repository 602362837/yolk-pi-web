# Plan Review — IMP-001 GitHub implementer transport failure

> 状态：**已纠正范围；等待主会话/用户批准；未实现生产代码。**

## 审阅入口

- [Brief](brief.md)
- [PRD](prd.md)
- [Design](design.md)
- [Implement](implement.md)
- [Checks](checks.md)
- [UI](ui.md)

## 修订结论

attempt 906 不是普通 Chat retry 问题，而是 GitHub automation runner 启动的 YPI Studio **implementer child** 首次 provider 请求失败后的错误映射与恢复问题。

当前 runner 的 implementer 路径以 `details.retryable`/错误文本判断；checker 路径单独使用 `check_runtime_unavailable`。计划要求将两者彻底隔离：implementer transport 失败使用 implementer 专属 reason 与 durable provenance，绝不借用 checker reason。

## 推荐方案

1. 先在 child session adapter 建立 public/owned structured outcome，确认是否能观测 `before_first_provider_request`。
2. 仅该严格条件下允许总计三次 implementer run（首次 + 2 retry），20s/60s bounded backoff；持久化 reservation/fence 后才启动 child。
3. request 已开始、边界未知、WorkTree 有不确定实现 diff、已进入 checking/validation/final/publish、持久化失败或预算耗尽时一律 fail closed/operator block。
4. 同一 job/generation/WorkTree/fence resume 不得重复启动 child；成功只允许一次推进 checking，既有 publisher effect 禁止回退重做 implementer。
5. 用真实 GitHub runner + child adapter fault boundary 覆盖；不以 `checkResult` override、message regex 或普通 Chat fixture 代替。

## UI 门禁

不新增 UI，**无需 HTML 原型**。只复用既有 Jobs 安全 reason/retryability 投影。

## 需要批准的决策

- **D1（建议批准）：**transport 自动重试仅适用于已确认 `before_first_provider_request` 的 implementer child；无法可靠证明时阻断而非猜测重试。
- **D2（建议批准）：**预算为首次 + 最多 2 次 retry，退避 20s、60s（bounded jitter）；预算耗尽需 operator action。
- **D3（建议批准）：**任何 request-started/未知起点/WorkTree diff/后续 gate evidence 都禁止自动重试，以防重复实现或发布。
- **D4（建议批准）：**新增 implementer 专属 reason/provenance；`check_runtime_unavailable` 保持 checker-only。
- **D5（建议批准）：**无 UI 改动。

批准后按 `implement.md` 的 IMP-01→04 串行执行；未批准前不得改生产代码。
