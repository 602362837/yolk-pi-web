# 计划审批书：IMP-002 review 阶段「开始用户验收」CTA

## 当前结论

**改进规划已收敛，材料齐全，等待用户批准。**

本改进是对父任务 Phase 1 决策层的 **最小叠加**：在 `review` 且无未解决改进时，投影并执行 `start_user_acceptance`，进入既有 `user_acceptance`；**不**跳过主任务结果验收，**不**自动 completed；**完整保留** 8 站 rail、quick previews、改进结果验收、主任务验收/归档与 Phase 1 三 CTA。

> 状态要求：改进实例 `imp_5lyxab07`（IMP-002）应进入 / 保持 `waiting_plan_approval`；在用户批准前 **不得** 派 implementer、不得改生产代码。  
> 说明：本项重建已取消的 IMP-001 同一需求；原项未登记 DAG、未改代码。

## 审阅材料

- [Brief](brief.md) — 反馈、证据、非目标  
- [PRD](prd.md) — 范围与验收  
- [UI 与最小原型契约](ui.md)  
- [Design](design.md) — 投影 / 原子 helper / 安全边界  
- [Implement](implement.md) — **schemaVersion 2 DAG（4 项，domain / projection / widget / verify，`maxConcurrency=2`）**  
- [Checks](checks.md)  
- **HTML 原型（可打开交互）**：[studio-widget-start-user-acceptance-prototype.html](studio-widget-start-user-acceptance-prototype.html)

## PRD 摘要

| 做 | 不做 |
| --- | --- |
| `review` + unresolved=0 → 主 CTA「开始用户验收」 | `review` 上直接结果验收 / 一键 completed |
| 显式 PATCH `action=start_user_acceptance` | 放宽 `canAcceptMain` 到 review |
| 进入后复用现有主验收/归档 | 改 8 站 rail、quick preview、Phase 1 三 CTA |
| 保留改进验收后自动 reaccept | Panel/modal 新写入口 |

## Design 摘要

- 新 kind：`start_user_acceptance`  
- 投影 advisory；写路径重验 binding / status=`review` / unresolved=0 / revision CAS  
- 单锁原子 transition，无 plan grant，无 override  
- 决策区确认文案强制区分「进入验收」≠「确认已验收完成」

## Implement 摘要（须登记的机器计划）

1. `SUA-DOMAIN-01` — 类型 + helper（domain）  
2. `SUA-PROJECTION-02` — 投影 + route（projection；可与 03 并行）  
3. `SUA-WIDGET-03` — 浮窗 allowlist + confirm（widget）  
4. `SUA-VERIFY-04` — 测试与文档 barrier（verify）  

完整 JSON 见 [implement.md](implement.md) 中 `ypi-implementation-plan` 代码块。主会话需将其登记为改进实例 `implementationPlan`。

## Checks 摘要

- 投影/写矩阵 + main-accept 不回退  
- 保全 A–F + Phase 1 回归命令全绿  

## 请用户确认

1. 同意只做 `review → user_acceptance` 入口，结果验收仍为第二步。  
2. 同意不扩展 `canAcceptMain` 至 `review`。  
3. 同意最小 UI 证据（决策区场景补丁 + 已交付 HTML）即可。  
4. 批准 DAG 四子任务与 Checks；批准后由主会话迁改进状态并派实现；改进师不实现。

## 判断标记（改进师）

| 标记 | 值 |
| --- | --- |
| 需要 UI 原型？ | **是（最小）** — 已交付 HTML |
| 需要计划审批？ | **是** — 新 action kind / 写路径 / 用户可见行为 |
| 等待澄清？ | **否** |
| 等待材料？ | **否** — plan-review / ui / HTML / DAG 已齐 |
| 等待实现？ | **否** — 停在计划批准门禁 |

---

### Improvement Analysis（给主会话）

- **反馈摘要**：review 无下一步按钮，用户期望「开始用户验收」。  
- **范围与目标**：1 个 server-projected CTA + 原子 transition。  
- **非目标**：跳过 user_acceptance、改 rail/预览/既有验收/Phase1 计划 CTA。  
- **风险与依赖**：文案混淆；与最终改进自动 reaccept 并存需幂等。  
- **建议计划**：按 [implement.md](implement.md) 4 项 DAG；用户批 → 登记 plan → implementing → implementer。
