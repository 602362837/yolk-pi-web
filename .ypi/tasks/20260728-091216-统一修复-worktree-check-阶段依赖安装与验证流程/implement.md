# Implement — 通用 WorkTree Check 协议与执行边界

## 1. 执行原则

- WDP-01…09 已执行，但最新全局 checker 仍确认六类 blocker；本次只新增 changes-requested 收敛子任务 WDP-10，不把 WDP-09 的局部实现或 focused 绿测视为全局验收。
- WDP-10 保持已批准 D1–D6：不新增 package-manager/语言/lockfile adapter，不扩大主 WorkTree prepare 权限，不新增 UI，也不扩展新的策略、状态或平台抽象。
- 修复只关闭 `review.md` 已列出的 scheduler/deadline、lease ownership、CR1–CR25 真实路径、CLI safe-result、installed package 与 GitHub reservation 六类缺口；不得借机泛化或另立后续 remediation 范围。
- 证据必须来自 hard runtime boundary 与真实 runner/tool/package failure path；不能以 prompt、文档声明、静态源码匹配、构造 `checkResult` 或测试 helper 直写内部状态替代。
- 主会话保存新版 implementationPlan 后应保留 WDP-01…09 为 done、将 WDP-10 置为唯一 pending/ready，再回到 implementing；不得 commit/push/merge。

## 2. 实现前优先阅读

| 顺序 | 文件 | 目的 |
| --- | --- | --- |
| 1 | [prd.md](prd.md)、[design.md](design.md)、[checks.md](checks.md) | 最新通用协议、权限、状态和验收 |
| 2 | `lib/ypi-studio-agents.ts`、`lib/ypi-studio-extension.ts` | checker definition、prompt拼接、SDK/CLI/auto启动 |
| 3 | `lib/ypi-studio-child-session-runner.ts` | SDK customTools、toolEnv、progress、abort/finalization |
| 4 | Pi `README.md` CLI tool/resource flags、`docs/extensions.md` tool override/events | trusted CLI extension和SDK custom tool正确用法 |
| 5 | `lib/github-automation-session.ts` | unattended prompt envelope、member runner、secret env scrub |
| 6 | `lib/github-automation-runner.ts` checking/final evidence | durable checker→validation状态 |
| 7 | `lib/github-validation-broker.ts`、`lib/github-full-agent-profile.ts` | operator command authority、residual risk |
| 8 | `lib/git-worktree.ts`、`lib/project-registry.ts` | canonical WorkTree/pathKey helper |
| 9 | `lib/*account-lock.ts` | mkdir owner lease、live PID/token-safe release模式 |
| 10 | [review.md](review.md) 与当前 WorkTree Check 实现 | 逐项关闭最新6类checker blocker，不以既有绿测或内部helper替代证据 |
| 11 | `package.json`、`bin/server-runner.js`、`scripts/build-next.js`、`npm pack --dry-run --json`输出 | 明确CLI extension发布资产根、打包清单与installed-package smoke |
| 12 | Studio/GitHub focused scripts与docs maps | regression/documentation integration |

## 3. 人类可读子任务表

| ID | Phase | 标题 | dependsOn | 主要文件 | 并行 |
| --- | --- | --- | --- | --- | --- |
| WDP-01 | policy | 通用checker协议、reason与结构化report reconciliation | — | 新policy模块、agents/types | 否 |
| WDP-02 | runtime | WorkTree-scoped受限exec、lease、budget、ledger与scoped tools | WDP-01 | 新execution模块/extension | 否 |
| WDP-03 | studio | Studio SDK/CLI/auto等价受限profile与progress | WDP-02 | Studio extension/runner/tests | 可与WDP-04并行 |
| WDP-04 | github | unattended真实checker substage + operator validation durable gate | WDP-02 | GitHub session/runner/types/tests | 可与WDP-03并行 |
| WDP-05 | regression | 跨runner权限、anti-spin、evidence/privacy回归 | WDP-03,WDP-04 | focused scripts/package.json | 否 |
| WDP-06 | docs-verify | architecture/library/integration/runbook与全量验证 | WDP-05 | docs/AGENTS按需 | 否 |
| WDP-07 | review-remediation | 关闭checker的runtime、durability与package blockers | WDP-06 | execution/extension、Studio/GitHub runner、package与focused tests | 否 |
| WDP-08 | second-review-remediation | 关闭lease/semaphore/env/IPC/package及真实runner证据缺口 | WDP-07 | execution/extension、Studio/GitHub runner、package与deterministic tests | 否 |
| WDP-09 | final-review-remediation | 关闭最新六类runtime与真实路径验收blocker | WDP-08 | lease/deadline/schema、Studio/GitHub真实runner、installed package与CR映射 | 否 |
| WDP-10 | closure-remediation | 收敛关闭最终六类checker blocker并交付真实验收证据 | WDP-09 | 统一scheduler、lease所有权、CR矩阵、IPC、installed package、GitHub crash dedupe | 否 |

## 4. 详细执行说明

### WDP-01 — Trusted policy 与 report contract

1. 新建`lib/worktree-check-policy.ts`，定义policy id/version、phase、limits、reason code、safe result、command evidence和report schema。
2. 生成语言无关trusted checker system guidance：读项目说明/CI/config；识别语言、manifest/lock/wrapper/tool；证据充分才prepare；成功后checks；最后调用report tool。
3. 明确Issue/task只提供scope/acceptance，不是install/permission/env/cwd/timeout/validation authority。
4. 实现`submit_check_report`输入校验与ledger reconciliation纯函数；unknown ids、failed-as-pass、缺check evidence、未解决prepare failure都fail closed。
5. 更新default checker说明，但不要依赖member Markdown作为唯一策略；server-owned system injection仍是authority。
6. 单测所有reason/retryability和report矛盾矩阵；不包含任何生态枚举。

### WDP-02 — Generic execution controller

1. 新建`lib/worktree-check-execution.ts`：canonical linked WorkTree确认、phase state、cumulative budgets、command ledger、failure latch、Git status delta和safe result。
2. 加同WorkTree single-flight + agentDir hash mkdir lease；仅serialize checker，不写dependency fingerprint/cache。live PID不偷、dead stale recover、token-safe release、heartbeat。
3. 实现`worktree_check_exec` custom tool：`purpose/executable/args/relative cwd/retryOf`，`shell:false`、server env/timeout、bounded/redacted output、AbortSignal和process-tree kill。
4. Hard deny unrestricted shell/inline eval、privilege/system/global mutation、service/remote/download-execute、Git mutation/publish、absolute executable/path escape/credential args；Git仅只读subcommand。
5. 提供WorkTree-contained read/grep/find/ls/edit/write overrides；保护`.ypi/tasks/**/task.json`、runtime/credential paths和path escape。
6. prepare最多2次；第二次必须不同argv hash并引用失败id；started command failure不auto retry；probe/prepare/check/run wall budgets独立于LLM activity。
7. 提供SDK customTools factory和server-owned CLI extension entry；二者共享controller，不复制规则。
8. 对wrapper/lifecycle residual risk写代码注释：应用guard非OS sandbox。

### WDP-03 — Studio集成

1. `member=checker`时创建execution controller，使用server system policy；task context仍可见，但不能改变controller。
2. SDK：exclude unrestricted builtin tools/project resources，注入scoped customTools；将controller tool lifecycle映射到既有progress字段。
3. CLI：增加`--no-builtin-tools --no-extensions --no-skills --no-prompt-templates --no-context-files`、server-owned`-e` extension与`--tools` allowlist；验证policy handshake/version。
4. auto fallback仅在CLI restricted profile成功preflight后允许；否则`check_runner_policy_unavailable`，不得用unrestricted CLI。
5. child返回后由controller reconcile；free-text Pass不能覆盖prepare/check/report failure。固定termination reason与safe summary，不把raw argv/output写task projection。
6. async/sync、feature/bugfix/review-only/improvement、main plan/local review全覆盖；非checker保持旧行为。
7. 主工作树按D2默认只check、不自动prepare；linked WorkTree持有lease。

### WDP-04 — GitHub unattended集成

1. 在checking durable state增加可选`checkStage=checker|operator_validation`、checker run/report hash、generation-scoped prepare attempt count；旧state默认checker。
2. `runGithubFullAgentMember(member="checker")`使用同一restricted profile、scrubbed env与trusted policy；Issue excerpt继续标为untrusted data。
3. checker evidence不通过：operator validation执行0次，使用具体`check_*` reason，`blockedAtLayer=validation`；started install failure默认operator block。
4. checker通过后persist `checkStage=operator_validation`，再调用现有broker；resume跳过已完成checker，保持same generation/WorkTree/task。
5. 只有lease/runtime且command未启动可bounded retry_due；durable attempt count防restart spin。
6. safe events仅输出phase/count/duration/flags/reason/report hash；不输出argv/path/output/env/URL。
7. completion evidence必须同时绑定checker report、operator validation与final diff；删除当前无真实checker却直接记`checkerPassed=true`的缺口。

### WDP-05 — Regression suite

1. 新增`scripts/test-worktree-check-execution.mjs`与`npm run test:worktree-check`。
2. 用temp Git repo + linked WorkTree + fake generic executables/wrappers；fixture名称可描述生态，但production代码不得感知生态。
3. 覆盖trusted policy注入、project resource禁用、SDK/CLI tool parity、path/tool/command deny、budget/attempt/timeout/abort/process tree、lease和Git mutation。
4. 覆盖report evidence reconciliation、install failure latch、重复argv、assistant假Pass、report missing/inconsistent、specific reason优先于runner_no_progress。
5. 覆盖GitHub checker→operator validation顺序、resume skip、generation attempt persistence、env scrub和safe event privacy。
6. 覆盖Studio async/sync/SDK/CLI/auto fallback及非checker/main WorkTree行为。
7. 测试不得访问真实registry/GitHub/agentDir；generic local wrapper在WorkTree内创建ignored dependency artifact并运行check作为smoke。

### WDP-06 — Docs 与验证

1. architecture记录LLM-driven Check trust/data flow、evidence authority、durable GitHub stages和非sandbox边界。
2. library map登记policy/execution/extension模块并更新Studio/GitHub消费者描述。
3. integrations记录Pi SDK custom tools、CLI`--no-*`/`-e`/`--tools` profile，及network/lifecycle residual risk。
4. troubleshooting按stable reason给operator动作，说明何时补宿主tool/项目文档、何时修lock/config、何时禁止重复install。
5. standards登记新focused script；AGENTS仅在需要顶层入口时做短导航更新。
6. 跑focused suites、lint、tsc；不直接运行`next build`。

### WDP-07 — Checker review blockers 统一修复

1. **主WorkTree与discover gate：**修正`allowPrepare()`异步判断缺陷；controller明确区分main/linked WorkTree，main在SDK与CLI均只能discover/check。只有contained file content读取实际成功并且ledger已有至少一条成功probe后，才能进入prepare或check；失败/越界read、`exists=false`、rejected/non-zero probe都不计evidence。
2. **命令与路径capability gate：**在共享controller中统一拒绝可委派任意进程或解释字符串的launcher/interpreter模式（至少含`env`、`xargs`、`find -exec/-execdir`及shell/eval变体），而不是只禁直接`sh`；拒绝argv中的外部absolute path、`..` escape及path-valued option escape。Git只允许解析后的只读subcommand，并拒绝`-C`、`--git-dir`、`--work-tree`等改根能力。不存在写目标须canonicalize最近存在父目录，任一symlink ancestor逃出WorkTree即拒绝。
3. **累计预算、取消与并发：**每条命令timeout取`purpose cumulative remaining`、`checker run remaining`与per-command limit的最小值，使用monotonic/fake-clock可测逻辑；controller AbortSignal必须终止active process group并清理listener。实现跨WorkTree全局`maxConcurrency=2` semaphore，以及同WorkTree owner lease heartbeat、stale/dead recovery和token-safe release。
4. **GitHub durable attempt：**增加server callback/adapter，在prepare attempt被接受且命令启动前先持久化generation-scoped reservation（attempt count、run fence/command hash等安全字段）；持久化失败则命令不得启动。崩溃发生在spawn后、report前时，resume仍消耗该attempt且不会重复scripts；command-not-started瞬态语义保持不变。
5. **server-owned env与result channel：**SDK/CLI共用一个server-owned env builder，只透传运行所需allowlist并剥离GitHub secrets、controller/policy/result变量；至少保证两侧PATH/平台必需变量一致。删除仓库命令可见的result file path，改用父进程创建的专用IPC fd/pipe传输单个bounded safe result；repository command不继承该fd或控制env，父侧校验handshake、唯一消息与schema后才采信。
6. **发布资产：**把CLI extension及其runtime transitive dependencies作为明确npm发布资产，路径从应用/package root解析，禁止从checker WorkTree或任意`process.cwd()`猜测。新增无网络package smoke：检查`npm pack --dry-run --json`清单，将tarball解到temp安装形态并验证asset可解析/加载、policy handshake一致及缺asset时fail closed。
7. **回归与文档：**在现有temp repo/fake executable suites补齐[checks.md](checks.md)的CR1–CR25；覆盖SDK、CLI、auto与GitHub crash窗口。若实现细节改变已归档env/lease/package说明，同步architecture/library/integration/troubleshooting；仍不得新增UI或声称OS sandbox。

### WDP-08 — 第二轮 checker blockers 证据闭环

1. **真实 lease heartbeat 与 token-safe transition：**owner记录使用不可复用token、pid、acquiredAt与heartbeatAt。抽出可注入clock/scheduler的lease coordinator；heartbeat定时器在owner存活期间持续刷新并在terminal/dispose时清理。所有acquire、heartbeat、stale recovery与release先取得短生命周期transition guard，再重读owner并匹配expected token（filesystem CAS等价）；heartbeat用同目录临时文件+atomic rename更新，stale recovery仅在guard内二次确认dead/stale且token未变后删除，release也只能删除matching token。长命令、live owner、dead stale、replacement owner、旧heartbeat/release不得破坏新owner。
2. **AbortSignal-aware semaphore与确定性budget/process tests：**全局`maxConcurrency=2` acquire同时接收controller AbortSignal和monotonic deadline；等待项在abort/timeout时原子出队并返回specific command-not-started reason，grant/release为idempotent。slot获批后的lease/write/controller初始化任一异常都必须在`finally`释放slot；terminal/abort亦释放全部timer/listener/lease/slot。用fake clock、barrier和可观察fake spawn验证probe 3m、prepare 15m、run 30m最小remaining clamp，controller-only abort终止process group/descendants，三个WorkTree同时active不超过2，等待者取消后永不晚到启动。
3. **严格server-owned env allowlist：**`buildWorktreeCheckEnv()`改为显式、逐平台最小键集合，只允许执行必需的`PATH`、OS temp/home/locale/platform键；未列出的server变量全部丢弃，不用denylist或`*_TOKEN`模式补洞。SDK、CLI、GitHub都只调用同一builder；repository command不得看到`NPM_TOKEN`、`NODE_AUTH_TOKEN`、OpenAI/AWS/Azure/Google/GitHub/SSH/proxy凭据、Pi/YPI/controller/policy/result/IPC变量。测试比较真实SDK/CLI command env key集合和值来源，并验证GitHub scrub后仍无旁路。
4. **Bounded handshake-matched CLI IPC：**CLI父进程为每次invocation生成不可预测nonce/run fence并创建专用pipe/fd；仅受信CLI extension可见IPC control，repository command spawn显式不继承fd且使用第3项env。消息采用单条length-bounded（建议64KiB）frame，包含固定protocol、policy id/version、invocation fence与完整safe-result schema；父侧以bounded stream读取，要求恰好一条消息、EOF无trailing bytes、nonce/fence匹配、schema无unknown/overflow，再交给reconciliation。缺失、重复、超限、截断、坏JSON/schema/version/nonce及repo伪造一律`check_runner_policy_unavailable|check_report_inconsistent`，不得采信child exit 0或fallback unrestricted。
5. **真实installed-tarball smoke：**`test:package-assets`必须实际生成npm tarball（非仅dry-run），无网络解包到temp installed-package形态，并从与源码/解包目录无关的checker cwd按package root解析、加载CLI extension及全部runtime transitives，完成policy+IPC handshake。对解包副本删除asset/transitive、篡改policy version、产生坏/重复/超限IPC消息，验证CLI与auto fail closed；测试结束清理tarball/temp目录，不运行真实package manager install或registry请求。
6. **真实runner/failure-path CR closure：**补齐[checks.md](checks.md) CR1–CR14、CR20–CR25，禁止以`noteRepositoryEvidenceRead()`等内部helper替代外部路径。main WorkTree须分别经direct、Studio SDK、CLI、auto执行；launcher/path/Git/symlink场景须走实际tool/controller；discover须走contained file tool并覆盖read失败/escape/`exists=false`与probe rejected/non-zero/timeout。GitHub reservation callback throw/reject必须稳定映射`check_runtime_unavailable`且零spawn；durable reservation至少保存generation、run fence、attempt ordinal与command hash，fault injection在reservation成功、spawn开始、report前崩溃后resume不得重跑相同scripts。CR22/23须通过真实SDK/CLI child命令和IPC攻击fixture验证。
7. **收尾与门禁：**更新受影响的architecture/library/integration/troubleshooting说明，保留“应用guard非OS sandbox”和无UI结论。逐项输出CR1–CR25测试映射和失败路径证据，再运行package、Studio、GitHub、lint、tsc与`git diff --check`；任何缺项不得用旧suite绿色替代。

### WDP-09 — 最新全局 review 六类 blocker 最终闭环

1. **CR1–CR25 真实路径映射：**按[checks.md](checks.md) 1D规定的稳定用例名补齐25项映射。CR1、CR4–CR19走direct controller与真实contained file/exec tools；CR2、CR3、CR22、CR23启动真实Studio SDK/CLI/auto restricted checker；CR20–CR22走GitHub runner的reservation/fault/resume路径；CR24、CR25走实际installed-tarball runtime。禁止`noteRepositoryEvidenceRead()`等内部helper、构造`checkResult` override、静态源码正则或旧suite间接覆盖替代外部证据。
2. **Lease terminal ownership修复：**把transition guard从“忙则静默跳过”改为受同一monotonic deadline与AbortSignal约束的串行transition；busy必须等待、超时fail closed，不能伪装为已执行。terminal/dispose先停止新heartbeat、await已在途heartbeat，再在guard内重读并按expected token删除owner；旧heartbeat/release/recovery只能作用于matching token。所有terminal路径移除controller AbortSignal listener、timer、waiter、lease与slot；用fake scheduler制造heartbeat占guard时release、replacement owner及旧cleanup竞态，证明terminal无live-PID owner泄漏。
3. **统一monotonic clock/scheduler与run deadline：**抽出controller-wide clock/scheduler接口，至少覆盖`now`、timeout、interval与sleep；constructor只计算一次run deadline，slot等待、lease retry、heartbeat、purpose budget与command watchdog都消费同一remaining deadline，不能各自重置`timeoutMs`。用barrier/fake spawn验证probe 3m、prepare 15m、run 30m clamp，三WorkTree active≤2，等待者controller-only abort/deadline后原子出队且永不晚到spawn，lease/write/init异常后slot可复用，active child进程组和孙进程被终止。
4. **完整safe-result schema authority：**在policy边界提供单一`parseWorktreeCheckExecutionResult()`（名称可调整）供SDK/CLI reconciliation复用；精确校验required keys、无unknown keys、`status/stage/retryability/reasonCode` enum与nullable契约、counts/duration为有限非负安全整数、booleans、bounded safeMessage及reportHash格式，并校验passed/blocked/cancelled之间的跨字段一致性。父侧只接受单个≤64KiB、protocol/policy/fence匹配且EOF无trailing bytes的frame；缺失字段、非法enum、负数/溢出、重复/trailing/截断/坏JSON/version/fence全部fail closed，child exit 0不得替代schema证据。
5. **真实installed-package runtime smoke：**`test:package-assets`实际`npm pack`并把tarball放到temp consumer的installed package位置，使用当前锁定依赖的本地无网络安装形态；从与source/unpack目录无关的checker cwd启动真实受限CLI加载extension及其runtime transitives，完成policy+IPC handshake，并断言产品模块从installed package root解析而非source tree。删除extension或任一必要transitive、篡改policy version、发送缺失/重复/超限/坏frame时CLI与auto均fail closed；测试清理tarball/temp且不访问registry。
6. **GitHub reservation crash dedupe：**durable state按generation保存bounded reservation ledger（至少run fence、attempt ordinal、command hash和started/consumed状态），resume把已消费hash传入controller；同generation相同prepare hash必须在reservation/spawn前拒绝，只有不同hash且仍在attempt budget内才可作为证据关联纠正。reservation callback throw/reject/persist failure统一为command-not-started `check_runtime_unavailable`且spawn计数为0；在“persist成功→spawn观察到→report前崩溃”注入故障后resume不得再次运行同hash。旧state若attempt count与hash ledger不一致应fail closed并要求operator处理，不猜测可重试命令。
7. **收尾：**只同步受影响的architecture/library/integration/troubleshooting说明；产出逐项CR→稳定test case→runner→failure-path结果表。运行全部focused/package/lint/tsc/diff门禁；任何CR缺失、真实child未启动、fixture回落source tree或仅靠sleep的断言都视为未完成。继续明确应用guard不是OS sandbox，也不得新增UI。

### WDP-10 — 六类剩余 blocker 收敛修复

WDP-10 是本任务的封口子任务，只修复最新 `review.md` 的六类剩余问题；不得新增新的执行协议、reason code 体系、UI、生态 adapter、缓存或 sandbox 声明。

1. **一个 injected monotonic scheduler 与一个 run deadline：**在 controller 构造时注入统一 `clock/scheduler`（`now`、timeout、interval、sleep/cancel），只计算一次 run deadline。semaphore 等待、lease acquire/retry/transition、heartbeat、purpose budget、command watchdog 与 controller abort 全部消费同一 remaining deadline；产品路径不得绕回直接 `setTimeout` 或真实 `delay`。用 fake scheduler + barrier + observable production spawn adapter 关闭 CR15–CR18，证明预算 clamp、等待取消不 late spawn、slot fault 后复用、active≤2，以及 constructor AbortSignal 终止进程组和孙进程。
2. **Lease 串行所有权与终态清理：**acquire/heartbeat/recovery/release 走同一可取消、受 run deadline 约束的 transition 队列；terminal 先禁止新 heartbeat，等待在途 heartbeat，再在 transition 内重读 owner 并按 expected token 删除。旧 heartbeat/release/recovery 不得操作 replacement owner；success/abort/failure 均移除 AbortSignal listener、scheduler handle、semaphore waiter/slot 与 lease。用 fake scheduler 明确制造 busy-guard release、dead stale recovery、replacement token 和 cleanup race，关闭 CR19。
3. **CR1–CR25 真实路径矩阵：**严格使用 `checks.md` 1D 的稳定 case id。CR1、CR4–CR19 走真实 contained file/exec tool 与 direct controller；CR2、CR3、CR22、CR23 启动真实 restricted SDK/CLI/auto child；CR20–CR22 走 GitHub runner 的 reservation/fault/resume；CR24、CR25 走 installed tarball runtime。不得调用 `noteRepositoryEvidenceRead()` 建立证据，不得构造 runner `checkResult` override，不得用静态源码扫描或旧 suite 绿测代替。
4. **CLI safe-result 完整 authority：**共享 parser 同时精确校验 outer frame 与 result 的 required/exact keys、protocol/policy/fence、enum/nullability、safe integer/range、bounded string/hash，以及 `status/stage/reasonCode/retryability/timedOut/commandStarted/reportHash` 跨字段矩阵。真实 CLI/auto pipe 覆盖 fd/control-env不可见、缺失/unknown、坏 enum/null、负数/overflow、重复、trailing、截断、超限、坏 JSON、version/fence 不匹配和 child exit 0 无合法 frame；全部 fail closed。
5. **Installed tarball 真实加载：**`test:package-assets` 生成 tarball，放入临时 consumer 的 installed-package 树；从与 source/unpack/consumer package 均不同的 checker cwd 启动真实 restricted CLI，加载 extension 与 runtime transitives并完成 policy/IPC handshake，同时断言所有产品模块 resolved path 位于 installed root。删除 extension/transitive、篡改 policy、发送坏/重复/超限 frame 时 CLI 与 auto 均 fail closed，不得访问 registry 或回落 source tree。
6. **GitHub reservation 故障闭环：**generation-scoped bounded ledger 保持 attempt count 与 reservation（run fence、ordinal、command hash、started/consumed）一致。persist throw/reject/failure 必须映射 command-not-started `check_runtime_unavailable` 且 observable spawn=0；persist成功→spawn已观察→report前故障后，resume 在 reservation/spawn 前拒绝同 hash，同时仅允许 budget 内、证据关联的不同 hash 纠正。legacy/count-ledger 不一致直接 operator block，不猜测可重试。
7. **完成定义：**`checks.md` 1D 的25个case全部可定位且通过；六类 blocker 各有真实正反路径证据；全部 focused/package/lint/tsc/diff 门禁通过；没有 helper/override/source fallback/real-sleep-only 替代证据。任一项不满足即 WDP-10 未完成，不再通过新增抽象或新 remediation 子任务转移范围。

## 5. 验证命令

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

## 6. 评审门禁

- WDP-01：checker确认production无语言/manager/lockfile/install argv表，report不能自证成功。
- WDP-02：重点审查SDK/CLI工具等价、path containment、shell/eval escape、lease、attempt budget、process-tree kill、Git mutation与隐私。
- WDP-03：确认auto fallback不回到unrestricted runner，progress/reason由controller而非assistant文本决定。
- WDP-04：确认Issue/task不能改变策略，resume不重复install，completionEvidence不会提前通过。
- WDP-07：保留为已实现但未通过全局门禁的历史修复，不以其focused suites替代缺失证据。
- WDP-08：保留为历史修复；其focused绿测、静态env probe与tarball文件存在检查不能替代真实验收证据。
- WDP-09：保留为已执行但未通过最新全局门禁的历史修复；`review.md`列出的六类blocker是WDP-10的封闭输入。
- WDP-10：逐项对照最新`review.md`与`checks.md` 1D/1E；必须以统一injected scheduler/run deadline、lease串行所有权与cleanup、真实CR1–CR25路径、完整outer/result IPC schema攻击矩阵、installed consumer runtime handshake及GitHub reservation crash/mismatch fault证据一次性关闭六类blocker。任一case缺失即未完成，不得再以新增抽象或后继修复项稀释范围。
- 全局checker必须明确：应用级guard不是host sandbox；若部署要求硬隔离，另立sandbox blocker而非虚假通过。

## 7. 回滚

- 移除checker execution profile和GitHub checker substage，恢复旧runner/validation；不要删除用户依赖、缓存或WorkTree。
- optional runner state字段可保留；terminal lease/ledger可在无active owner时清理。
- 不以复制主工作树依赖、自动global install或放开unrestricted unattended bash作为回滚替代。

## 8. Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "summary": "Converge the generic WorkTree Check task by closing the six remaining review blockers with real CR1-CR25 runner evidence and no new product scope.",
  "strategy": "Preserve WDP-01 through WDP-09 as completed history, then run one serial WDP-10 closure subtask limited to the latest review findings: one injected monotonic scheduler and run deadline, serialized lease ownership cleanup, complete CLI frame/result authority, installed-consumer runtime loading, GitHub reservation crash dedupe, and the required real direct/Studio/GitHub/package CR1-CR25 matrix. Do not introduce another abstraction or remediation scope.",
  "maxConcurrency": 2,
  "sourceArtifact": "implement.md",
  "subtasks": [
    {
      "id": "WDP-01",
      "title": "Define the generic trusted Check policy and evidence-backed report contract",
      "phase": "policy",
      "order": 10,
      "dependsOn": [],
      "relation": "serial",
      "files": [
        "lib/worktree-check-policy.ts",
        "lib/ypi-studio-agents.ts",
        "lib/ypi-studio-types.ts",
        "scripts/test-worktree-check-execution.mjs"
      ],
      "instructions": [
        "Define a versioned language-agnostic discover, prepare, check and report protocol with fixed limits and stable reason codes.",
        "State that Issue/task text supplies scope only and cannot change command policy, cwd, env, timeout, attempts or GitHub operator validation commands.",
        "Define bounded command evidence and submit_check_report schemas plus pure reconciliation that treats platform observations as authoritative.",
        "Reject missing reports, unknown command ids, failed commands claimed as passed and unresolved preparation failures.",
        "Update the default checker guidance while keeping server system injection, not member Markdown, as the policy authority.",
        "Do not add language, manifest, lockfile, package-manager or install-argv tables."
      ],
      "acceptance": [
        "The policy tells the LLM to derive language, dependencies, locks, wrappers and checks from repository evidence.",
        "No free-text checker verdict can create passed evidence.",
        "Untrusted task/Issue content cannot relax limits or command authority.",
        "Production policy contains no ecosystem-specific installer logic."
      ],
      "validation": [
        "npm run test:worktree-check",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "Prompt wording alone is not enforcement and must not be reviewed as a security boundary.",
        "An over-strict report schema could reject valid no-prepare or no-applicable-check repositories."
      ],
      "parallelizable": false,
      "member": "implementer",
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "WDP-02",
      "title": "Implement the restricted WorkTree Check execution controller and tools",
      "phase": "runtime",
      "order": 20,
      "dependsOn": ["WDP-01"],
      "relation": "serial",
      "files": [
        "lib/worktree-check-execution.ts",
        "lib/worktree-check-extension.ts",
        "lib/git-worktree.ts",
        "scripts/test-worktree-check-execution.mjs"
      ],
      "instructions": [
        "Implement canonical linked-WorkTree validation, phase state, cumulative budgets, failure latch, command ledger and safe result projection.",
        "Add same-WorkTree process single-flight and hashed mkdir owner lease with heartbeat, live-PID protection, stale-dead recovery and token-safe release.",
        "Create worktree_check_exec with purpose, executable, argv, WorkTree-relative cwd and retryOfCommandId; always shell=false with server-owned env and timeouts.",
        "Deny path escape, absolute executables, unrestricted shells or eval, privilege/system/global mutation, service/remote/download-execute, Git mutation/publish and credential-shaped arguments.",
        "Provide WorkTree-contained filesystem tools and a terminating submit_check_report tool; protect Studio runtime/task authority files.",
        "Limit prepare to two distinct attempts with one evidence-linked correction, kill process trees on timeout/abort and detect new tracked/unignored changes after prepare.",
        "Expose one SDK tool factory and one server-owned CLI extension adapter backed by the same controller."
      ],
      "acceptance": [
        "The runtime executes arbitrary project-chosen executables without knowing their ecosystem while preserving fixed WorkTree and argv boundaries.",
        "Repeated or third preparation attempts are rejected deterministically.",
        "Timeout, cancellation, mutation and report inconsistency cannot produce passed status.",
        "Safe state contains no raw argv, cwd, output, env, URL or credentials."
      ],
      "validation": [
        "npm run test:worktree-check",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "Static command guards cannot sandbox arbitrary repository wrappers or lifecycle scripts.",
        "Cross-platform process-tree termination and CLI extension packaging are correctness-critical."
      ],
      "parallelizable": false,
      "member": "implementer",
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "WDP-03",
      "title": "Apply the restricted generic Check profile to Studio SDK, CLI and auto runners",
      "phase": "studio-integration",
      "order": 30,
      "dependsOn": ["WDP-02"],
      "relation": "parallel",
      "files": [
        "lib/ypi-studio-extension.ts",
        "lib/ypi-studio-child-session-runner.ts",
        "lib/ypi-studio-types.ts",
        "scripts/test-ypi-studio-sdk-runner.mjs",
        "scripts/test-ypi-studio-dag.mjs"
      ],
      "instructions": [
        "Create a Check controller only for member=checker and inject the trusted policy as server system guidance after untrusted task context.",
        "For SDK, exclude unrestricted tools and project resources, then supply the shared contained tools and generic executor.",
        "For CLI, launch with no builtins/extensions/skills/prompts/context, load only the server-owned extension and enforce an explicit tool allowlist plus policy-version handshake.",
        "Allow auto fallback only between equivalent restricted profiles; fail closed when the CLI extension cannot load.",
        "Map controller stages to existing progress fields and reconcile child output before recording terminal run status.",
        "Cover async/sync, review-only, improvement/local review and non-checker regressions; main WorkTree follows approved D2."
      ],
      "acceptance": [
        "SDK, CLI and auto checker runs expose equivalent restricted command and filesystem capabilities.",
        "Preparation failure, budget exhaustion or missing/inconsistent report cannot be bypassed by fallback or assistant text.",
        "Existing progress surfaces show fixed discover, prepare, check and report messages without raw command output.",
        "Non-checker behavior remains unchanged."
      ],
      "validation": [
        "npm run test:worktree-check",
        "npm run test:studio-sdk-runner",
        "npm run test:studio-dag",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "SDK resource loading or CLI flags may accidentally leave a project extension or builtin bash active.",
        "Async finalization could record child success before controller reconciliation."
      ],
      "parallelizable": true,
      "member": "implementer",
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "WDP-04",
      "title": "Add a durable restricted checker stage before GitHub operator validation",
      "phase": "github-integration",
      "order": 40,
      "dependsOn": ["WDP-02"],
      "relation": "parallel",
      "files": [
        "lib/github-automation-session.ts",
        "lib/github-automation-runner.ts",
        "lib/github-automation-types.ts",
        "lib/github-automation-projection.ts",
        "lib/github-validation-broker.ts",
        "scripts/test-github-unattended-runner.mjs",
        "scripts/test-github-unattended.mjs"
      ],
      "instructions": [
        "Split checking into durable checker and operator_validation substages, defaulting legacy states to checker.",
        "Run member=checker with the shared restricted profile, scrubbed env and trusted policy while retaining Issue data only as untrusted scope context.",
        "Short-circuit operator validation on checker evidence failure and map stable Check reasons to validation-layer dispositions.",
        "Persist checker report hash, run id and generation-scoped preparation attempts so resume skips a completed checker and cannot reset install limits.",
        "Permit automatic retry only for command-not-started lease/runtime transients; block started preparation failures for operator action.",
        "Record completion evidence only after checker, operator validation and final diff all pass; emit allowlisted safe metadata only."
      ],
      "acceptance": [
        "GitHub unattended runs a real checker before operator validation.",
        "Issue/task text cannot alter Check policy or validation commands.",
        "Resume preserves generation, WorkTree, task and preparation budget without duplicate install loops.",
        "checkerPassed is never recorded from runner flow alone without reconciled report evidence."
      ],
      "validation": [
        "npm run test:github-unattended-runner",
        "npm run test:github-unattended",
        "npm run test:github-handler-runtime",
        "npm run test:github-publish-policy",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "A crash between checker completion and durable substage persistence could repeat repository scripts unless report/run fencing is correct.",
        "Overbroad safe event metadata could expose commands or repository paths."
      ],
      "parallelizable": true,
      "member": "implementer",
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "WDP-05",
      "title": "Complete cross-runner permission, anti-spin, evidence and privacy regressions",
      "phase": "regression",
      "order": 50,
      "dependsOn": ["WDP-03", "WDP-04"],
      "relation": "serial",
      "files": [
        "scripts/test-worktree-check-execution.mjs",
        "scripts/test-ypi-studio-sdk-runner.mjs",
        "scripts/test-ypi-studio-dag.mjs",
        "scripts/test-github-unattended-runner.mjs",
        "scripts/test-github-unattended.mjs",
        "package.json"
      ],
      "instructions": [
        "Add npm script test:worktree-check and run only temp repos, temp agentDir and local fake executables/wrappers.",
        "Prove production code is ecosystem-agnostic using multiple differently shaped repository fixtures through one executor contract.",
        "Cover tool parity, project resource disabling, path and command denies, budgets, duplicate attempts, timeout, abort, descendants, lease and Git mutation.",
        "Cover platform-evidence precedence for failed install plus fake Pass, missing/inconsistent report and specific reason precedence over runner_no_progress.",
        "Cover Studio runner modes and GitHub checker to validation ordering, durable resume, attempt persistence, env scrub and safe-event privacy.",
        "Ensure no real registry, GitHub, global package manager or user agentDir is touched."
      ],
      "acceptance": [
        "The automated matrix in checks.md is covered or explicitly marked manual with rationale.",
        "No timing-only flaky assertion is needed for lease, budget or resume behavior.",
        "No fixture can make a failed preparation appear as no-progress or pass.",
        "Existing Studio and GitHub focused suites remain green."
      ],
      "validation": [
        "npm run test:worktree-check",
        "npm run test:studio-sdk-runner",
        "npm run test:studio-dag",
        "npm run test:github-unattended-runner",
        "npm run test:github-unattended",
        "npm run test:github-handler-runtime",
        "npm run test:github-publish-policy"
      ],
      "risks": [
        "Process and lease fault tests can leak children or temp locks if teardown is incomplete.",
        "Tests that invoke real ecosystem package managers would contradict the generic/no-network fixture boundary."
      ],
      "parallelizable": false,
      "member": "implementer",
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "WDP-06",
      "title": "Document the generic Check trust boundary and run final validation",
      "phase": "docs-verify",
      "order": 60,
      "dependsOn": ["WDP-05"],
      "relation": "serial",
      "files": [
        "docs/architecture/overview.md",
        "docs/modules/library.md",
        "docs/integrations/README.md",
        "docs/operations/troubleshooting.md",
        "docs/standards/code-style.md",
        "AGENTS.md"
      ],
      "instructions": [
        "Document LLM-driven repository evidence discovery, server policy authority, restricted tools, report reconciliation and GitHub durable substages.",
        "Document CLI and SDK profile parity, project resource disabling and server-owned extension packaging.",
        "Explain stable reasons and operator remediation for missing tools, rejected commands, preparation failures, mutation, timeout, attempt limit and bad reports.",
        "State clearly that repository wrappers and lifecycle scripts are not sandboxed and unattended deployments need low-privilege isolation.",
        "Update test documentation and only add concise AGENTS navigation when warranted.",
        "Run focused suites, lint and TypeScript without direct next build."
      ],
      "acceptance": [
        "Docs do not list supported language ecosystems or claim platform package-manager detection.",
        "Docs distinguish app-level command guards from OS sandboxing and explain anti-spin behavior.",
        "Rollback preserves WorkTrees, tasks, sessions, dependency outputs and global caches.",
        "Focused tests, lint and tsc pass or unrelated pre-existing failures are evidenced."
      ],
      "validation": [
        "npm run test:worktree-check",
        "npm run test:studio-sdk-runner",
        "npm run test:studio-dag",
        "npm run test:github-unattended-runner",
        "npm run test:github-unattended",
        "npm run test:github-handler-runtime",
        "npm run test:github-publish-policy",
        "npm run lint",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "Documentation that calls the profile a sandbox could create unsafe deployment assumptions."
      ],
      "parallelizable": false,
      "member": "implementer",
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "WDP-07",
      "title": "Close WorkTree Check runtime, durability and packaged-CLI review blockers",
      "phase": "review-remediation",
      "order": 70,
      "dependsOn": ["WDP-06"],
      "relation": "serial",
      "files": [
        "lib/worktree-check-execution.ts",
        "lib/worktree-check-extension.ts",
        "lib/worktree-check-cli-extension.ts",
        "lib/ypi-studio-extension.ts",
        "lib/ypi-studio-child-session-runner.ts",
        "lib/github-automation-session.ts",
        "lib/github-automation-runner.ts",
        "bin/server-runner.js",
        "package.json",
        "scripts/test-worktree-check-execution.mjs",
        "scripts/test-ypi-studio-sdk-runner.mjs",
        "scripts/test-github-unattended.mjs",
        "scripts/test-package-assets.mjs",
        "docs/architecture/overview.md",
        "docs/modules/library.md",
        "docs/integrations/README.md",
        "docs/operations/troubleshooting.md"
      ],
      "instructions": [
        "Make linked-WorkTree status a synchronous/awaited authority check: SDK and CLI main WorkTree checker profiles may discover and check but must reject prepare.",
        "Require a successfully completed contained repository file read and at least one successful probe ledger entry before prepare or check; failed/escaped reads and rejected/non-zero probes must not unlock phases.",
        "Replace direct-executable-only checks with one shared capability gate that blocks launcher/interpreter delegation, external absolute or escaping path arguments, Git root/history overrides, and writes through symlink ancestors while preserving contained project wrappers.",
        "Clamp command timeout to purpose-cumulative and total-run remaining budgets, bind controller cancellation to active process-tree termination, add maxConcurrency=2 across WorkTrees, and heartbeat token-safe per-WorkTree leases.",
        "Reserve and durably persist each GitHub generation prepare attempt before spawn through an awaited controller callback; never start the command if reservation persistence fails, and preserve the consumed attempt after crash before report.",
        "Use one server-owned SDK/CLI env builder that strips secrets and all Check control/result variables while retaining required execution variables such as PATH; pass CLI final result over a parent-owned bounded IPC fd/pipe not inherited by repository commands.",
        "Publish the CLI extension plus all runtime transitive assets, resolve it from the application/package root rather than the checker cwd, and add a no-network packed-tarball load/handshake/fail-closed smoke.",
        "Add deterministic CR1-CR25 tests with fake clocks/barriers/fault injection, update affected trust-boundary docs, and rerun all focused, lint and TypeScript gates without next build."
      ],
      "acceptance": [
        "Main WorkTree prepare is rejected in direct controller, Studio SDK, CLI and auto paths while linked WorkTree prepare remains evidence-gated.",
        "env/xargs/find-exec, shell/eval delegation, external path arguments, Git root overrides and symlink-ancestor writes cannot cross the WorkTree boundary.",
        "Only successful contained read plus successful probe unlock prepare/check; cumulative budgets, parent abort, semaphore and lease heartbeat are controller-observed and deterministic.",
        "A GitHub crash after prepare reservation/start cannot restore the attempt budget or rerun the same project scripts automatically.",
        "SDK and CLI repository commands receive equivalent server-owned env without Check control/result variables, and only the parent-owned IPC result can decide CLI terminal evidence.",
        "The npm tarball contains and can load the server-owned CLI extension from an installed-package root; missing or mismatched assets fail closed.",
        "CR1-CR25, existing focused suites, lint, TypeScript and git diff checks pass; no UI or ecosystem-specific adapter is introduced."
      ],
      "validation": [
        "npm run test:worktree-check",
        "npm run test:package-assets",
        "npm run test:studio-sdk-runner",
        "npm run test:studio-dag",
        "npm run test:github-unattended-runner",
        "npm run test:github-unattended",
        "npm run test:github-handler-runtime",
        "npm run test:github-publish-policy",
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "git diff --check"
      ],
      "risks": [
        "A deny-oriented launcher/path gate cannot turn repository wrappers into an OS sandbox; low-privilege isolation remains required.",
        "Durable reservation ordering must avoid both uncounted starts and falsely reusable attempts after crash.",
        "Cross-platform fd/pipe handling, process-tree cancellation and symlink-safe path creation need platform-aware tests.",
        "Publishing a source extension without every runtime transitive dependency would reproduce the installed-package failure."
      ],
      "parallelizable": false,
      "member": "implementer",
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "WDP-08",
      "title": "Close lease, env, IPC, package and real-runner evidence blockers",
      "phase": "second-review-remediation",
      "order": 80,
      "dependsOn": ["WDP-07"],
      "relation": "serial",
      "files": [
        "lib/worktree-check-execution.ts",
        "lib/worktree-check-extension.ts",
        "lib/worktree-check-cli-extension.ts",
        "lib/ypi-studio-extension.ts",
        "lib/ypi-studio-child-session-runner.ts",
        "lib/github-automation-session.ts",
        "lib/github-automation-runner.ts",
        "lib/github-automation-types.ts",
        "package.json",
        "scripts/test-worktree-check-execution.mjs",
        "scripts/test-ypi-studio-sdk-runner.mjs",
        "scripts/test-ypi-studio-dag.mjs",
        "scripts/test-github-unattended-runner.mjs",
        "scripts/test-github-unattended.mjs",
        "scripts/test-package-assets.mjs",
        "docs/architecture/overview.md",
        "docs/modules/library.md",
        "docs/integrations/README.md",
        "docs/operations/troubleshooting.md"
      ],
      "instructions": [
        "Implement a real per-WorkTree owner heartbeat with injected monotonic clock/scheduler, transition-guarded expected-token rechecks, atomic owner writes, dead-stale recovery, matching-token release and terminal timer cleanup so stale recovery or old cleanup cannot delete a replacement owner.",
        "Make the global maxConcurrency=2 semaphore acquire AbortSignal/deadline-aware, atomically remove cancelled or timed-out waiters, make grant/release idempotent, and release slots in finally when lease acquisition, owner persistence, initialization or terminal cleanup fails.",
        "Replace server-env copying with one explicit per-platform minimum allowlist shared by SDK, CLI and GitHub; pass only required PATH, temp/home, locale and platform keys, and prove repository commands cannot observe package, LLM, cloud, GitHub, SSH, proxy or WorkTree Check control/result credentials.",
        "Replace unbounded file reconciliation with a parent-owned IPC pipe/fd carrying exactly one bounded frame containing protocol, policy version, unpredictable invocation fence and the complete safe-result schema; do not inherit the fd or control env into repository commands and fail closed on missing, duplicate, trailing, oversized, truncated, malformed, mismatched or forged messages.",
        "Upgrade test:package-assets to create and unpack the real npm tarball without network access, resolve and load the CLI extension plus runtime transitives from a temporary installed-package root and unrelated checker cwd, complete the policy/IPC handshake, and test deleted assets, changed handshakes and malformed IPC as fail-closed cases.",
        "Cover CR1-CR14 through actual direct, Studio SDK, CLI and auto runner/tool paths rather than internal evidence helpers, including main-WorkTree prepare, launcher/path/Git/symlink guards and successful/failed contained read plus probe evidence matrices.",
        "Cover CR15-CR19 with fake clocks, barriers, observable fake spawns and descendant processes for cumulative deadlines, controller-only abort, maximum active concurrency, cancelled waiters, lease heartbeat, dead-stale recovery and replacement-token safety.",
        "Cover CR20-CR23 with GitHub fault injection: persist the generation, run fence, attempt ordinal and command hash before spawn; map reservation persistence throw/reject to command-not-started check_runtime_unavailable with zero spawn; crash after spawn and before report, then prove resume consumes the reservation and does not rerun the scripts.",
        "Update only affected trust-boundary docs, retain the no-UI and no-ecosystem-adapter decisions, publish a CR1-CR25 test mapping, and rerun all focused, package, lint, TypeScript and diff gates without next build."
      ],
      "acceptance": [
        "Lease heartbeat advances during long commands, live owners are not stolen, dead stale owners recover under a token-checked transition, and old heartbeat/release/recovery actions cannot remove a replacement owner.",
        "Semaphore waiters honour controller abort and deadlines, never start after cancellation, no slot leaks on lease or initialization failure, active executions across three WorkTrees never exceed two, and cumulative budgets/process-tree termination have deterministic evidence.",
        "SDK, CLI and GitHub repository commands receive the same explicit minimum env and cannot observe NPM_TOKEN, NODE_AUTH_TOKEN, OpenAI, AWS, Azure, Google, GitHub, SSH, proxy or Check control/result variables.",
        "Only one bounded protocol- and fence-matched IPC safe-result message can influence CLI terminal evidence; repository commands cannot inherit or forge the channel, and every malformed, duplicate, oversized or mismatched case fails closed.",
        "A real unpacked npm tarball loads the server-owned CLI extension and all runtime transitives from the package root at an unrelated cwd; missing assets or handshake mismatches fail closed without unrestricted fallback.",
        "CR1-CR14 and CR20-CR25 execute real runner/tool/failure paths, GitHub reservation failure causes zero spawn, and crash/resume fencing prevents duplicate preparation scripts.",
        "CR1-CR25, existing focused suites, package smoke, lint, TypeScript and git diff checks pass; no UI, ecosystem adapter or sandbox claim is introduced."
      ],
      "validation": [
        "npm run test:worktree-check",
        "npm run test:package-assets",
        "npm run test:studio-sdk-runner",
        "npm run test:studio-dag",
        "npm run test:github-unattended-runner",
        "npm run test:github-unattended",
        "npm run test:github-handler-runtime",
        "npm run test:github-publish-policy",
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "git diff --check"
      ],
      "risks": [
        "Filesystem transition guards and atomic rename provide token-safe application coordination but still are not an OS sandbox or distributed consensus service.",
        "A too-small env allowlist can break legitimate wrappers, so every added key must be justified as non-secret execution infrastructure and covered equally in SDK, CLI and GitHub tests.",
        "Pipe and process-group behaviour differs across POSIX and Windows; platform-specific setup and fail-closed tests are required rather than silently falling back to a result file.",
        "Crash fencing must distinguish a durable consumed reservation from a command-not-started persistence failure without exposing raw commands in durable state.",
        "Tarball smoke must avoid network and source-tree resolution or it can pass while the published install remains broken."
      ],
      "parallelizable": false,
      "member": "implementer",
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "WDP-09",
      "title": "Close the latest lease, deadline, schema, package, GitHub dedupe and CR evidence blockers",
      "phase": "final-review-remediation",
      "order": 90,
      "dependsOn": ["WDP-08"],
      "relation": "serial",
      "files": [
        "lib/worktree-check-policy.ts",
        "lib/worktree-check-execution.ts",
        "lib/worktree-check-extension.ts",
        "lib/worktree-check-cli-extension.ts",
        "lib/ypi-studio-extension.ts",
        "lib/ypi-studio-child-session-runner.ts",
        "lib/github-automation-session.ts",
        "lib/github-automation-runner.ts",
        "lib/github-automation-types.ts",
        "package.json",
        "scripts/test-worktree-check-execution.mjs",
        "scripts/test-ypi-studio-sdk-runner.mjs",
        "scripts/test-ypi-studio-dag.mjs",
        "scripts/test-github-unattended-runner.mjs",
        "scripts/test-github-unattended.mjs",
        "scripts/test-package-assets.mjs",
        "docs/architecture/overview.md",
        "docs/modules/library.md",
        "docs/integrations/README.md",
        "docs/operations/troubleshooting.md"
      ],
      "instructions": [
        "Deliver a stable CR1-CR25 to test-case mapping and exercise actual direct, Studio SDK, restricted CLI, auto, GitHub runner, contained tool, IPC and package failure paths; do not use internal evidence helpers, constructed check-result overrides, static source scans or old green suites as substitutes.",
        "Replace skip-on-busy lease transitions with deadline- and AbortSignal-aware serialization; stop and await in-flight heartbeats before matching-token terminal deletion, prevent old actions from touching replacement owners, and remove controller abort listeners, timers, waiters, lease and semaphore resources on every terminal path.",
        "Inject one monotonic clock and scheduler across slot waits, lease retries, heartbeat, sleeps and command watchdogs; derive one run deadline and test purpose/run clamps, controller-only abort, descendant termination, maxConcurrency=2, cancelled waiters and slot reuse deterministically.",
        "Add one exact parser for the complete WorktreeCheckExecutionResult contract and use it at CLI reconciliation, rejecting missing or unknown fields, illegal enums/nullability, negative or overflowing numbers, inconsistent status fields, malformed or multiple frames, trailing bytes and handshake mismatches regardless of child exit code.",
        "Make test:package-assets load the real packed extension and all runtime transitives from a temporary installed-package root at an unrelated checker cwd, complete the policy and IPC handshake, and prove deleted assets/transitives, mismatched policy and malformed frames make CLI and auto fail closed without source-tree fallback or network access.",
        "Persist a bounded generation reservation ledger with run fence, ordinal, command hash and consumed/start state; restore consumed hashes into the controller so the same prepare command cannot spawn again after a persist-success, spawn-started, pre-report crash, while reservation persistence throw or reject remains check_runtime_unavailable with zero spawn.",
        "Update only affected trust-boundary docs, retain the no-UI and non-sandbox decisions, emit the CR mapping and run every focused, package, lint, TypeScript and diff gate."
      ],
      "acceptance": [
        "CR1-CR25 each map to a named automated case that reaches the required real runner, tool or failure boundary; no item is manual, indirect or helper-forced.",
        "A terminal release cannot leak a live-PID owner when heartbeat holds the transition guard, old heartbeat/release/recovery cannot delete a replacement owner, and controller listeners/timers/slots are cleaned on success, abort and failure.",
        "One monotonic run deadline governs slot, lease and command waits; fake-clock and barrier tests prove budget clamps, active concurrency at most two, cancelled waiters never spawn, slot faults recover and controller abort kills descendants.",
        "CLI pass is accepted only from exactly one bounded protocol-, policy-, fence- and complete-schema-valid safe result; every malformed, incomplete, inconsistent, duplicate or oversized input fails closed.",
        "The actual unpacked npm package loads the restricted extension and runtime transitives from its installed root at an unrelated cwd and completes a real handshake; missing assets or mismatch never use source fallback or unrestricted auto fallback.",
        "GitHub reservation persistence failure has zero spawn, and resume after a started prepare crash rejects the same command hash while preserving the generation attempt budget and allowing only a distinct evidence-linked correction.",
        "All focused/package suites, lint, TypeScript and git diff checks pass; no UI, ecosystem adapter or OS-sandbox claim is introduced."
      ],
      "validation": [
        "npm run test:worktree-check",
        "npm run test:package-assets",
        "npm run test:studio-sdk-runner",
        "npm run test:studio-dag",
        "npm run test:github-unattended-runner",
        "npm run test:github-unattended",
        "npm run test:github-handler-runtime",
        "npm run test:github-publish-policy",
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "git diff --check"
      ],
      "risks": [
        "A transition queue or deadline bug can trade the current owner leak for deadlock; all waits need abort/deadline and replacement-token tests.",
        "Fake scheduler abstractions must still test the production spawn and process-group adapter rather than only a simulated state machine.",
        "Strict safe-result validation can reject valid output unless it is generated from the shared result contract and cross-field rules are explicit.",
        "Installed-package smoke can falsely pass if module resolution reaches the source checkout; the child must assert resolved paths and run from an unrelated cwd.",
        "Durable hash dedupe must be generation-scoped and bounded so it blocks duplicate scripts without blocking one permitted distinct corrective prepare.",
        "Restricted argv and filesystem guards remain application controls, not an OS sandbox."
      ],
      "parallelizable": false,
      "member": "implementer",
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "WDP-10",
      "title": "Converge and close the six remaining WorkTree Check review blockers",
      "phase": "closure-remediation",
      "order": 100,
      "dependsOn": ["WDP-09"],
      "relation": "serial",
      "files": [
        "lib/worktree-check-policy.ts",
        "lib/worktree-check-execution.ts",
        "lib/worktree-check-extension.ts",
        "lib/worktree-check-cli-extension.ts",
        "lib/ypi-studio-extension.ts",
        "lib/ypi-studio-child-session-runner.ts",
        "lib/github-automation-session.ts",
        "lib/github-automation-runner.ts",
        "lib/github-automation-types.ts",
        "scripts/test-worktree-check-execution.mjs",
        "scripts/test-ypi-studio-sdk-runner.mjs",
        "scripts/test-ypi-studio-dag.mjs",
        "scripts/test-github-unattended-runner.mjs",
        "scripts/test-github-unattended.mjs",
        "scripts/test-package-assets.mjs",
        "package.json",
        "docs/architecture/overview.md",
        "docs/modules/library.md",
        "docs/integrations/README.md",
        "docs/operations/troubleshooting.md"
      ],
      "instructions": [
        "Replace every WorkTree Check real-time wait with one injected monotonic clock/scheduler and one constructor-wide run deadline shared by semaphore, lease transitions/retries, heartbeat, purpose budgets, command watchdog and controller abort; close CR15-CR18 with deterministic barriers and observable production spawn/process-group adapters.",
        "Serialize lease acquire, heartbeat, recovery and release under deadline- and AbortSignal-aware ownership transitions; terminal paths must stop and await heartbeats, delete only a matching token and clean listeners, scheduler handles, waiters, slots and leases; close CR19 replacement-owner races.",
        "Implement and publish the exact CR1-CR25 named cases through real contained tools, direct controller, restricted Studio SDK/CLI/auto children, GitHub reservation/fault/resume runners and installed-package runtime; do not use noteRepositoryEvidenceRead, constructed checkResult overrides, static scans or old green suites as substitutes.",
        "Make the shared CLI safe-result parser authoritative for exact outer frame and complete result schemas, cross-field status semantics and a real fd/control-env plus malformed/duplicate/trailing/truncated/oversized/version/fence/exit-zero attack matrix.",
        "Run the packed extension and all transitives from a temporary consumer installed-package root at an unrelated cwd, assert resolved product paths stay in that root, complete policy/IPC handshake and prove missing or corrupted assets fail closed without source or unrestricted fallback.",
        "Make GitHub generation reservation count and ledger consistent: persistence failure is check_runtime_unavailable with zero spawn, a persist-success/spawn-start/pre-report crash prevents same-hash respawn on resume, one distinct evidence-linked correction remains bounded, and legacy count-ledger mismatch blocks for operator action.",
        "Update only directly affected trust-boundary docs and deliver the CR-to-case-to-runner/failure evidence table plus every focused, package, lint, TypeScript and diff gate; do not add product abstractions, UI, ecosystem adapters or sandbox claims."
      ],
      "acceptance": [
        "One injected monotonic scheduler and one run deadline govern all waits and watchdogs; deterministic tests prove cumulative clamps, controller-only abort, descendant kill, active concurrency at most two, no late spawn and slot reuse after faults.",
        "Lease terminal cleanup waits for in-flight heartbeat and removes only matching ownership; old heartbeat/release/recovery cannot touch a replacement owner and no listener, timer, waiter, lease or slot remains after any terminal path.",
        "Every CR1-CR25 stable case id runs through its required real direct, SDK, CLI, auto, GitHub, tool, IPC or installed-package boundary with no helper-forced evidence, constructed runner result, static substitute or source fallback.",
        "CLI success requires exactly one bounded exact-schema protocol/policy/fence-matched frame with valid cross-field result semantics; all fd/control-env and malformed-frame attacks fail closed regardless of child exit code.",
        "The real tarball runs from a temporary consumer installed root and unrelated cwd, loads all runtime transitives and completes handshake; missing assets, policy mismatch or bad frames never resolve from source or fall back unrestricted.",
        "GitHub persistence failure spawns nothing, crash-before-report resume rejects the consumed same hash, distinct correction remains bounded, and reservation count/ledger mismatch fails closed for operator action.",
        "All required gates pass and the latest review has no remaining blocker; no new abstraction scope, UI, ecosystem adapter or OS-sandbox claim is introduced."
      ],
      "validation": [
        "npm run test:worktree-check",
        "npm run test:package-assets",
        "npm run test:studio-sdk-runner",
        "npm run test:studio-dag",
        "npm run test:github-unattended-runner",
        "npm run test:github-unattended",
        "npm run test:github-handler-runtime",
        "npm run test:github-publish-policy",
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "git diff --check"
      ],
      "risks": [
        "A shared scheduler or transition queue can deadlock if abort and deadline paths are not idempotent; deterministic busy-guard and cancelled-waiter tests are mandatory.",
        "Strict cross-field parsing can reject valid results unless producer and consumer share the same exact contract.",
        "Installed-package tests can falsely pass if Node resolves the source checkout; resolved module paths must be asserted inside the temporary consumer root.",
        "Generation dedupe must block consumed identical scripts without blocking the one permitted distinct evidence-linked correction.",
        "Restricted tools remain application controls rather than an OS sandbox."
      ],
      "parallelizable": false,
      "member": "implementer",
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    }
  ],
  "execution": {
    "groups": [
      {
        "id": "policy-runtime",
        "subtaskIds": ["WDP-01", "WDP-02"]
      },
      {
        "id": "consumer-integrations",
        "subtaskIds": ["WDP-03", "WDP-04"]
      },
      {
        "id": "regression-docs",
        "subtaskIds": ["WDP-05", "WDP-06"]
      },
      {
        "id": "review-remediation",
        "subtaskIds": ["WDP-07"]
      },
      {
        "id": "second-review-remediation",
        "subtaskIds": ["WDP-08"]
      },
      {
        "id": "final-review-remediation",
        "subtaskIds": ["WDP-09"]
      },
      {
        "id": "closure-remediation",
        "subtaskIds": ["WDP-10"]
      }
    ]
  }
}
```
