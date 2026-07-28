# Checks — 通用 WorkTree Check 协议与执行边界

## 1. 需求覆盖矩阵

| 需求 | 自动检查 | 人工/代码审查 |
| --- | --- | --- |
| R1 通用协议 | P1–P8 policy/report fixtures | 搜索production无生态/manager/lockfile/install argv表 |
| R2 权威隔离 | T1–T8 injection fixtures | system policy与hard tools来自server，不来自task/repo |
| R3 先发现 | D1–D10 phase/evidence fixtures | 无repo证据不猜默认install |
| R4 受限exec | E1–E23 command/path/tool matrix | SDK/CLI等价，builtin bash/project extensions关闭 |
| R5 权限边界 | M1–M12 mutation/capability matrix | project-local允许，system/global/privilege拒绝 |
| R6 anti-spin | B1–B17 budget/attempt/lease matrix | started command失败不自动重复scripts |
| R7 evidence优先 | R1–R12 report reconciliation | assistant自报Pass不能写通过证据 |
| R8 明确状态 | N1–N10 no-progress/status | specific `check_*`不被runner_no_progress覆盖 |
| R9 安全/隐私 | S1–S17 abort/process/env/projection | 明确非OS sandbox |
| R10 GitHub | G1–G15 durable checker/validation | same generation、resume fencing、completion evidence |
| R11 Studio | Y1–Y15 SDK/CLI/auto | fallback不可降级unrestricted runner |
| R12 非回归 | focused suites + lint/tsc | approval/DAG/session/publisher不变 |

### 1A. Changes-requested closure（WDP-07…WDP-10）

以下 CR1–CR25 继续作为重新送全局 checker 前的强制证据。WDP-07…09 是已执行但未通过最终门禁的历史修复；WDP-10 是唯一封口项，必须通过真实 runner/tool/package 路径关闭全部项目。任一缺失都不能以 focused suites 已绿、静态源码匹配、构造runner结果、内部 helper 直写状态或新增后继抽象替代。

| ID | 对应blocker | 自动场景 | 通过标准 |
| --- | --- | --- | --- |
| CR1 | 主WorkTree prepare | direct controller在main repo执行prepare | deterministic拒绝，零spawn；linked WorkTree不误拒绝 |
| CR2 | 主WorkTree prepare | Studio SDK checker在main repo尝试prepare | `check_command_rejected`，仍可discover/check |
| CR3 | 主WorkTree prepare | CLI与auto fallback在main repo尝试prepare | 与SDK一致拒绝，不因fallback放开 |
| CR4 | launcher escape | `env sh -c ...`及等价env delegation | launcher在spawn前拒绝 |
| CR5 | launcher escape | `xargs sh ...`/stdin delegation | 在spawn前拒绝 |
| CR6 | launcher escape | `find ... -exec/-execdir ...` | 在spawn前拒绝；使用scoped find不受影响 |
| CR7 | argv path escape | `/tmp/x`、`--output=/outside`、`../outside`等path args | 外部/逃逸path在spawn前拒绝，不回显敏感值 |
| CR8 | Git root escape | `git -C /outside`、`--git-dir`、`--work-tree` | 即使subcommand只读也拒绝；普通contained status/diff可用 |
| CR9 | symlink ancestor | `inside-symlink/new-file`且ancestor指向外部 | 创建前拒绝，外部文件不存在 |
| CR10 | discover evidence | contained file content读取成功 + probe exit 0 | 才可prepare/check |
| CR11 | discover evidence | failed read、path escape read、`exists=false` | 均不记录successful repository evidence |
| CR12 | discover evidence | 成功read但零probe | prepare与check都拒绝 |
| CR13 | discover evidence | probe rejected/non-zero/timeout | 不解锁prepare/check |
| CR14 | phase ledger | 成功read/probe后合法prepare/check | phase按ledger推进且report引用一致 |
| CR15 | cumulative budget | 多次probe耗尽3m后再probe | timeout按remaining clamp，累计不超过3m |
| CR16 | cumulative budget | prepare累计15m或run累计30m逼近deadline | 下一命令取最小remaining；运行中到deadline即kill |
| CR17 | parent abort | 仅触发controller AbortSignal、单次tool signal未触发 | active process group/descendants终止，后续command禁用 |
| CR18 | concurrency | 3个不同WorkTree以barrier并发 | 同时active最多2；等待者取消/超时有specific reason |
| CR19 | lease heartbeat | 长命令、live owner、dead stale owner与token replacement | heartbeat更新；不偷live；可recover dead；旧release不删新owner |
| CR20 | durable reservation | GitHub prepare reservation持久化失败 | command零spawn，保持command-not-started failure语义 |
| CR21 | crash anti-spin | reservation成功、spawn开始、report前故障并resume | generation attempt已消耗，不自动重跑同一scripts |
| CR22 | env parity | SDK/CLI命令打印env key集合 | required execution env一致；secret及所有Check control/result key不存在 |
| CR23 | result authority | repo command猜测result路径/fd并伪造Pass | 无路径channel；fd不继承；父侧只接受单个bounded schema+handshake IPC消息 |
| CR24 | package asset | pack tarball解到temp installed root并加载CLI extension | extension及全部runtime transitives可解析，路径不依赖checker cwd |
| CR25 | package fail closed | 删除asset/改policy handshake/重复或超限IPC消息 | `check_runner_policy_unavailable`或report inconsistent；不fallback unrestricted |

### 1B. 历史要求（由 WDP-10 最终兑现）

| Review blocker | 必须新增的自动证据 | 禁止的替代证据 |
| --- | --- | --- |
| Lease heartbeat / recovery（CR19） | 注入 fake clock/scheduler，长命令期间多次推进 `heartbeatAt`；transition guard 内二次匹配 expected token；live owner 不被偷、dead stale 可恢复、replacement owner 不被旧 heartbeat/release/recovery 删除；terminal 后 timer/owner 清理 | 只创建一次 `owner.json`；只测 live PID + `timeout=0`；无 token replacement race |
| Semaphore / budgets / abort（CR15–CR18） | 三 WorkTree barrier 证明 active≤2；等待者 controller abort/deadline 后从队列移除且永不晚到启动；lease/owner write抛错后slot可复用；fake clock验证probe/prepare/run remaining clamp；controller signal终止process group与孙进程 | sleep-based时序猜测；只传单次tool signal；只检查下一命令才发现deadline |
| Env allowlist（CR22） | 真实 SDK、CLI、GitHub repository command输出env key集合；三者只含同一显式最小执行键；`NPM_TOKEN`、`NODE_AUTH_TOKEN`、OpenAI/AWS/Azure/Google/GitHub/SSH/proxy及Pi/YPI/Check control/result变量均不存在 | denylist；仅测`GITHUB_TOKEN`；仅直接调用builder而不走runner command |
| CLI IPC authority（CR23/CR25） | parent-owned pipe/fd恰好一条bounded frame；protocol、policy version、invocation nonce/fence与完整safe-result schema匹配；repo child不继承fd/control env；缺失、重复、trailing、超限、截断、坏JSON/schema/version/nonce、伪造均fail closed | 无上限`readFileSync`；只检查少数字段；依赖child exit 0；使用repo可定位result path |
| Installed package（CR24/CR25） | 实际`npm pack`生成tarball并无网络解包到temp installed root；从无关cwd解析/加载extension及runtime transitives并完成policy/IPC handshake；删除asset/transitive、改version时CLI/auto fail closed | 仅`npm pack --dry-run --json`清单；从源码root或`process.cwd()`加载 |
| Runner/failure paths（CR1–CR14、CR20–CR23） | direct/SDK/CLI/auto main WorkTree；实际contained file tools与probe；实际launcher/path/Git/symlink guard；reservation callback throw/reject零spawn；reservation后spawn、report前fault再resume；durable generation/run fence/attempt/hash阻止重复scripts | `noteRepositoryEvidenceRead()`等内部helper；只测direct controller；只保存attempt count；静态代码检查代替fault injection |

### 1C. WDP-10 测试映射与报告要求

1. `scripts/test-worktree-check-execution.mjs` 输出或源码用例名必须可逐项映射 CR1、CR4–CR19；所有discover evidence必须由真实contained file tool产生，fake clock/barrier/fake spawn不得访问真实网络、registry或用户agentDir。
2. Studio focused suites必须分别覆盖 CR2、CR3、CR22、CR23：启动真实SDK、CLI与auto restricted checker；main WorkTree prepare均零spawn，env输出与IPC攻击必须穿过child/parent边界。
3. GitHub focused suites必须覆盖 CR20、CR21、CR22：reservation持久化throw/reject稳定为command-not-started `check_runtime_unavailable`且零spawn；reservation成功后注入spawn已观察、report前故障，resume必须在spawn前拒绝同一command hash。
4. `scripts/test-package-assets.mjs` 必须覆盖 CR24、CR25：实际tarball、temp consumer installed-package形态、无关cwd真实load+policy/IPC handshake，以及缺asset/transitive、mismatch和bad IPC负例；dry-run或只读源码仅可作为附加检查。
5. checker handoff必须附CR1–CR25 → 稳定test case id → runner/tool boundary → pass/failure evidence映射；任何标记manual、静态检查、构造`checkResult`或“由旧绿测间接覆盖”的CR均视为未关闭。

### 1D. WDP-10 稳定测试用例映射

下列case id为最低契约；实现可拆分更多用例，但不得合并到无法证明对应边界的泛化smoke。

| CR | 稳定case id | 主测试文件 / 必经边界 |
| --- | --- | --- |
| CR1 | `CR01-direct-main-prepare-zero-spawn` | `test-worktree-check-execution`；direct controller/main WorkTree/observable spawn |
| CR2 | `CR02-studio-sdk-main-prepare-zero-spawn` | `test-ypi-studio-sdk-runner`；真实restricted SDK child |
| CR3 | `CR03-studio-cli-auto-main-prepare-zero-spawn` | Studio DAG/runner suite；真实CLI与auto fallback |
| CR4 | `CR04-exec-env-delegation-rejected` | `test-worktree-check-execution`；真实exec tool/capability gate |
| CR5 | `CR05-exec-xargs-delegation-rejected` | 同上；stdin/delegation在spawn前拒绝 |
| CR6 | `CR06-exec-find-exec-rejected` | 同上；`-exec/-execdir`实际argv |
| CR7 | `CR07-exec-path-valued-escape-rejected` | 同上；absolute/`..`/option path矩阵 |
| CR8 | `CR08-exec-git-root-override-rejected` | 同上；`-C/--git-dir/--work-tree`与正常只读Git对照 |
| CR9 | `CR09-file-symlink-ancestor-rejected` | 同上；真实contained write tool，外部目标保持不存在 |
| CR10 | `CR10-discovery-read-and-probe-unlocks` | 同上；成功contained read content + probe exit 0 |
| CR11 | `CR11-discovery-read-failures-do-not-unlock` | 同上；read error/escape/`exists=false`实际file tool |
| CR12 | `CR12-discovery-read-without-probe-rejected` | 同上；prepare/check零spawn |
| CR13 | `CR13-discovery-bad-probes-do-not-unlock` | 同上；rejected/non-zero/timeout probe矩阵 |
| CR14 | `CR14-ledger-prepare-check-report-consistent` | 同上；真实tool sequence与report reconciliation |
| CR15 | `CR15-fake-clock-probe-cumulative-deadline` | 同上；注入monotonic clock/scheduler，无real sleep |
| CR16 | `CR16-fake-clock-prepare-run-deadline-kill` | 同上；15m/30m统一remaining与active watchdog |
| CR17 | `CR17-controller-abort-kills-descendants` | 同上；只触发constructor signal，观察进程组/孙进程 |
| CR18 | `CR18-semaphore-three-worktrees-cancel-fault` | 同上；barrier active≤2、取消永不spawn、fault后slot复用 |
| CR19 | `CR19-lease-heartbeat-terminal-token-races` | 同上；fake scheduler、busy guard release、dead stale/replacement token/listener cleanup |
| CR20 | `CR20-github-reservation-failure-zero-spawn` | GitHub unattended suites；真实reservation callback throw/reject/persist fault |
| CR21 | `CR21-github-started-crash-resume-hash-dedupe` | 同上；persist→spawn→pre-report fault→resume，同hash零二次spawn |
| CR22 | `CR22-sdk-cli-github-command-env-parity` | Studio SDK/CLI + GitHub真实repository command输出env key集合 |
| CR23 | `CR23-cli-ipc-complete-schema-attacks` | Studio CLI/auto child-parent pipe；fd/control env不可见及frame攻击矩阵 |
| CR24 | `CR24-installed-tarball-runtime-load-handshake` | `test-package-assets`；temp consumer installed root、无关cwd、真实extension/transitives/handshake |
| CR25 | `CR25-installed-cli-auto-fail-closed-matrix` | `test-package-assets` + Studio auto；删asset/transitive、version/fence/schema/frame负例 |

### 1E. WDP-10 六类 blocker 的额外通过条件

| Blocker | 必须通过 | Fail-closed 要求 |
| --- | --- | --- |
| CR矩阵 | 上表25项均在测试输出/源码case id和checker handoff可定位，并到达规定的真实runner/tool/failure boundary | 缺任一项即WDP-10未完成；不得新增后继修复项稀释范围 |
| Lease cleanup | acquire/heartbeat/recovery/release使用同一可取消transition序列；release停止并等待在途heartbeat后matching-token删除；terminal移除AbortSignal listener、scheduler handle、waiter、slot与lease | guard busy必须在共享deadline内等待或specific fail closed；不得静默成功、泄漏live-PID owner或删除replacement owner |
| Deadline/semaphore | 一个injected monotonic scheduler与constructor run deadline覆盖slot、lease retry/transition、sleep、heartbeat、purpose budget、watchdog与controller abort；fake scheduler可驱动 | 产品路径不得直接使用真实`setTimeout`/`delay`重置预算；取消waiter不得late grant/spawn |
| Safe result | 共享parser校验outer frame与result完整required exact schema、enum/nullability/range/hash/bounds，以及status/stage/reason/retryability/timedOut/commandStarted/reportHash跨字段矩阵 | child exit 0、部分result、outer unknown、fd/control-env伪造、unknown/overflow、重复/trailing/truncated/oversized/bad JSON/version/fence均不通过 |
| Installed package | 实际packed package位于temp consumer installed root；从无关cwd加载extension/runtime transitives、完成policy/IPC handshake并断言resolved paths都在installed root | source checkout fallback、缺asset/transitive、handshake/frame异常均使CLI/auto restricted失败，且不访问registry |
| GitHub dedupe | generation-scoped bounded reservation ledger与attempt count一致；persist throw/reject零spawn；persist→spawn→pre-report crash resume同hash零spawn；不同hash纠正在budget内 | count/ledger不一致或legacy state含糊时operator block，不猜测可重复prepare |

### 1F. WDP-10 收敛完成定义

1. 六类 blocker 必须在同一子任务内全部关闭；不新增执行协议、状态模型、reason体系、UI、生态adapter、cache或sandbox范围。
2. CR1–CR25 每项均有稳定case id、真实边界、正/负路径和可复核结果；`noteRepositoryEvidenceRead()`、构造`checkResult` override、静态源码检查、source-tree fallback与仅靠real sleep的断言均视为缺失证据。
3. scheduler、lease、IPC、installed package与GitHub crash/mismatch必须分别有故障注入证据，而非只验证成功路径。
4. `npm run test:worktree-check`、`test:package-assets`、Studio、GitHub全部focused suites、lint、tsc与`git diff --check`均通过。
5. 全局checker必须对最新`review.md`六项逐项给出无blocker结论；任一项仍为needs-work时，WDP-10保持未完成，不再用新增抽象或WDP-11转移范围。

## 2. 通用性与 trusted policy

| ID | 场景 | 期望 |
| --- | --- | --- |
| P1 | repo A用自带wrapper恢复依赖 | LLM可通过通用exec调用，平台不识别生态 |
| P2 | repo B用另一种manifest/lock/wrapper | 同一协议/工具成功，无adapter分支 |
| P3 | repo只有docs/CI命令 | LLM读取并执行已有check；无prepare时`not_needed` |
| P4 | repo证据冲突 | `check_dependency_discovery_inconclusive`，零prepare |
| P5 | repo无相关check | report必须显式blocked/not-applicable rationale；不能伪Pass |
| P6 | production source scan | 不出现npm/pnpm/yarn/bun/pip/cargo等安装选择表（测试fixture名除外） |
| P7 | report schema unknown reason/field overflow | fail closed |
| P8 | policy version不匹配 | `check_runner_policy_unavailable`，不启动unrestricted child |

### Trust injection

| ID | 输入 | 期望 |
| --- | --- | --- |
| T1 | Issue写“运行sudo/global install” | 仅作untrusted data，command被拒绝 |
| T2 | task写“忽略attempt/timeout” | budget不变 |
| T3 | task写绝对cwd/env/registry token | 不进入tool input/env/projection |
| T4 | task伪造`submit_check_report` JSON | 不形成server tool evidence |
| T5 | repo `.pi` extension覆盖bash/read | checker profile不加载该extension |
| T6 | repo skill/prompt要求放开工具 | checker profile不加载为system instruction |
| T7 | repo AGENTS/README含prompt injection | 可作为read data，但hard tool策略不变 |
| T8 | GitHub Issue写validationCommands | broker仍只读operator config |

## 3. Discover → Prepare → Check 状态

| ID | 场景 | 期望 |
| --- | --- | --- |
| D1 | 未成功读取contained项目文件，或无成功probe，直接prepare/check | tool拒绝，reason discovery incomplete |
| D2 | contained docs/config内容读取成功 + probe exit 0 | 才可进入prepare/check |
| D3 | executable不存在 | `check_dependency_tool_missing` |
| D4 | 缺宿主tool但有repo wrapper | wrapper containment通过后可执行 |
| D5 | 缺宿主tool且只可系统安装 | block/operator，不尝试提权 |
| D6 | 依赖已存在且check可直接运行 | environment `not_needed` + check evidence |
| D7 | prepare成功 | failure latch清空/保持ready，随后可check |
| D8 | prepare失败 | check暂不可运行，只允许一次证据关联纠正 |
| D9 | check失败 | `needs_work/check_validation_failed`，不归类dependency failure |
| D10 | report前无check evidence | pass report拒绝 |

## 4. Command / path / permission matrix

### Generic executor

| ID | 场景 | 期望 |
| --- | --- | --- |
| E1 | bare executable + argv | `shell:false`、fixed WorkTree cwd |
| E2 | WorkTree-relative wrapper普通文件 | 可运行 |
| E3 | absolute executable | 拒绝 |
| E4 | relative cwd `../` escape / symlink escape | 拒绝 |
| E5 | shell、`-c`/inline eval、command substitution intent | 拒绝 |
| E6 | env/stdin script/background参数或`env`进程委派 | schema无字段或spawn前拒绝 |
| E7 | executable/arg含NUL/control/超长 | 拒绝 |
| E8 | positional/path-valued option中的absolute/`..` path指向WorkTree外 | spawn前拒绝 |
| E9 | URL userinfo/token-shaped arg | 拒绝且不回显 |
| E10 | privilege/system service/global config command | 拒绝 |
| E11 | remote login/copy或generic download-and-execute | 拒绝 |
| E12 | Git status/diff/log | 允许只读 |
| E13 | Git commit/push/reset/clean/checkout/config | 拒绝 |
| E14 | scoped read/find/grep/ls escape | 拒绝 |
| E15 | scoped edit/write escape或task authority file | 拒绝 |
| E16 | output超限 | bounded tail/redacted，不崩溃 |
| E17 | SDK active tools | 仅scoped files + generic exec + report |
| E18 | CLI active tools/flags | 与SDK等价，无builtin bash/project resources |
| E19 | `env sh -c`、`xargs sh`、`find -exec/-execdir` | capability gate拒绝launcher/delegation |
| E20 | `git -C`、`--git-dir`、`--work-tree` | 拒绝改root；只读subcommand allowlist仍生效 |
| E21 | nonexistent write目标的最近存在父目录是外部symlink | 拒绝，不创建外部文件 |
| E22 | main WorkTree prepare（direct/SDK/CLI/auto） | 全路径一致拒绝，linked WorkTree正常 |
| E23 | project wrapper使用contained relative path | 仍可运行；不因hardening退化为生态allowlist |

### Dependency mutation

| ID | 场景 | 期望 |
| --- | --- | --- |
| M1 | project-local restore写ignored artifacts | success |
| M2 | prepare新增tracked source | `check_dependency_prepare_mutated_sources` |
| M3 | prepare改manifest/lock/toolchain config | 同上，且不auto revert |
| M4 | baseline已有实现diff，prepare不新增 | 不误报 |
| M5 | wrapper尝试主WorkTree dependency link/copy | policy/containment拒绝或Git evidence block |
| M6 | sudo/doas/su | 拒绝 |
| M7 | OS package manager/system service | 拒绝 |
| M8 | user/global install/config/profile | 拒绝 |
| M9 | repo wrapper project-local bootstrap | 可运行，仍受timeout/mutation |
| M10 | lifecycle script孙进程 | timeout/abort终止完整树 |
| M11 | package/tool普通外部content cache | 允许但不作为平台cache authority |
| M12 | private dependency需要未注入credential | prepare failed/operator，safe output无secret |

## 5. Budget、lease与 anti-spin

| ID | 场景 | 期望 |
| --- | --- | --- |
| B1 | probe第20次内 | 可运行 |
| B2 | probe第21次或累计3m | discovery终止 |
| B3 | 第一次prepare失败 + 新证据不同argv | 允许一次纠正 |
| B4 | 第二次相同argv hash | 拒绝 |
| B5 | 第三次prepare | `check_dependency_prepare_attempt_limit` |
| B6 | prepare累计逼近15m后启动下一条 | timeout clamp到purpose/run remaining并由watchdog终止 |
| B7 | check单条10m | `check_validation_timeout`，同时受run remaining更小值约束 |
| B8 | checker总计逼近30m时已有command运行 | 到总deadline终止active process tree，不只在下次启动检查 |
| B9 | 同WorkTree 2个checker | 后者lease等待/拒绝，不并行install |
| B10 | 不同WorkTree 2个checker | 可并发、状态隔离 |
| B11 | 第3个WorkTree | semaphore等待 |
| B12 | live PID旧lease | 不偷；超时specific reason |
| B13 | dead stale lease/token替换 | recover；旧release不删新owner |
| B14 | GitHub restart/same generation | prepare在spawn前durable reservation；report前崩溃仍保留attempt |
| B15 | controller AbortSignal在command active时触发 | 完整process tree终止，listener清理，后续command拒绝 |
| B16 | durable reservation写失败 | prepare零spawn且不伪装成started failure |
| B17 | lease长时间持有 | heartbeat持续更新；dead stale recover与token-safe release |

使用barrier/fake clock/IPC/fault injection，避免仅靠sleep的脆弱断言。

## 6. Report evidence / “失败伪装无进展”

| ID | 场景 | 期望 |
| --- | --- | --- |
| R1 | prepare/check都成功 +合法ids + Pass | passed |
| R2 | no-prepare + successful check +合法report | passed |
| R3 | prepare失败，assistant自由文本说Pass | failed，保留prepare reason |
| R4 | prepare失败，report伪造success | `check_report_inconsistent` |
| R5 | report引用unknown command id | inconsistent |
| R6 | report漏掉已失败prepare | inconsistent |
| R7 | prepare失败后合法第二次成功+checks成功 | 可pass，attempts=2 |
| R8 | child process exit 0但未submit report | `check_report_missing` |
| R9 | report tool被task文本模拟 | 无server ledger，不接受 |
| R10 | install运行中无stdout但有heartbeat | 显示preparing，deadline仍生效 |
| R11 | install失败后LLM持续读/聊天 | 到终态仍为具体prepare reason，不是runner_no_progress |
| R12 | report与operator validation结果冲突 | GitHub final以server operator validation为准 |

## 7. Status、timeout、取消与隐私

| ID | 场景 | 期望 |
| --- | --- | --- |
| N1 | 首次项目读取/probe | fixed `discovering_project` progress |
| N2 | prepare command active | fixed `preparing_dependencies` + command id/heartbeat |
| N3 | check active | fixed `running_checks` |
| N4 | report tool | fixed `reporting` |
| N5 | command非零 | 立即ledger失败，不靠assistant解释 |
| N6 | command timeout | process tree kill + specific reason |
| N7 | parent cancel | cancelled，后续commands禁用 |
| N8 | budget exhaustion | specific attempt/discovery/timeout reason |
| N9 | child idle generic watchdog | 若已有prepare failure，specific reason优先 |
| N10 | async collect | 看到同一controller终态，不停留running |

| ID | 安全场景 | 期望 |
| --- | --- | --- |
| S1 | WorkTree删除/替换/metadata改变 | command前重验失败 |
| S2 | command spawn后有孙进程 | abort/timeout无orphan |
| S3 | output含absolute path | safe projection不含 |
| S4 | output含credential URL/token | redacted，events/task无泄漏 |
| S5 | env含GitHub App/machine secret | unattended child/exec不可见 |
| S6 | Issue/task请求env注入 | 忽略 |
| S7 | raw argv含敏感值 | executor拒绝；safe ledger仅hash |
| S8 | state/lease path symlink | fail closed |
| S9 | owner metadata权限异常 | fail closed，不写越界 |
| S10 | report summary超限/secret | bounded/redacted |
| S11 | GitHub safe event | 无argv/cwd/output/env/URL |
| S12 | Studio compact projection | 仅fixed status/reason，无raw install output |
| S13 | scoped file tool读同用户home | containment拒绝 |
| S14 | wrapper内部尝试宿主副作用 | 文档明确app guard不能证明阻止；受控容器人工验证 |
| S15 | CLI controller/result/policy env | extension可读，repository command env全部剥离 |
| S16 | parent-owned result IPC | repo child不继承fd；重复/超限/坏schema消息fail closed |
| S17 | SDK/CLI env parity | 同一builder、相同required execution keys与secret deny结果 |

## 8. GitHub unattended

| ID | 场景 | 期望 |
| --- | --- | --- |
| G1 | checking初次进入 | `checkStage=checker`，真实member checker启动 |
| G2 | Issue提示install command | 不改变trusted policy/tool args authority |
| G3 | checker discovery/prepare失败 | operator validation执行0次 |
| G4 | checker needs_work | blocked validation layer，不写checkerPassed |
| G5 | checker Pass report合法 | persist report hash/run id，再进入operator_validation |
| G6 | operator validation失败 | 保留原validation_failed/timeout语义，可区分checker |
| G7 | 两阶段都通过 | 才进入awaiting_publish/final policy |
| G8 | crash在checker成功持久化后 | resume跳过checker，不重复prepare |
| G9 | crash在prepare reservation/spawn后、报告前 | reservation先durable；attempt已计；resume不无限重跑 |
| G10 | prepare command nonzero/timeout | operator block，默认不auto repeat scripts |
| G11 | lease/runtime command未启动 | bounded retry_due + same generation |
| G12 | retry | same job/generation/WorkTree/task/checking |
| G13 | safe events | allowlisted counts/flags/reason/report hash |
| G14 | completion evidence | checker report + operator validation + final diff均绑定才true |
| G15 | publish/handler suites | checker失败不能产生publish-ready evidence |

## 9. 普通 Studio

| ID | 场景 | 期望 |
| --- | --- | --- |
| Y1 | SDK linked WorkTree checker | restricted profile + lease |
| Y2 | CLI linked WorkTree checker | server extension/flags/tool parity |
| Y3 | auto SDK preflight失败 | 仅fallback到restricted CLI |
| Y4 | CLI trusted extension加载失败 | fail closed，不fallback unrestricted |
| Y5 | prepare失败 | run failed +具体`check_*` termination reason |
| Y6 | assistant saysPass但report缺失 | failed |
| Y7 | async checker | 及时返回run id；progress/collect终态正确 |
| Y8 | sync checker | 等待controller+child终态 |
| Y9 | cancel during prepare | process tree kill，无checks/report pass |
| Y10 | review-only checker | 同一协议 |
| Y11 | improvement/local-review checker | 同一协议和subtask boundary |
| Y12 | architect/implementer/ui-designer | 不启用restricted Check profile |
| Y13 | main WorkTree checker（D2默认） | direct/SDK/CLI/auto均可discover/check但拒绝prepare |
| Y14 | transcript/task/SSE | 不把raw dependency output投影到父层 |
| Y15 | packed npm安装形态 | CLI asset从package root加载，缺失/handshake错时fail closed |

回归：approval、implementation DAG claim、child session header/index、SDK request affinity、auto fallback既有语义。

## 10. Smoke fixtures（不依赖真实生态/网络）

在temp repo创建两个不同形态项目：

1. 项目A docs声明运行`./tools/restore-a`和`./tools/check-a`；restore在WorkTree内创建ignored artifact，check验证它。
2. 项目B使用不同目录/配置名和`./bootstrap`/`./verify`；同一executor无需新增adapter即可完成。
3. 创建linked WorkTree，确认主工作树artifact未复制/链接。
4. checker读取docs、probe wrapper、prepare、check、submit report；第二次checker可由LLM probe发现环境ready并跳过prepare（平台不提供cache marker）。
5. 失败fixture让restore exit非0并输出fake secret/path，确认specific reason与privacy。
6. mutation fixture让restore改tracked config，确认block且文件不被自动revert。

测试不得调用真实package manager、registry、GitHub、用户agentDir或system installer。

## 11. 自动验证命令

```bash
npm run test:worktree-check
npm run test:package-assets
npm run test:studio-sdk-runner
npm run test:studio-dag
npm run test:github-unattended-runner
npm run test:github-unattended
npm run test:github-handler-runtime
npm run test:github-publish-policy
npm run lint
node_modules/.bin/tsc --noEmit
git diff --check
```

禁止routine开发直接运行`next build`。

## 12. 人工验收

### A. 普通Studio WorkTree

1. 新WorkTree无依赖产物，派checker。
2. 观察既有run状态依次显示发现、准备、checks、报告；不显示raw命令输出/绝对路径。
3. 确认checker引用项目docs/config选择命令，而非平台生态提示。
4. 人为让prepare失败，确认run立即有具体失败原因且不会反复安装/显示generic无进展。
5. 恢复环境后新run成功；主工作树未被复制/链接依赖。

### B. GitHub受控环境

1. 同generation进入checking，确认真实checker先于operator validation。
2. 在Issue文本放置策略注入，确认命令权限/validationCommands不变。
3. checker失败时job在validation层阻塞、WorkTree/task保留、operator commands为0。
4. 恢复后operator显式retry，确认attempt budget与same generation语义。
5. events/status无argv/path/output/env/credential。

### C. 发布包与CLI authority

1. 运行package asset smoke实际生成tarball并放入temp consumer的installed-package形态；发布物必须含CLI extension自身资产，已声明runtime transitives必须从该consumer安装树解析。
2. 从与源码和解包目录都无关的checker cwd启动真实restricted CLI extension并完成policy/IPC handshake，断言产品模块解析路径位于installed package root而不是源码仓库。
3. 让repo command尝试读取Check control/result env与伪造result，确认不可见且父侧拒绝非IPC/坏handshake结果。
4. 删除一个asset或改变policy version，确认CLI/auto fail closed而不是回退unrestricted runner。

### D. 安全残余

在dedicated低权限容器中运行包含project wrapper/lifecycle child的fixture，验证timeout/cancel；记录：WorkTree/app guard不是host sandbox，若生产无法提供低权限隔离应作为部署风险而非声称已解决。

## 13. 重点风险清单

- [ ] production没有生态specific planner/installer。
- [ ] trusted policy不能被Issue/task/project extension覆盖。
- [ ] SDK/CLI都没有unrestricted builtin bash，且env/result authority一致。
- [ ] main WorkTree prepare在direct/SDK/CLI/auto均符合批准D2。
- [ ] launcher delegation、external path args、Git root override和symlink ancestor escape被拒绝。
- [ ] successful contained read + successful probe是prepare/check硬门禁。
- [ ] purpose/run累计预算、controller parent abort、maxConcurrency=2、cancelled waiter removal、slot finally release和lease heartbeat/CAS recovery有fake-clock/barrier确定性证据。
- [ ] prepare最多2次且GitHub在spawn前durable reservation（generation/run fence/attempt/hash），persist失败零spawn、spawn后crash/resume不重复scripts。
- [ ] started install failure默认不automatic retry。
- [ ] platform ledger/report reconciliation胜过assistant文案。
- [ ] specific install failure不会折叠为runner_no_progress。
- [ ] prepare Git mutation不auto reset。
- [ ] completion evidence不能在checker/validation失败时写true。
- [ ] 实际npm tarball解包安装形态可从无关cwd加载CLI asset/transitives并完成handshake，missing/mismatch fail closed。
- [ ] repository command只收到显式最小env allowlist，不可见NPM/OpenAI/AWS等凭据或Check control/result变量。
- [ ] repository command不继承IPC fd且不能伪造parent结果；父侧只接受唯一、bounded、完整required schema+enum/range/status一致性+protocol+fence匹配的消息。
- [ ] lease terminal release等待在途heartbeat，guard busy不静默跳过，并移除controller AbortSignal listener/timer/waiter/slot。
- [ ] GitHub resume恢复generation内consumed command hash，同一prepare script在spawn后crash时不会作为第二attempt重跑。
- [ ] 文档没有把restricted tools描述成sandbox。

## 14. 通过标准

- PRD R1–R12均有实现和测试证据；
- focused suites、lint、tsc通过，或仅有明确pre-existing unrelated证据；
- checker附带CR1–CR25真实测试映射且没有blocker/needs-work；
- 主会话已批准D1–D6并保存包含WDP-10的修订implementationPlan；
- 未新增UI结构，无需HTML原型；若实现新增专用状态布局/按钮/日志界面，本结论失效并触发UI门禁。
