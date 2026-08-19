# 计划审批书（checker remediation 修订版）— custom OpenAI provider/model 未进入选择器

> **当前建议状态：** `changes_requested` → 保存9项修订计划 → `awaiting_approval`。用户批准 remediation 前不继续实现。

## Checker 请求修改（本次增量）

原 MCR-01…06 已完成实现，但 checker 判定 `Needs work`，有两个 blocker：

1. `scripts/test-session-model-pin.mjs` 仍只有pure helper测试，没有实际执行 existing `AgentSessionWrapper` 的config reload、`set_model`一次exact retry及side-effect计数；handoff中的源码契约不能替代R9/R10行为证据；
2. `lib/models-config-sync.ts` 在unified commit coordinator动态import失败时，可能仅凭注入的live reload stub返回`runtimeReload:"ok"`，未证明admin generation/catalog epoch已完成，违反R11 truthful freshness。

本次不改变PRD/UI/API产品范围，只补行为测试并收紧既有sync状态语义：notifier/import失败时durable write保留，但固定返回`partial` + 既有warning；只有完整commit notifier成功且`live.failed===0`才允许`ok`。

## 用户补充现象

- 新建会话后新增模型仍不出现；
- 新增整个 OpenAI-compatible custom provider 后，整个 provider 也不出现。

## 修订结论

原先“仅 runtime 热重载”是**已证实主根因的一部分，但不足以作为完整修复**。

### 已证实主根因

`models.json` commit后只推进catalog epoch；cached admin `ModelRuntime.refresh()`不重读配置，所以既看不到新增model，也看不到新增provider。

“新会话仍看不到”不构成反证：新会话选择器继续消费全局`useModelCatalog -> /api/models -> admin runtime`，不是新session runtime。隔离实测：

```json
{
  "afterEpochOnlyBeta": false,
  "freshSessionRuntimeBeta": true,
  "freshSessionAvailableBeta": true,
  "afterAdminReloadBeta": true
}
```

### 新发现的第二缺陷

Direct PUT没有Pi语义验证；Pi可通过`runtime.getError()`报告schema/composition失败而不抛异常。当前`/api/models`又忽略该error并返回200 partial/empty，造成“保存成功但provider消失”且browser覆盖last-good。

实测缺少baseUrl的provider：

```json
{
  "putStatus": 200,
  "putSuccess": true,
  "runtimeHasError": true,
  "runtimeHasBroken": false,
  "catalogStatus": 200,
  "catalogHasBroken": false
}
```

### 必须保留的SDK规则

Custom provider不需要Web手工`registerProvider()`；它由`models.json -> ModelConfig -> composeModelProvider`加载。只有fixed extensions需要注册。

选择器投影`getAvailableSnapshot()`：无key、missing env或无stored auth时，provider/model即使已loaded也不会出现在选择器。这是Pi 0.80.10规则，不应绕过。

## 推荐方案

1. Direct PUT写盘前使用private temp `modelsPath` + fresh fixed-provider runtime离线验证完整候选；semantic invalid固定422且no-write；
2. Successful commit推进定向admin runtime config generation，阻止old pending回填；
3. `/api/models`遇到`runtime.getError()`返回既有500 safe code，让browser保留last-good；
4. Existing live session执行`reloadConfig()`与exact descriptor replacement；`set_model` miss一次exact retry；
5. Direct/sync/price writers统一success-only commit notification；
6. 测试覆盖append model、whole provider、新会话共享catalog、auth controls、false-success、race/error degradation；
7. Remediation以actual wrapper补齐existing-session reload、一次exact retry与side-effect计数；
8. Sync完整commit notifier import/执行失败时固定`partial`，不允许live-only fallback假报`ok`。

## 产物

| 产物 | 链接 | 修订内容 |
| --- | --- | --- |
| Brief | [brief.md](brief.md) | 两缺陷+auth规则+新会话解释+实测 |
| PRD | [prd.md](prd.md) | R1–R12，新增whole provider/semantic validation/error degrade |
| UI | [ui.md](ui.md) | 无前端生产变化，不触发原型 |
| Design | [design.md](design.md) | candidate validity/admin generation/catalog health/session convergence |
| Implement | [implement.md](implement.md) | 保留MCR-01…06，新增MCR-07…09 remediation DAG |
| Checks | [checks.md](checks.md) | 增加actual wrapper行为与sync import-failure真值门禁 |

## Revised Implementation Plan

| ID | 标题 | 依赖 | 并行 |
| --- | --- | --- | --- |
| MCR-01 | 完整custom provider/model失败回归 | — | 先做 |
| MCR-02 | Direct candidate语义验证 | MCR-01 | 与MCR-03并行 |
| MCR-03 | Admin generation + catalog fail-closed | MCR-01 | 与MCR-02并行 |
| MCR-04 | Live reloadConfig + set_model self-heal | MCR-01,02,03 | 串行 |
| MCR-05 | 三writer统一commit notification | MCR-02,03,04 | 串行 |
| MCR-06 | 全量验证与文档 | MCR-05 | 已完成，checker请求补证据 |
| MCR-07 | Existing session / exact retry / side-effect行为回归 | MCR-06 | 与MCR-08并行 |
| MCR-08 | Sync coordinator import-failure真值修复 | MCR-06 | 与MCR-07并行 |
| MCR-09 | Blocker复验、price证据、最终交接 | MCR-07,08 | 串行收尾 |

建议`maxConcurrency=2`。主会话需保存[implement.md](implement.md)中的9项机器计划：保留前6项稳定ID/完成历史，将MCR-07与MCR-08作为remediation ready batch，最后执行MCR-09。

## UI门禁

不改页面、组件、信息结构或前端交互代码。Invalid save复用现有footer `saveError`，catalog error复用现有last-good/error状态；**无需ui-designer/HTML原型**。

若实现需要新增warning、toast、banner、auth说明或手动reload，必须退回planning并重开UI门禁。

## 请审批的决策

| # | 推荐决策 | 理由 |
| --- | --- | --- |
| Q1 | 批准“两缺陷”系统修复，不只加`reloadConfig` | 否则无效配置仍可假成功/清空catalog |
| Q2 | 完整覆盖append model与whole provider | 两者共享config freshness，但必须各自验收 |
| Q3 | 无auth provider继续不进入selector | 保持Pi available规则 |
| Q4 | Direct semantic invalid返回固定422并no-write | 成功必须表示Pi可加载；复用现有错误槽 |
| Q5 | runtime error时catalog 500、browser last-good | 禁止200 partial/empty覆盖好数据 |
| Q6 | 外部编辑自动推送/跨进程广播继续范围外 | 当前正确性边界是app writers；另立需求 |
| Q7 | 不改UI | 当前前端无过滤缺陷 |
| Q8 | Actual wrapper行为测试是R9/R10硬门禁 | 源码contract不能证明retry次数或副作用 |
| Q9 | Sync notifier/import失败固定`partial`，live-only stub不能给`ok` | `ok`必须证明admin generation、catalog epoch与live summary都成功 |

## 验证门槛

- whole-provider warm regression修复前失败、修复后通过；
- fresh session runtime与shared selector双断言；
- no-auth/missing-env/literal/stored controls；
- semantic invalid 422 no-write；
- old generation race；
- runtime error 500 + browser last-good；
- actual existing wrapper exact切换：首次miss只reload/retry一次，unknown保持原错；
- config reload/reconcile无`setModel`/`model_change`/default副作用；成功`set_model`仅允许正常的一次`model_change`且default writes=0；
- sync notifier import/reject时即便live stub为ok也必须partial；只有完整notifier成功且live.failed=0可ok；
- direct/sync/price success-only，并给出price专项证据；
- fixed provider、offline/privacy、performance；
- lint + tsc + U1–U5。

## 风险与回滚

主要风险：candidate temp secret处理、old pending回填、fixed provider重建、live active-turn竞态、runtime error过度降级、sync假ok，以及wrapper测试registry/timer污染。均已进入设计和检查门禁。

无迁移；代码回滚即可。合法已保存配置保留；回滚后临时恢复方式仍是重启服务。

## 审批操作

请主会话：

1. 保存[implement.md](implement.md)中的9项`ypi-implementation-plan`，保留MCR-01…06完成状态，新增MCR-07…09；
2. 进入`awaiting_approval`；
3. 用户确认后并行派MCR-07/MCR-08，二者通过后派MCR-09，随后重新checker。

批准示例：

```text
确认 remediation：补actual existing-session行为测试；sync完整commit notifier失败时只返回partial，不改UI。按MCR-07…09执行并重新检查。
```

修改示例：

```text
需要调整：……
```
