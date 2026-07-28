

---

# Handoff — implementer（WDP-10，partial closure）

## 本轮已完成

- `lib/worktree-check-execution.ts`：引入单一可注入 `WorktreeCheckScheduler`、constructor-wide `runDeadline`，并将 semaphore wait、lease acquire/transition polling、heartbeat timer 和 command watchdog 接入该 scheduler / deadline；不再在这些路径重新计算完整 run budget。
- `lib/worktree-check-policy.ts`：加强 CLI safe-result 的终态 cross-field 校验：通过、取消、非通过的 stage / reason / retryability / timeout / command-started 组合必须一致。
- `lib/ypi-studio-extension.ts`：CLI IPC frame 现在要求 pipe EOF、exact outer-frame keys（`protocol/policy/fence/result`）及既有 bounded result schema；unknown outer fields fail closed。
- `lib/github-automation-runner.ts`：checker stage 对 generation attempt count 与 reservation hash ledger 不一致、重复 hash fail closed；reservation ledger 保留本 generation 最多两条记录而非只保留最后一条，避免正常第二次纠正被错误丢失。
- `scripts/test-worktree-check-execution.mjs`：补充 safe-result cross-field negative assertions，并开始使用 `CR01` / `CR17` / `CR23` stable case labels。

## 验证

- `npm run test:worktree-check` — pass
- `npm run test:package-assets` — pass
- `npm run test:studio-sdk-runner` — pass
- `npm run test:studio-dag` — pass
- `npm run test:github-unattended-runner` — pass (20)
- `npm run test:github-unattended` — pass (21)
- `npm run test:github-handler-runtime` — pass (9)
- `npm run test:github-publish-policy` — pass (28)
- `npm run lint` — pass, 0 errors / 11 pre-existing warnings
- `node_modules/.bin/tsc --noEmit` — pass
- `git diff --check` — pass

## 本次追加修复（仍未关闭，必须保持 WDP-10 implementing）

- `lib/worktree-check-extension.ts`：修复 restricted file tools 与 Pi file-definition 的实际调用边界。Pi 会在调用 operations 前将相对输入解析为绝对路径；现在在 adapter 内将该内部绝对路径重新验证并转成 WorkTree-relative 输入，之后再进入 containment resolver。此前真实 `read` tool 会把自身的绝对路径误判为 escape，导致 discovery evidence 无法走真实工具路径。
- `scripts/test-worktree-check-execution.mjs`：所有原先直接调用 `noteRepositoryEvidenceRead()` 的 fixture 改为实际调用 restricted `read` tool 后再 probe/prepare/check，避免 helper-forced discovery evidence。
- `lib/worktree-check-execution.ts`：lease transition 不再为每次 transition 建立独立 10 秒 deadline；它只消费 constructor-wide run deadline。terminal release 在 controller cancellation 后仍会等待已经在途的 heartbeat transition，并使用 scheduler sleep，避免 guard busy 时本地 token 被清空而磁盘 matching owner 遗留。

追加验证：

- `npm run test:worktree-check` — pass
- `node_modules/.bin/tsc --noEmit` — pass
- `npm run lint` — pass（0 errors / 11 existing warnings）

## 仍未关闭（必须保持 WDP-10 implementing）

- CR1–CR25 尚未形成要求的完整真实 direct / SDK / CLI / auto / GitHub / installed-package 稳定案例矩阵；本轮仅补了少量标签和 parser unit assertions。
- scheduler 虽已接入生产 controller，但尚未交付 fake-clock/barrier/observable-spawn 的 CR15–CR19 确定性回归，lease transition busy/replacement-token terminal race 也未完成。
- CLI/auto 的真实 child-parent IPC malformed-frame、fd/control-env 伪造矩阵仍未实现；目前只强化了父侧校验。
- package smoke 尚未升级为临时 consumer installed-root、无关 cwd 的真实 extension/transitive load + handshake；GitHub reservation throw/reject、spawn后报告前 crash/resume 的真实 fault-injection 覆盖仍缺失。

未 commit、push 或 merge；未新增 UI、生态 adapter 或 sandbox 声明。

## 本次执行更新（WDP-10，仍 implementing）

- `scripts/test-worktree-check-execution.mjs`：新增并实际执行 CR04–CR14 的稳定命名场景，均经真实 controller、restricted contained `read`/`write` 或 argv executor；覆盖 launcher delegation、path/Git-root escape、symlink ancestor、discover→probe gate 与报告一致性。CR17 改为仅触发 constructor `AbortSignal`，fixture 记录真实孙进程 PID，验证 controller 终止整个 detached process group。
- `scripts/test-package-assets.mjs`：升级为实际 `npm pack` → temporary consumer `node_modules/@alan-zhao/yolk-pi-web` → unrelated cwd runtime probe。probe 使用 consumer dependency tree 中的 jiti 加载 packed policy/extension/CLI extension，校验 handshake 并断言 resolved product modules 位于 installed root，避免 source-tree fallback。

本次验证：

- `npm run test:worktree-check` — pass（新增 CR04–CR14、CR17 输出）
- `npm run test:package-assets` — pass（`CR24-installed-tarball-runtime-load-handshake`）
- `node_modules/.bin/tsc --noEmit` — pass
- `npm run lint` — pass，0 errors / 11 existing warnings
- `git diff --check` — pass

仍未关闭：CR01–CR25 的完整矩阵尚缺 CR02/03、CR15/16、CR18–CR23、CR25 的真实 SDK/CLI/auto/GitHub fault/IPC attack 路径；fake scheduler/barrier/lease replacement race，以及 GitHub reservation fault/resume 仍未实现。本次 package smoke 已完成 installed-root runtime load/handshake，但尚未覆盖删除 transitive、policy/frame corruption 和 auto fail-closed 矩阵。

## 本次定向修复（CR17 fixture）

- `scripts/test-worktree-check-execution.mjs`：将 CR17 fixture 从 abort 前的 `setTimeout` 轮询改为一次性 `SIGUSR1` readiness handshake。wrapper 仅在创建并记录真实孙进程 PID 后通知测试进程；测试在收到该通知后才触发 controller AbortSignal。wrapper 的 `wait` 与 command close 已证明孙进程被回收，因此移除了 abort 后的固定 sleep。
- 未改生产行为、未扩大 CR 矩阵、未 commit/push/merge。

本次验证：

- `npm run test:worktree-check` — pass（CR17 readiness handshake）
- `npm run lint` — pass，0 errors / 11 pre-existing warnings
- `node_modules/.bin/tsc --noEmit` — pass
- `git diff --check` — pass

剩余风险：该 POSIX fixture 使用 `sh`、`sleep` 和 `SIGUSR1`，与既有 POSIX process-group fixture 假设一致；WDP-10 其余 CR 矩阵和 fault-injection 缺口不在本次定向范围内。
