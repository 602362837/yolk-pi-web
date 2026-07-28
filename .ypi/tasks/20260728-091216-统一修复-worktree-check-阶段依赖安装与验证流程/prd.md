# PRD — WorkTree Check 通用依赖准备与验证

## 1. 目标与背景

Git WorkTree 不继承 ignored/untracked 的依赖产物。当前普通 Studio checker 与 GitHub unattended operator validation 都可能在缺少依赖时直接开始检查，从而把环境未准备好误报为代码失败。

本轮按用户反馈调整方向：**平台不识别 Node/npm/pnpm/Yarn/Bun，也不维护任何语言/包管理器安装 adapter。** Check 阶段由 checker LLM 在可信的平台规则下，读取项目已有文档和配置，识别语言、工具链、依赖清单、锁文件、wrapper 与检查命令；缺依赖时按项目证据执行项目级准备，再执行 checks。平台只负责固定 WorkTree、可信规则注入、受限命令执行、超时/取消、进度、审计与失败归类。

## 2. 用户价值

- 任意语言/构建系统都可沿用项目自己的安装与验证约定，不等待平台增加 adapter。
- 新 WorkTree 的环境缺失与真实 lint/test/type-check 失败可区分。
- GitHub unattended 与普通 Studio checker 使用同一套通用 Check 协议和安全边界。
- 安装失败、缺工具、超时、命令被拒绝会形成明确终态，不再被折叠成“无进展”。

## 3. 范围内

1. linked Git WorkTree 的 checker 通用环境发现、项目级依赖准备与 checks。
2. 一个平台拥有的可信 Check 协议，要求 LLM 按“发现 → 准备 → 检查 → 结构化报告”执行。
3. 一个语言无关的受限 WorkTree command executor；由 LLM选择 argv，平台不推断 package manager。
4. GitHub unattended checking 中真实运行 checker member，成功后再运行 operator-owned validation commands。
5. 普通 Studio checker 的 SDK、CLI、auto runner 使用等价的受限工具与策略。
6. WorkTree checker lease、命令/时间/重试预算、超时取消、进程树终止、Git mutation 检测和安全投影。
7. 稳定失败原因、结构化 evidence、focused regression 与运维文档。

## 4. 范围外

- 平台内置语言、manifest、lockfile 或 package-manager 识别表。
- 平台拼装 npm/pnpm/Yarn/Bun/Python/Rust/Go/Java 等安装命令。
- WorkTree 创建时自动安装，或主工作树/普通非 checker session 自动准备。
- 复制、硬链或符号链接主工作树依赖目录。
- 自动生成/重写 dependency manifest、lockfile、toolchain config。
- 自动安装系统级工具、提权、修改全局用户配置或启动宿主服务。
- 由 Issue/comment/task/prompt 提供或覆盖 install policy、命令权限、cwd、env、timeout、attempt budget 或 operator validation commands。
- 新 UI 卡片、日志查看器、重试按钮或 Settings 策略页。
- 把应用级 command guard、WorkTree 或 final diff gate描述为 OS sandbox。

## 5. 需求与验收标准

### R1 — 通用 Check 协议，不做生态 adapter

平台向 checker 注入固定、版本化的可信协议：

1. 先读取 WorkTree 内项目说明、贡献指南、CI/workflow、构建配置与工具链配置；
2. 识别项目语言/工具链、依赖清单、锁文件/wrapper、已有依赖状态和项目规定的 checks；
3. 只在证据充分时选择项目级、可重复的依赖准备命令；
4. 准备成功后执行相关 checks；
5. 通过专用结构化报告工具提交 verdict 与平台已观察到的 command ids。

**验收：** 产品代码中没有 package-manager/lockfile 枚举或 install argv 表；不同生态 fixture 能通过同一协议执行各自项目提供的 wrapper/命令。

### R2 — 策略权威不可由 Issue/task 改写

可信协议、命令限制和预算必须来自 server-owned code/version。Issue/comment/task/artifact 只能提供需求范围和验收目标；其中出现的“改用某安装命令”“关闭限制”“提高 timeout”“执行全局安装”等不得改变策略。

项目文档/配置可作为 LLM选择项目命令的证据，但仍受 command executor 硬限制。GitHub operator validation commands继续只来自 operator config。

**验收：** 注入 fixture 无法改变 cwd、env、工具 allowlist、attempt/time budget、GitHub validationCommands 或结构化报告门禁。

### R3 — 发现必须先于安装

checker 必须先收集 bounded evidence，至少说明：

- 项目声明的语言/构建入口；
- dependency manifest/lock/toolchain wrapper 是否存在；
- 项目文档/CI要求的准备与检查方式；
- 所需 executable 是否可用；
- 是否已有可运行依赖环境。

平台不判断这些文件的语义，只记录发现阶段与命令 evidence。证据冲突、文档缺失或缺少关键工具时，checker 应阻塞而不是猜测普通 install。

**验收：** 未产生发现 evidence 就进入 prepare 会被拒绝；缺系统工具得到 `check_dependency_tool_missing`，不会尝试 sudo/global install。

### R4 — 语言无关的受限命令执行

checker 不使用 unrestricted bash，而使用 server-owned `worktree_check_exec`（暂名）：

- 输入为 `purpose=probe|prepare|check`、executable、argv、可选 WorkTree-relative cwd；
- `shell:false`，不接受 command string、env、stdin script、后台执行或调用方 timeout；
- cwd canonical 后必须位于固定 WorkTree；相对 executable 必须解析到 WorkTree 内普通文件，bare executable 仅从 server-owned PATH解析；拒绝绝对 executable path；
- 平台固定 env profile、timeout、输出上限、进程组终止与审计字段；
- 禁止 shell/inline-eval 逃逸、提权、系统/全局配置、服务管理、远程登录、任意下载后执行、Git发布/历史破坏以及写出 WorkTree 的显式 path 参数；
- read/find/grep/ls/edit/write 同样做 WorkTree containment；checker 不加载项目自定义 extension/skill 来替换这些工具。

**验收：** SDK/CLI 两条路径工具集一致；blocked command不启动进程并返回 `check_command_rejected`。

### R5 — 允许与禁止的准备权限

允许：项目文档/配置明确支持、作用于当前 WorkTree 的 dependency restore/install/bootstrap；项目内 wrapper；包管理器自身普通内容缓存；为 checks生成 ignored build/dependency产物。

禁止：sudo/doas/su、宿主 OS package manager、global/user-wide install、修改 shell profile/credential store/daemon、Docker/SSH远程执行、curl|sh 类下载执行、Git commit/push/reset/clean、复制主工作树依赖、修改 manifest/lock/toolchain config 来“绕过”准备失败。

缺失工具若可由仓库自带 wrapper或已声明的 project-local bootstrap安全提供，可继续；否则必须报告 operator action。

**验收：** system/global install fixture fail closed；project wrapper fixture可执行；prepare新增 tracked/unignored source/config变化时 `check_dependency_prepare_mutated_sources`，不自动 revert。

### R6 — 有界尝试，禁止无限安装

推荐默认预算：

- discovery/probe：最多 20 次 command calls、累计 3 分钟；
- prepare：最多 2 次（第一次 + 基于明确错误证据的一次纠正），累计 15 分钟；相同 argv 不得重复；
- check：每条最多 10 分钟，整个 checker run最多 30 分钟；
- 同 WorkTree 同时最多一个 active checker execution；不同 WorkTree 受进程 semaphore（建议 2）限制。

LLM文本输出、重复读文件或“仍在思考”不会重置 command/时间预算。已启动 prepare 的 non-zero/timeout 不做后台无限自动重试；只有**命令尚未启动**的 lease/runtime瞬态错误可 bounded auto retry。

**验收：** attempt/time/call budget达到后得到稳定终态；重启/同 generation retry不会把 GitHub prepare attempt计数清零。

### R7 — 平台观察证据优先于 LLM自报

checker 最终必须调用 `submit_check_report`（暂名），引用已观察的 probe/prepare/check command ids，并声明环境状态、checks、verdict和阻塞类别。平台做交叉校验：

- 失败/超时/被拒绝的 prepare 会 latch failure；自由文本不能覆盖；
- 只有后续允许的一次成功prepare且相关 checks有成功证据时才能恢复；
- report缺失、引用未知 command、把失败命令报为通过，均为 `check_report_missing|inconsistent`；
- operator validation 与 final diff evidence 仍由 server记录，LLM不能写 completion evidence。

**验收：** “安装失败但assistant回复Pass”不能形成 checkerPassed/validationPassed。

### R8 — 明确状态，禁止伪装为无进展

平台按工具调用事实投影固定安全状态：`discovering_project`、`preparing_dependencies`、`running_checks`、`reporting`。命令运行期间由平台 heartbeat；超时由 watchdog终止并直接归类。若 discovery耗尽、prepare失败后没有合法纠正、或长时间没有可接受 evidence，终态必须使用具体 `check_*` reason，而不是 generic `runner_no_progress`。

**验收：** install command开始、结束、失败、超时、取消、attempt limit和无 report均有 deterministic reason；进度只来自平台事件，不信任 assistant文案。

### R9 — WorkTree、取消与隐私

- 启动和每次 command前重验 linked WorkTree/canonical path；固定 cwd不能切到主工作树或外部目录。
- prepare command前后比较 Git status；不自动 reset用户/agent改动。
- timeout/AbortSignal终止完整进程树；取消后不能继续 checks。
- 安全投影只含 phase、purpose、commandId/hash、duration、exit/timedOut/rejected、attempt count与 reason；不含 argv、cwd、stdout/stderr、URL、env或token。
- GitHub checker与 validation都使用 scrubbed automation env；普通 Studio使用server-owned继承 profile，不接受prompt提供env。

**验收：** path escape、orphan process、secret output和Git mutation fixtures fail safe。

### R10 — GitHub unattended checking

GitHub `checking` 拆为 durable `checker` 与 `operator_validation` 两步：

1. server以 `member=checker`、可信Check协议和同一受限工具运行真实checker；Issue excerpt保持untrusted data；
2. checker report/evidence通过后，才运行现有 operator-owned validation broker；
3. 两者都通过后才进入 final policy/publish。

prepare/check失败保留同 generation/WorkTree/task。命令已启动后的安装失败默认 operator block；仅 lease/runtime command-not-started瞬态可 bounded `retry_due`。

**验收：** checker失败时 validation command执行0次；completionEvidence不得提前写 `checkerPassed=true`；resume不会重复无限安装。

### R11 — 普通 Studio checker

所有 workflow的 `member=checker`，无论 SDK/CLI/auto，都使用可信协议、受限工具、budgets和report gate。async run先返回 run id，既有 progress字段展示固定状态；sync等待终态。auto fallback只有在两条 runner都能提供**等价限制**时才允许，不能回退到 unrestricted bash。

非 checker成员不启用本协议；主工作树 checker仍可执行通用检查，但不做 WorkTree-specific lease假设，是否允许prepare由推荐决策D2确认。

**验收：** SDK/CLI/auto等价；prepare/report失败不能被fallback绕过；review-only/improvement checker同样覆盖。

### R12 — 非回归与残余风险

- Studio approval/DAG/child audit/session行为不变；不修改WorkTree创建API。
- GitHub validation command authority、secret scrub、same-generation recovery与publisher边界不变。
- 应用级 argv/path gate不是host sandbox。项目级 dependency install可能执行仓库代码、访问网络并产生同用户side effects；GitHub unattended仍应运行在低权限账号/容器中。

**验收：** focused suites、lint、tsc通过；文档不宣称完整sandbox。

## 6. 稳定失败类别

| 类别 | 建议 reason code | 默认处理 |
| --- | --- | --- |
| 发现不足 | `check_dependency_discovery_inconclusive` | operator_after_change |
| 缺宿主工具 | `check_dependency_tool_missing` | operator |
| 命令被策略拒绝 | `check_command_rejected` | operator |
| 准备非零 | `check_dependency_prepare_failed` | operator，不自动重跑scripts |
| 准备超时/取消 | `check_dependency_prepare_timeout` / `check_cancelled` | operator / external |
| 尝试耗尽 | `check_dependency_prepare_attempt_limit` | operator |
| prepare污染Git | `check_dependency_prepare_mutated_sources` | operator_after_change |
| 检查失败/超时 | `check_validation_failed` / `check_validation_timeout` | operator_after_change / operator |
| report缺失/矛盾 | `check_report_missing` / `check_report_inconsistent` | operator |
| lease/runtime且命令未启动 | `check_runtime_unavailable` / `check_execution_lease_timeout` | bounded automatic |

## 7. 未决/审批决策

| 决策 | 推荐默认 | 影响 |
| --- | --- | --- |
| D1 通用策略 | 采用LLM识别项目证据；平台不做生态adapter | 满足用户反馈，泛化到任意语言 |
| D2 prepare适用范围 | linked WorkTree checker允许；主工作树checker只检查、不自动prepare | 避免普通主空间意外安装 |
| D3 命令能力 | checker禁用unrestricted bash，统一使用受限argv tool；CLI无法等价时fail closed | 真正保证策略不被prompt绕过 |
| D4 网络与脚本 | 允许项目级安装按工具自身行为访问网络/执行项目脚本；禁止注入secret与host/global变更 | 保持可用性但明确非sandbox |
| D5 预算 | probe 20/3m，prepare 2/15m，command check 10m，run 30m，跨WT并发2 | 防无限安装/无进展 |
| D6 UI | 不新增专用UI，仅复用现有progress/reason | 无HTML原型门禁；若新增布局/按钮需重新审批 |
