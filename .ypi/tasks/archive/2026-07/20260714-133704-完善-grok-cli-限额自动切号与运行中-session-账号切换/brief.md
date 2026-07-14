# Brief：Grok CLI 自动切号对齐 ChatGPT/Codex

## 最新要求

1. 用户只需要获得“目标实现且不影响其他功能”的结果，不需要选择或理解内部 runner、header、fixed-token 与共享架构。
2. Models 手动 Activate 的 Grok 账号只是全局当前 Active，不能被视为锁定账号；它后续出现明确限额/限流时仍须自动轮换并重试。
3. ChatGPT/Codex 现有行为必须保持不变。

## GPT 源码核对

现有 `activateOAuthAccount()` 只写全局 Active 和 `auth.json`，没有 manual lock/pin。`patchChatGptAccountFailover()` 在每次 run 前捕获当时 Active，不区分手动或自动来源；Pi 原生 retry/compaction结束后，若 detector命中且开关开启，会在进程锁内检查 Active、选择候选、Activate、reload所有 normal live wrappers，并让当前 turn重试。

默认每 turn 1 attempt / 1 switch；并发后进入者看到 Active已变化时直接使用当前 Active重试，不切第三账号。切换影响其他 normal live/new Session后续请求，in-flight请求不变。

## 修订方案

- Grok退役 per-session Authorization pin，统一使用全局 Active + live reload。
- Grok classifier覆盖经 fixture确认的明确 quota/usage/credits/monthly/weekly 与明确 rate-limit/too-many-requests；网络/timeout/5xx/auth/模糊文本不触发。
- Grok只保留 classifier、monthly/weekly quota candidate、token force-refresh等 provider-specific adapter差异。
- 先固化 GPT contract。只有重构前后 tests完全一致才抽共享 orchestration；否则保留 GPT生产路径，采用 Grok独立 controller/patch。
- 不新增 Chat账号 selector或Session account API；历史 `grokAccountStorageId` deprecated ignored，不迁移。

## 当前审批阻塞

现有 `grok-global-account-failover-prototype.html` 仍写“普通 rate limit 不触发”，与最新要求冲突。需 UI 设计员做最小文案/状态修订并由用户批准；任务保持 `awaiting_approval`，不实施代码。
