# Implement — IMP-001

| ID | Title | dependsOn |
| --- | --- | --- |
| IMP1-01 | Tighten sentinel + envelope; unit tests FP/TP | — |
| IMP1-02 | Typed preflight errors + projection Agent-active | — |
| IMP1-03 | Focused regressions | IMP1-01, IMP1-02 |
| IMP1-04 | Docs + lint/tsc + 30142 single-retry proof; never kill 30141 | IMP1-03 |

maxConcurrency=2。

关键文件：`lib/github-full-agent-profile.ts`、`lib/github-automation-session.ts`、`lib/github-automation-runner.ts`、`lib/github-automation-projection.ts`、tests、docs。
