# Design — LLM 驱动的通用 WorkTree Check 执行边界

## 1. 方案摘要

本方案删除原规划中的 manager/lock planner、固定 install adapter、fingerprint/stamp与`node_modules`假设，改为三个语言无关边界：

1. `lib/worktree-check-policy.ts`（建议名）：可信Check协议、固定limits、reason codes、结构化report schema/parser与evidence reconciliation。
2. `lib/worktree-check-execution.ts`（建议名）：WorkTree-scoped lease/controller、受限argv执行、timeout/cancel/process tree、Git mutation snapshot、command ledger与安全projection。
3. checker runner adapter：SDK以custom tools/extra extension注入；CLI以`--no-builtin-tools --no-extensions --no-skills --no-prompt-templates --no-context-files`加server-owned `-e` extension与tool allowlist启动。两者都只暴露受控filesystem tools、`worktree_check_exec`和`submit_check_report`。

平台不识别语言、manifest、lockfile和package manager。LLM从项目已有文件得出选择；平台只验证执行能力和证据，不验证生态语义。

```text
fixed WorkTree
  → trusted checker system policy (server-owned, after untrusted task data)
  → LLM reads project docs/config as data
  → probe via guarded argv tool
  → optional project-local prepare via same tool (budgeted)
  → checks via same tool
  → submit_check_report(command ids)
  → platform reconciles observed evidence
  → ordinary Studio verdict OR GitHub operator validation
```

## 2. AS-IS 与问题

### 普通 Studio

- `buildMemberPrompt()`把member definition、task artifacts、implementation plan、knowledge和delegated prompt拼入一次child prompt。
- SDK/CLI checker拥有普通file/bash能力；default checker只要求“运行验证”，没有环境发现协议或安装预算。
- SDK `toolEnv`可替换bash env；CLI走独立Pi进程，当前没有等价command guard。
- child progress能看到tool events，但不能区分dependency preparation与checks，也不校验最终Pass是否有命令证据。

### GitHub unattended

- implementer完成后直接进入`runGithubValidationBroker()`；没有真实checker member。
- validation broker命令仅由operator config决定，`shell:false`且scrub env，这一authority必须保留。
- completion evidence后续直接记录`checkerPassed=true`，缺少checker执行证据。
- full-agent明确不是sandbox；WorkTree/final diff不能阻止宿主副作用。

## 3. Trust / authority model

按优先级分层：

1. **Server policy authority**：tool allowlist、cwd、env profile、budgets、timeout、attempt/retry、reason mapping、report validation。只来自产品代码。
2. **Operator authority**：GitHub `validationCommands`、automation policy、publish target。仍不接受Issue/task覆盖。
3. **Repository evidence**：README/AGENTS/CONTRIBUTING/CI/build files/wrappers/manifests/locks。LLM可据此选择项目命令，但它们不改变1/2层限制。
4. **Task/Issue data**：需求、范围、验收目标。不得作为安装命令、权限、env、cwd、timeout或validation command authority。

可信policy必须通过system prompt/`before_agent_start` server extension注入，且在加载顺序上晚于普通上下文。仅把文字放在task prompt末尾不是安全边界；真正限制由active tools和executor完成。

Project-local extension/skill/prompt/system context在checker secure profile中不自动执行/注入。checker仍可用scoped read把项目说明作为数据读取；这样既获得项目约定，又不允许仓库资源替换工具或系统策略。

## 4. Checker 通用协议

### 4.1 Discover

LLM先阅读项目材料并形成简短evidence：

- 语言/构建入口和仓库布局；
- dependency manifests、lockfiles、toolchain/version files、workspace/monorepo配置；
- repo wrapper和CI实际命令；
- dependency output是否已经存在/可用；
- executable version probe结果。

平台不解析上述文件。`worktree_check_exec(purpose="probe")`只提供执行事实。若证据冲突，LLM必须报告`discovery_inconclusive`，不能尝试“常见默认命令”。

### 4.2 Prepare

只有以下条件同时满足才可`purpose="prepare"`：

- 命令来自当前WorkTree内已有文档、CI、wrapper或明确toolchain配置；
- 作用域为项目/WorkTree，不要求global/system mutation；
- 不生成或改写manifest/lock/toolchain config；
- executable通过executor policy；
- 未超过2次/15分钟预算。

第一次失败后，第二次必须引用第一条command id和新的错误证据，且argv不能相同。平台不判断“frozen/immutable”语义；LLM应优先项目声明的确定性方式。若项目没有确定说明，阻塞而非猜测。

### 4.3 Check

准备成功或经probe证明不需要准备后，执行项目文档/CI/批准checks对应命令。task checks可说明验证目标，但命令仍需仓库证据或GitHub operator config佐证，不能借task文本绕开tool policy。

### 4.4 Report

LLM必须调用terminating tool `submit_check_report`：

```ts
type CheckReportInput = {
  environment: "ready" | "not_needed" | "blocked";
  verdict: "pass" | "needs_work" | "blocked";
  evidenceSummary: string; // bounded, scrubbed
  probeCommandIds: string[];
  prepareCommandIds: string[];
  checkCommandIds: string[];
  blockerCode?: CheckReasonCode;
};
```

report不能自带command output、path、env、URL或任意reason字符串。`blockerCode`为enum。Tool对ledger做交叉验证，`terminate:true`只在report合法且当前tool batch无其他非terminating结果时结束。

## 5. 受限工具与权限

### 5.1 Active tool profile

checker只启用：

- WorkTree-contained `read/grep/find/ls`；
- WorkTree-contained `edit/write`（保留checker低风险小修复能力；禁止task/runtime/secret paths）；
- `worktree_check_exec`；
- `submit_check_report`。

禁用builtin `bash`、browser/network tools、subagent/Studio orchestration、project-loaded extensions/skills和用户shell。普通成员保持原行为。

### 5.2 `worktree_check_exec`

Input：

```ts
type WorktreeCheckExecInput = {
  purpose: "probe" | "prepare" | "check";
  executable: string;
  args: string[];
  cwd?: string;              // WorkTree-relative only
  retryOfCommandId?: string; // prepare第二次才可用
};
```

Hard rules：

- executable只能是bare PATH name或WorkTree-relative普通可执行文件；拒绝absolute/URL/控制字符。
- `spawn/execFile` argv，`shell:false`；无stdin脚本、无env字段、无caller timeout、无background。
- cwd canonical containment；每次执行前确认WorkTree仍存在且是同一linked WorkTree。
- env由server profile提供：普通Studio继承受控copy；GitHub额外scrub App/machine/token env。Issue/task不能新增env。
- args/数量/长度有界；显式外部absolute path、credential-shaped值、URL userinfo fail closed。
- deny shell/command interpreter eval mode、提权、host service/config、remote login、generic downloader execution和Git mutation/publish。Git只允许只读subcommands。
- project wrapper可以运行；其内部行为仍是仓库代码，不能被应用层完全证明安全。
- 输出tail bounded，完整输出不进入task/job/event/browser；tool result给LLM的diagnostic也限长并做credential/path redaction。

禁止命令类别应以能力规则+小型high-risk deny set实现，而不是package-manager allowlist。不要为了“通用”而声称可静态判断任意binary副作用。

### 5.3 Filesystem与sandbox边界

scoped file tools可硬性阻止路径escape。受限exec可阻止明显命令/参数escape，但任意项目wrapper或lifecycle script仍可能读写同OS用户可访问路径、联网或spawn子进程。因此：

- GitHub unattended继续要求dedicated low-privilege account/container/network policy；
- secret env scrub不是磁盘secret隔离；
- 若产品要求“绝不写出WorkTree”，必须另立OS sandbox任务，不能在本任务用regex伪装完成。

## 6. Controller、预算与lease

### 6.1 状态机

```text
created
 → discovering_project
 → preparing_dependencies? (0..2 commands)
 → running_checks
 → reporting
 → passed | needs_work | blocked | cancelled
```

规则：

- `prepare`前必须有项目文件读取和成功probe evidence；
- `check`前不能有unresolved prepare failure；
- prepare failure被latch；只有合法第二次prepare成功可进入check；
- report必须引用ledger中的ids；platform observation胜过LLM文字。

### 6.2 Budgets

| 项目 | 推荐默认 |
| --- | --- |
| probe calls / duration | 20 / 3m cumulative |
| prepare attempts / duration | 2 / 15m cumulative |
| check per command | 10m |
| checker total | 30m |
| output | tool result tail 32KiB；safe projection无raw output |
| different WorkTree concurrency | 2 |

LLM message/token activity、重复read和tool update不会延长wall deadline。Command运行时controller heartbeat显示正在执行，但heartbeat不重置deadline。

### 6.3 WorkTree lease

- canonical pathKey hash作为key；同进程single-flight + agentDir mkdir owner lease。
- lease只防同WorkTree多个checker同时准备/检查，不缓存依赖、不存生态fingerprint。
- owner含pid/token/runIdHash/heartbeat；live PID不偷，dead stale可recover，token-safe release。
- GitHub在durable state记录generation内`prepareAttemptsUsed`和已完成check stage；process restart/retry不能重置安装预算。
- ordinary Studio已有active checker guard仍保留，WorkTree lease覆盖跨task/跨process冲突。

## 7. Git mutation与evidence ledger

每条prepare前后捕获`git status --porcelain=v1 -z --untracked-files=all`的bounded hash/set：

- baseline已有实现diff允许保持；
- 新增tracked/unignored source/config/lock变化→`check_dependency_prepare_mutated_sources`；
- ignored dependency/build output不进入Git status，可正常继续；
- 不自动reset/checkout/clean。

Command ledger仅server-side bounded记录：

```ts
type CheckCommandEvidence = {
  id: string;
  purpose: "probe" | "prepare" | "check";
  commandHash: string;
  executableLabel: string; // sanitized basename/"workspace-wrapper"
  startedAt: string;
  durationMs: number;
  exitCode: number | null;
  timedOut: boolean;
  cancelled: boolean;
  rejected: boolean;
  reasonCode: CheckReasonCode | null;
};
```

GitHub safe event不含`executableLabel`也可，只保留purpose/count/duration/exit flags/reason。Raw argv/output仅存在child audit/tool context的bounded内容时也必须redact；不能写automation event/task summary。

## 8. 无进展与失败归类

### 8.1 不信任assistant progress

进度来自controller/tool lifecycle：

- accepted tool call立即更新phase/command id；
- process定时heartbeat；
- timeout/abort直接终止进程树并持久化reason；
- final assistant文本不能把failed run改成succeeded。

### 8.2 Anti-spin

- 相同prepare argv hash第二次拒绝；第三次prepare永远拒绝。
- prepare失败后只允许一次带`retryOfCommandId`的纠正；其余tool calls不清除latch。
- discovery call/time上限后未形成可执行结论→`check_dependency_discovery_inconclusive`。
- prepare失败后agent继续闲聊/读文件直到deadline→保留具体prepare reason，不降级`runner_no_progress`。
- report未提交→`check_report_missing`；report矛盾→`check_report_inconsistent`。
- 命令**已启动**后的失败/timeout不自动重新运行；只有lease/runtime launch前错误可bounded retry。

## 9. Runner 集成

### 9.1 Studio SDK

- `buildMemberPrompt()`对`member=checker`附加server policy id/summary；真正system policy由checker extension的`before_agent_start`注入。
- `runYpiStudioSdkChildSession()`接收checker execution profile；exclude unrestricted tools，提供scoped customTools和report tool。
- progress复用现有`phase/currentTool/lastTextPreview/warnings/terminationReason`，固定映射discover/prepare/check/report，不新增UI层级。
- controller final result覆写不可信child success：evidence/report不满足则run=`failed|cancelled`并使用具体terminationReason。

### 9.2 Studio CLI / auto

CLI必须显式：

```text
--no-builtin-tools --no-extensions --no-skills --no-prompt-templates --no-context-files
-e <server-owned-check-extension>
--tools read,grep,find,ls,edit,write,worktree_check_exec,submit_check_report
```

extension路径来自已发布应用资产，不来自WorkTree/task。auto fallback仅在trusted extension加载成功且policy version一致时发生；否则`check_runner_policy_unavailable` fail closed。不能fallback到当前unrestricted CLI。

### 9.3 GitHub unattended

Durable checking分两步：

```text
checkpoint=checking, checkStage=checker
  → runGithubFullAgentMember(member="checker", checkExecutionProfile)
  → reconcile report/evidence
checkpoint=checking, checkStage=operator_validation
  → runGithubValidationBroker(operator config)
  → awaiting_publish
```

- checker prompt envelope在untrusted Issue block之外增加同一trusted policy id；full agent member必须切到checker restricted tools，不复用implementer unrestricted profile。
- checker blocked时`blockedAtLayer=validation`（可加safe subreason `checker`）；operator validation执行0次。
- successful checker run id/report hash写durable state，resume跳过已完成checker，不重复install。
- only command-not-started transient可以`retry_due`；started prepare失败operator block。
- completion evidence只在checker evidence、operator validation和final diff全通过后写true。

## 10. 结果与 reason contract

```ts
type WorktreeCheckExecutionResult = {
  status: "passed" | "needs_work" | "blocked" | "cancelled";
  reasonCode: CheckReasonCode | null;
  stage: "discover" | "prepare" | "check" | "report" | "complete";
  probeCount: number;
  prepareAttempts: number;
  checkCount: number;
  durationMs: number;
  timedOut: boolean;
  commandStarted: boolean;
  retryability: "automatic_before_command" | "operator_after_change" | "operator" | "external" | "none";
  reportHash: string | null;
  safeMessage: string;
};
```

稳定codes沿用PRD第6节；public projection只使用allowlist。

## 11. 兼容性、迁移与UI

- 无Session JSONL/task schema migration；GitHub runner state新增可选checkStage/attempt evidence，对旧state默认`checker`。
- 无dependency stamp/cache sidecar；只新增ephemeral/bounded check lease与ledger，terminal后可清理。
- WorkTree创建API、validationCommands配置、普通member行为不变。
- UI仅显示既有progress/reason字段的固定文案，不新增组件/布局/按钮，因此本轮不触发HTML原型门禁。

## 12. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| LLM选错命令 | 先读repo evidence；最多2次prepare；结构化report；operator validation仍保留 |
| repo docs/prompt injection | 当作data读取；server system policy + hard tool allowlist；禁project extension/skill自动加载 |
| generic tool被用作shell escape | shell=false、无stdin/env、deny shell/eval/privilege/remote/download、path containment |
| wrapper/lifecycle产生宿主副作用 | 明确非sandbox；GitHub低权限容器；secret env scrub；未来OS sandbox另案 |
| 无限安装/重启spin | cumulative budgets、argv hash去重、durable generation attempts、started command不auto retry |
| 安装失败伪装无进展 | controller heartbeat/watchdog、failure latch、report reconciliation、specific reason优先 |
| prepare污染源码/lock | per-command Git delta；block且不auto revert |
| CLI绕过SDK限制 | trusted `-e` extension + no builtins/resources + tool allowlist；加载失败fail closed |
| private dependency需要secret | 不向unattended注入secret；明确`tool_missing/prepare_failed` operator block，不泄露credential |

## 13. 回滚

1. 移除checker execution profile与GitHub checker substage，恢复普通checker工具和operator validation直跑。
2. 保留可选runner state字段/terminal ledger无害；无dependency cache或manifest需要迁移。
3. 不删除WorkTree、依赖目录、package cache、Session、task或用户改动。
4. 回滚不能以复制主工作树依赖或放开unrestricted unattended bash替代。
