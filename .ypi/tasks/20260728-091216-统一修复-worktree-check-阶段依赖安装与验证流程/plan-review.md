# Plan Review — 通用 WorkTree Check 依赖准备与验证

> 状态：**已按用户反馈重做规划；等待主会话/用户审批，尚未实现代码。**

## 1. 本轮修订结论

原方案由平台识别Node/npm/pnpm/Yarn/Bun并执行固定install adapter，现已废弃。新方案是：

- checker LLM读取项目已有docs、CI、构建配置、dependency manifest/lock/toolchain wrapper；
- LLM按项目证据选择项目级依赖准备方式，再执行checks；
- 平台完全不维护语言/包管理器识别表和install argv；
- 平台只提供trusted Check policy、固定WorkTree、受限argv工具、timeout/cancel、lease/budget、状态、evidence reconciliation和失败归类；
- Issue/task只能提供scope/acceptance，不能改变权限、cwd、env、timeout、attempt或GitHub validationCommands。

## 2. 审阅入口

- [Brief：原问题、现状证据与修订方向](brief.md)
- [PRD：通用R1–R12、权限与D1–D6](prd.md)
- [UI：不新增专用UI](ui.md)
- [Design：trusted policy、generic executor、anti-spin与durable checking](design.md)
- [Implement：WDP-01…06 DAG + machine plan](implement.md)
- [Checks：通用性/权限/evidence/GitHub/Studio矩阵](checks.md)

## 3. PRD 摘要

Check协议固定为：

```text
read repository evidence
  → identify language/toolchain/manifests/locks/wrappers/checks
  → probe missing tools
  → optional project-local prepare (max 2, 15m cumulative)
  → checks
  → submit structured report referencing observed command ids
```

平台不判断生态语义。证据冲突、缺宿主工具、需要sudo/global install、无确定项目约定时fail closed。

关键要求：

- unrestricted bash不提供给checker；SDK/CLI只暴露scoped file tools、`worktree_check_exec`和`submit_check_report`。
- executor使用argv + `shell:false`、WorkTree-relative cwd、server env/timeout；禁止提权/system/global/service/remote/download-execute/Git mutation/path escape。
- started prepare failure不automatic retry；同一run最多一次有新证据的纠正，GitHub generation重启也不重置attempt。
- 平台command ledger与report reconciliation胜过assistant自由文本；“安装失败但回复Pass”不能通过。

## 4. Design 摘要

新增建议边界：

- `lib/worktree-check-policy.ts`：trusted protocol、limits/reasons、report schema/reconciliation。
- `lib/worktree-check-execution.ts`：WorkTree lease、generic exec、budget/watchdog、Git mutation、safe evidence。
- `lib/worktree-check-extension.ts`：SDK custom tools与server-owned CLI extension共享adapter。

Studio SDK/CLI/auto必须能力等价；CLI用Pi的`--no-builtin-tools --no-extensions --no-skills --no-prompt-templates --no-context-files`、server-owned`-e` extension和`--tools` allowlist。restricted profile不可用时fail closed，不能退回普通bash。

GitHub checking改为durable两步：

```text
checker member + reconciled report
  → operator-owned validation broker
  → final diff/publish
```

resume持久化checker report/run和generation内prepare attempts，避免崩溃后重复安装。

## 5. 如何防无限安装和“伪无进展”

- probe最多20次/3分钟；prepare最多2次/15分钟；check每条10分钟；run总计30分钟；跨WorkTree并发建议2。
- 第二次prepare必须引用第一次失败command id，argv hash必须不同；第三次直接`check_dependency_prepare_attempt_limit`。
- LLM输出、重复read、heartbeat不会延长wall deadline。
- command开始/结束/超时/取消由controller持久化；失败latch不能被assistant文字覆盖。
- report缺失/引用未知id/把失败报成功分别得到`check_report_missing|inconsistent`。
- 已有prepare失败时，即使agent之后只聊天或idle，终态仍保留具体`check_dependency_*`，不折叠成`runner_no_progress`。
- 只有command尚未启动的lease/runtime瞬态可bounded auto retry；已执行项目scripts后的失败默认operator block。

## 6. 命令与权限边界

### 允许

- 读取WorkTree内项目文档/config/CI/manifests/locks/wrappers；
- probe bare executable或WorkTree wrapper；
- 项目文档明确的project-local dependency restore/install/bootstrap；
- 项目checks；
- ignored dependency/build outputs与工具普通content cache。

### 拒绝

- shell string/inline eval/stdin script/background/env注入；
- absolute executable/cwd/path escape；
- sudo/doas/su、system package install、global/user config、service/daemon；
- SSH/remote copy、generic downloader后执行；
- Git commit/push/reset/clean/checkout/config；
- 为让prepare通过而改manifest/lock/toolchain config；
- task/Issue指定的install authority、timeout、env、cwd或validationCommands。

重要残余：仓库wrapper/lifecycle script仍可能联网或产生同OS用户副作用；应用guard不是sandbox。GitHub unattended仍需低权限账号/容器。

## 7. Implement 摘要

| ID | 内容 | 并行 |
| --- | --- | --- |
| WDP-01 | trusted generic policy + report contract | 先行 |
| WDP-02 | generic restricted executor + lease/budget/ledger/tools | WDP-01后 |
| WDP-03 | Studio SDK/CLI/auto等价集成 | 与WDP-04并行 |
| WDP-04 | GitHub checker substage + operator validation gate | 与WDP-03并行 |
| WDP-05 | 权限/anti-spin/evidence/privacy跨入口回归 | 集成后 |
| WDP-06 | docs/runbook + focused/lint/tsc | 收尾 |

建议`maxConcurrency=2`。完整machine plan见[implement.md](implement.md)。

## 8. Checks 摘要

重点门禁：

- 多种repo shape经同一executor运行，production source无生态adapter；
- Issue/task/project extension/skill不能改变server policy；
- SDK/CLI active tools和Pi CLI flags完全等价；
- path/shell/eval/privilege/system/global/service/remote/download/Git mutation拒绝；
- attempt/time/lease/restart anti-spin；
- failed install + fake Pass、missing/inconsistent report均fail closed；
- specific dependency failure优先于generic no-progress；
- GitHub真实checker→operator validation→final evidence顺序；
- safe events/task projection无argv/cwd/output/env/URL/token；
- focused suites、lint、tsc。

## 9. UI 门禁

仍不新增页面、组件、交互、布局、按钮或日志查看器；只复用既有run progress/reason字段显示固定状态，所以本轮不要求HTML原型。

若实现新增专用依赖进度卡、日志面板、重试按钮、权限确认或Settings策略，必须停止实现、派UI设计员产出HTML原型并先请用户审批。

## 10. 需要审批的决策

请确认以下推荐默认：

1. **D1：采用通用LLM-driven Check，平台不做任何生态adapter。**
2. **D2：自动prepare仅用于linked WorkTree checker；主工作树checker只discover/check。**
3. **D3：checker禁用unrestricted bash；SDK/CLI必须走等价受限工具，无法加载时fail closed。**
4. **D4：允许项目级安装按工具自身行为联网/执行项目scripts，但禁止secret注入和system/global mutation；明确非sandbox。**
5. **D5：采用20 probes/3m、2 prepares/15m、10m per check、30m run、跨WorkTree并发2。**
6. **D6：本轮不新增专用UI。**

额外部署决策：若GitHub unattended生产环境不能提供dedicated低权限账号/容器，是否仍接受现有full-agent residual risk；本任务不能用应用层regex替代OS sandbox。

## 11. 审批后动作

主会话应：

1. 从[implement.md](implement.md)保存最新fenced `json ypi-implementation-plan`，不要保存旧Node planner计划；
2. 用户明确批准D1–D6和unattended残余风险后，才切到implementing；
3. 先WDP-01，再WDP-02；随后最多并行WDP-03/WDP-04；
4. WDP-05/WDP-06完成后派checker做全局门禁。

未获批准前不得修改生产代码。
