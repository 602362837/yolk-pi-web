# Check Complete — WDP-10 最终门禁复核

## Findings Fixed

- None。本轮仅复核实现、测试边界并运行全部门禁，未修改生产代码。

## Remaining Findings

### 阻塞 1 — CR1–CR25 矩阵仍不完整

全仓当前只能定位以下 15 个稳定 case id：CR01、CR04–CR14、CR17、CR23、CR24；仍缺 **CR02、CR03、CR15、CR16、CR18–CR22、CR25**。

其中 CR23 仍只是 `scripts/test-worktree-check-execution.mjs` 内直接调用 result parser 的断言，不是其名称要求的真实 CLI child-parent IPC case；CR01 也未注入 observable spawn adapter 来直接证明零 spawn。故不能按标签数量将这 15 项全部视为已关闭。

Studio 两个 focused suite 的实际输出仍分别只是 `SDK runner header tests` 和 `DAG scheduler tests`，没有真实 restricted SDK/CLI/auto checker 的 CR02、CR03、CR22、CR23 路径。GitHub checker测试仍通过 `_testSetGithubFullAgentMemberOverride()` 构造 `checkResult`，不能替代 CR20/CR21 的 reservation/exec/resume 故障边界。

### 阻塞 2 — CR15、CR16、CR18、CR19 的确定性 scheduler / lease 证据缺失

生产 controller 已有 injected scheduler 和 constructor-wide run deadline；CR17 也已改为只触发 constructor `AbortSignal`，并通过真实孙进程 PID 验证进程组终止，这是有效进展。

但测试没有注入 fake scheduler，也没有 probe 3m / prepare 15m / run 30m clamp、三 WorkTree barrier、等待者取消/超时后不 late-spawn、slot fault 后复用、heartbeat busy transition、dead-stale recovery、replacement-token terminal cleanup 等稳定用例。测试中仍使用真实 `setTimeout` 轮询 CR17。因而 CR15、CR16、CR18、CR19 未关闭。

### 阻塞 3 — CLI IPC 完整攻击矩阵仍未走真实 child-parent pipe

父侧 outer-frame exact-key/EOF 校验和 shared result parser 已强化，但现有 CR23 只直接调用 `parseWorktreeCheckExecutionResult()`。没有真实 CLI/auto 子进程覆盖 fd/control-env 不可见，以及 missing/unknown、bad enum/null、negative/overflow、duplicate、trailing、truncated、oversized、bad JSON、policy/version/fence mismatch、exit 0 无合法 frame。CR23 与 CR25 仍未达到规定边界。

### 阻塞 4 — installed package 只有正向 runtime load，CR25 负向矩阵缺失

`test:package-assets` 现在确实执行 `npm pack`，构造 temporary consumer installed root，从无关 cwd 加载 packed policy/extension/CLI extension，并校验 product module path 位于 installed root；因此 CR24 的正向证据已有实质进展。

但该测试仍未删除 extension/runtime transitive、篡改 policy/version/fence、注入坏/重复/超限 frame，也未验证 CLI 与 auto 均 fail closed 且不回落 source/unrestricted runner。CR25 未关闭。

### 阻塞 5 — GitHub reservation crash dedupe 仍无真实故障注入

生产 runner已有 generation reservation ledger 与 consumed hash 恢复逻辑，但 focused tests没有通过真实 reservation callback + spawn + resume 路径证明：

- persist throw/reject/failure → `check_runtime_unavailable` 且 spawn=0；
- persist成功、spawn已观察、report前故障后 resume 同 hash 零二次 spawn；
- budget内不同 hash、证据关联纠正仍可执行；
- legacy count/ledger mismatch 通过真实 runner operator-block。

当前构造 member `checkResult` 的 override 不能关闭 CR20/CR21。

## Non-blocking Confirmations

- CR04–CR14 已使用真实 controller 与 restricted contained file/exec tools，不再通过 `noteRepositoryEvidenceRead()` 伪造 discovery evidence。
- CR17 已走 constructor-only abort 与真实 descendant PID。
- CR24 已升级为 actual tarball + installed consumer root + unrelated cwd 的正向加载/handshake。
- 未发现 production 生态/package-manager install adapter；未新增 UI；文档仍明确 restricted guard 不是 OS sandbox。

## Verification

- `npm run test:worktree-check` — pass；输出 CR04–CR14、CR17，CR01/CR23仅源码标签/局部断言
- `npm run test:package-assets` — pass；输出 CR24 正向 installed-runtime handshake
- `npm run test:studio-sdk-runner` — pass；仅 SDK runner header tests
- `npm run test:studio-dag` — pass；仅 DAG scheduler tests
- `npm run test:github-unattended-runner` — pass（20）
- `npm run test:github-unattended` — pass（21）；checker仍使用 constructed override
- `npm run test:github-handler-runtime` — pass（9）
- `npm run test:github-publish-policy` — pass（28）
- `npm run lint` — pass（0 errors / 11 existing warnings）
- `node_modules/.bin/tsc --noEmit` — pass
- `git diff --check` — pass

## Verdict

**Needs work / changes_requested**。

WDP-10 仍未满足 `checks.md` 1D–1F 的封口定义。应退回 implementing，在既定 WDP-10 范围内补齐缺失稳定 case、fake scheduler/lease 竞态、真实 CLI IPC 攻击、CR25 installed-package fail-closed，以及 GitHub reservation crash/resume 故障证据；不要新增 WDP-11，也不要进入发布、PR或合并。
