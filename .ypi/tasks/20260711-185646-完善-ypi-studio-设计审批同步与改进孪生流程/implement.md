# Implement - 第三版改进流程

## 先阅读

- `AGENTS.md`、`docs/standards/code-style.md`、`docs/modules/{api,frontend,library}.md`、`docs/architecture/overview.md`
- `lib/ypi-studio-{types,tasks,workflows,agents,policy,extension,session-link}.ts`
- `lib/pi-web-config.ts`、`components/SettingsConfig.tsx`
- `app/api/studio/tasks/[taskKey]/{route.ts,files/route.ts}`、`components/{YpiStudioPanel,YpiStudioSessionWidget}.tsx`
- `scripts/test-ypi-studio-{dag,policy}.mjs` 和本任务 [design.md](design.md)、[ui.md](ui.md)、[checks.md](checks.md)、[HTML 原型](studio-improvement-flow-v3-prototype.html)

## 执行顺序

| 顺序 | 子任务 | 交付 |
| --- | --- | --- |
| 1 | 成员、设置与流程 contracts | `improver` 默认模板、配置策略、主/改进状态定义 |
| 2 | 改进项存储和主任务汇总 | 主任务下的 instance 目录、锁、reconcile、完成 guard |
| 3 | 改进计划和审批同步 | revision、UI gate、修改回退和材料一致性 |
| 4 | API/tool/session/file 边界 | 受限 instance actions、安全预览、轻量投影 |
| 5 | Panel、Widget、Settings UI | 按批准 HTML 呈现改进流程路径 |
| 6 | 验证、迁移和文档 | 契约测试、故障路径、模块文档与回滚说明 |

## Implementation Plan

| ID | 工作 | 依赖 | 验收 |
| --- | --- | --- | --- |
| member-settings-workflow | 新增 improver 默认成员、模型策略和 user acceptance workflow contracts | 用户批准 | Settings 排序/策略可用，custom 文件不覆盖 |
| improvement-persistence | 写入主任务内的改进项、目录、事件、通知和 reconcile | 1 | 不产生顶层 task，未解决阻止完成 |
| improvement-approval | 为主/改进计划补齐 revision、UI gate 和同步修改 | 1,2 | 旧批准失效，材料不完整不能批准 |
| guarded-integration | route/tool/session/files 接入实例边界 | 2,3 | 绑定/cwd/id/路径全部验证 |
| improvement-ui | 落地浮窗、详情 Tab、Settings 行 | 1,4 | 文案、窄屏、键盘和禁用状态符合原型 |
| verification-docs | 测试故障路径、兼容与文档 | 2-5 | 验证通过或记录无关失败 |

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "summary": "Add main-task-owned improvement flows, an improver member policy, and approval-safe supporting revisions.",
  "strategy": "make the user-visible improvement lifecycle and storage guards work before integrations and UI; retain additive legacy reads",
  "maxConcurrency": 2,
  "subtasks": [
    {"id":"member-settings-workflow","title":"Add improver default member, Settings policy, and improvement-capable workflows","phase":"foundation","order":10,"dependsOn":[],"files":["lib/ypi-studio-agents.ts","lib/pi-web-config.ts","lib/ypi-studio-types.ts","lib/ypi-studio-workflows.ts","components/SettingsConfig.tsx",".ypi/agents/improver.md"],"instructions":["Add improver after architect in all default member arrays/labels/templates","Preserve custom agents and existing model-policy precedence","Add main review/user_acceptance/waiting workflow capability without overwriting custom workflows"],"acceptance":["Settings lists improver with model/thinking controls","Policy resolves improver safely","Default refresh is non-destructive"],"validation":["npm run test:studio-policy","node_modules/.bin/tsc --noEmit"],"risks":["Default arrays drift between config/UI/agent templates"],"parallelizable":false,"localReview":{"required":true,"reviewer":"checker"}},
    {"id":"improvement-persistence","title":"Persist main-owned improvement items and reconcile the parent task","phase":"backend","order":20,"dependsOn":["member-settings-workflow"],"files":["lib/ypi-studio-types.ts","lib/ypi-studio-tasks.ts","scripts/test-ypi-studio-dag.mjs"],"instructions":["Use instance directories beneath one main task","Lock all parent/instance mutations and reconcile after every terminal change","Block complete/archive while any instance is unresolved"],"acceptance":["Instances never become top-level tasks","All resolved instances return parent only to review","Failure/cancellation needs explicit disposition"],"validation":["npm run test:studio-dag"],"risks":["Concurrent final-instance transition"],"parallelizable":false,"localReview":{"required":true,"reviewer":"checker"}},
    {"id":"improvement-approval","title":"Keep plan, prototype, approval book, and grants synchronized","phase":"backend","order":30,"dependsOn":["member-settings-workflow","improvement-persistence"],"files":["lib/ypi-studio-tasks.ts","lib/ypi-studio-extension.ts","scripts/test-ypi-studio-dag.mjs"],"instructions":["Implement revision mutations for main and improvement plans","Require revision-bound UI evidence where UI changes","Invalidate grants on revision and allow safe return for requested changes"],"acceptance":["No partial revision is observable","Only latest explicitly approved revision can implement"],"validation":["npm run test:studio-dag"],"risks":["Legacy approval grant compatibility"],"parallelizable":true,"localReview":{"required":true,"reviewer":"checker"}},
    {"id":"guarded-integration","title":"Expose guarded improvement actions, runs, previews, and projections","phase":"integration","order":40,"dependsOn":["improvement-persistence","improvement-approval"],"files":["app/api/studio/tasks/[taskKey]/route.ts","app/api/studio/tasks/[taskKey]/files/route.ts","lib/ypi-studio-extension.ts","lib/ypi-studio-session-link.ts"],"instructions":["Require parent binding, cwd, ownership and expected state/revision","Scope file resolver to the improvement root","Keep widget/session data bounded"],"acceptance":["Cross-task/context/path access fails","Scoped implementer/checker run requires instance and subtask"],"validation":["npm run lint","node_modules/.bin/tsc --noEmit"],"risks":["API/tool schema divergence"],"parallelizable":false,"localReview":{"required":true,"reviewer":"checker"}},
    {"id":"improvement-ui","title":"Build approved improvement flow UI in panel, widget, and Settings","phase":"frontend","order":50,"dependsOn":["guarded-integration"],"files":["components/YpiStudioPanel.tsx","components/YpiStudioSessionWidget.tsx","components/SettingsConfig.tsx","app/globals.css","docs/modules/frontend.md"],"instructions":["Follow the approved third-version HTML wording and hierarchy","Keep panel actions read-only and route user decisions through bound chat","Add responsive/accessibility states"],"acceptance":["Widget shows count, blocker and next step","Details has improvement list and five detail views","Settings lists improver in fixed order"],"validation":["npm run lint","node_modules/.bin/tsc --noEmit","manual browser checklist"],"risks":["Dense task detail becomes hard to scan"],"parallelizable":false,"localReview":{"required":true,"reviewer":"checker"}},
    {"id":"verification-docs","title":"Verify lifecycle failure paths and document the improvement contract","phase":"verification","order":60,"dependsOn":["improvement-ui"],"files":["scripts/test-ypi-studio-dag.mjs","scripts/test-ypi-studio-policy.mjs","docs/modules/api.md","docs/modules/library.md","docs/modules/frontend.md","docs/architecture/overview.md"],"instructions":["Cover lifecycle, settings policy, security and concurrency cases","Document migration, bounded projections and rollback"],"acceptance":["Checks cover all stated gates","Docs match delivered wire contract"],"validation":["npm run test:studio-policy","npm run test:studio-dag","npm run lint","node_modules/.bin/tsc --noEmit"],"risks":["No automated browser suite"],"parallelizable":false,"localReview":{"required":true,"reviewer":"checker"}}
  ],
  "execution":{"groups":[["member-settings-workflow"],["improvement-persistence","improvement-approval"],["guarded-integration"],["improvement-ui"],["verification-docs"]]}
}
```

## 门禁和回滚

开始前必须取得用户对 [plan-review.md](plan-review.md) 和 [HTML 原型](studio-improvement-flow-v3-prototype.html) 的明确批准，之后主会话才保存该机器计划并安排实现。任何存储原子性、权限或状态机不确定性都停在 blocked，不用 override 绕过。回滚只关闭新增 capability/actions；保留 v2 改进记录只读、审计和显式 disposition 路径。
