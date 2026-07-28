# PRD — IMP-001

## 根因（已复现）

`buildGithubFullAgentPromptEnvelope` 安全边界句含 “installation tokens”，被 `containsGithubAutomationSecretInjectionMarker` 的 `/installation[_\s-]?token/i` 假阳性命中。

`runGithubFullAgentMember` 因此 throw：`Refusing full-agent run: prompt contains secret injection markers`，sanitize 成 Internal error；child 从未启动。

## 需求

| ID | 需求 | 验收 |
| --- | --- | --- |
| R1 | 标准 full-agent envelope 不被 sentinel 误杀 | marker=false |
| R2 | 真 token/PEM/ghs_/installation_token= 仍拦截 | 正向用例 |
| R3 | implementer 失败 allowlisted code/stage | 事件 meta 可读 |
| R4 | 投影区分 Session 绑定 vs Agent active | sessionId 非空 alone ≠ Agent 执行中 |
| R5 | 30142 单次 retry 越过 preflight 或 typed block | 不 kill 30141 |
| R6 | 不把 #22 业务完成当完成条件 | 文档明确 |
