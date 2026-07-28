# IMP-001 Checks

| Case | Required evidence |
| --- | --- |
| first request transport failure, `requestStarted=false` | runner records implementer reason/provenance, schedules exactly one bounded retry; no checker reason |
| retry sequence | 20s then 60s bounded backoff; third failure blocks; no spin on scheduler restart |
| unknown/request-started transport failure | operator block, zero automatic reimplementation |
| child writes diff before ambiguous failure | block; retry cannot overwrite/replay work |
| reservation persistence failure | zero child launch |
| crash after reservation / before child terminal | resume reuses fence and does not launch duplicate child |
| duplicate scheduler delivery | one active/consumed implementer attempt only |
| successful retry | exactly one transition into checker; checker/validation run once |
| checker/validation/final-policy/publish already durable | implementer retry rejected; no duplicate implementation/publish |
| auth/quota/context/cancel/policy/ordinary implementation failure | no automatic transport retry; existing reason remains appropriate |
| safe projection | no raw provider diagnostic, prompt, output, path, token or child session file |

## Test constraints

- Exercise runner → `runGithubFullAgentMember`/child adapter with controlled public-facing failure hooks; do not substitute `checkResult`, static scans, or sanitized-message regex.
- Use fake clock/backoff; no live provider, GitHub, credentials or real publish.
- Verify persisted state across fresh runner invocation and malformed/legacy state fails closed.
