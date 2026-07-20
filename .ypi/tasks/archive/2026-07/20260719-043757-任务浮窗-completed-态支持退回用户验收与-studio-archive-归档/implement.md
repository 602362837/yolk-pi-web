# Implement：Completed 退回 User Acc. + Chat `/studio-archive`

## 0. 视觉与行为硬约束

1. **不改**浮窗 CSS/布局/色板；只复用 decision 按钮 class 与 disabled。
2. 归档主路径 **必须** `onComposeSend("/studio-archive…")`；禁止浮窗 silent `allowFallbackKnowledge` archive。
3. 退回必须 **显式** `action=return_to_user_acceptance` + workflow 边 + 清 `completedAt`。
4. 用户批准本 plan 并进入 `implementing` 后才可 claim/dispatch。

## 1. 优先阅读

1. 本任务 [prd.md](prd.md) / [design.md](design.md) / [ui.md](ui.md) / [checks.md](checks.md) / [plan-review.md](plan-review.md)
2. 前序 Hybrid B：`.ypi/tasks/20260718-192856-…/{prd,design,implement}.md`
3. 源码：
   - `lib/ypi-studio-workflows.ts`（`BASE_TRANSITIONS`）
   - `lib/ypi-studio-session-link.ts`（`buildWidgetUserActions`）
   - `lib/ypi-studio-tasks.ts`（`startYpiStudioUserAcceptanceFromWidget` 作模板、`archiveYpiStudioTask`）
   - `lib/ypi-studio-types.ts`（kinds / body）
   - `lib/ypi-studio-extension.ts`（`studio-archive` handler 文案）
   - `lib/ypi-studio-widget-continue.ts`（**不要**把新 kind 加入 continue）
   - `components/YpiStudioSessionWidget.tsx`（`userActionsForTask` / `handleDecisionAction` / decision UI）
   - `app/api/studio/tasks/[taskKey]/route.ts`
   - `.ypi/workflows/*.json`
4. 测试：`scripts/test-ypi-studio-widget-actions.mjs`、`test-ypi-studio-main-accept.mjs`
5. 规范：`docs/standards/code-style.md`、`docs/modules/{frontend,api,library}.md`

## 2. 人类可读子任务表

| order | id | phase | 标题 | dependsOn | parallelizable |
| --- | --- | --- | --- | --- | --- |
| 1 | COMP-WF-01 | foundation | workflow 边 completed→user_acceptance + 本仓 JSON | [] | 是 |
| 2 | COMP-TYPES-02 | foundation | kinds / body 类型 + guards | [] | 是（与 01） |
| 3 | COMP-DOMAIN-03 | domain | returnToUserAcceptance helper + route | COMP-WF-01, COMP-TYPES-02 | 否 |
| 4 | COMP-PROJECT-04 | projection | buildWidgetUserActions completed 投影 | COMP-TYPES-02, COMP-WF-01 | 可与 03 并行 |
| 5 | COMP-WIDGET-05 | ui-logic | Widget 过滤 / confirm / PATCH / slash Send | COMP-DOMAIN-03, COMP-PROJECT-04 | 否 |
| 6 | COMP-DOCS-TEST-06 | verify | 单测 + docs + lint/tsc | COMP-WIDGET-05 | 否 |

**maxConcurrency：2**  
**schemaVersion：2**

## 3. 机器可读 Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "taskId": "20260719-043757-任务浮窗-completed-态支持退回用户验收与-studio-archive-归档",
  "title": "任务浮窗 completed 态支持退回用户验收与 /studio-archive 归档",
  "maxConcurrency": 2,
  "execution": {
    "groups": [
      {
        "id": "foundation",
        "title": "Workflow + types",
        "subtaskIds": ["COMP-WF-01", "COMP-TYPES-02"]
      },
      {
        "id": "server-projection",
        "title": "Domain helper + projection",
        "subtaskIds": ["COMP-DOMAIN-03", "COMP-PROJECT-04"]
      },
      {
        "id": "ui-verify",
        "title": "Widget + docs/tests",
        "subtaskIds": ["COMP-WIDGET-05", "COMP-DOCS-TEST-06"]
      }
    ]
  },
  "subtasks": [
    {
      "id": "COMP-WF-01",
      "title": "增加 completed → user_acceptance 工作流边并同步本仓 JSON",
      "phase": "foundation",
      "order": 1,
      "dependsOn": [],
      "parallelizable": true,
      "localReview": true,
      "files": [
        "lib/ypi-studio-workflows.ts",
        ".ypi/workflows/feature-dev.json",
        ".ypi/workflows/bugfix.json",
        ".ypi/workflows/ui-change.json"
      ],
      "instructions": [
        "在 BASE_TRANSITIONS 增加 { from: \"completed\", to: \"user_acceptance\" }；保留 completed→archived。",
        "不要给该边加 requiresUserApproval（widget 用显式 action + reason 审计即可）。",
        "同步更新本仓库 .ypi/workflows 中 feature-dev / bugfix / ui-change 的 transitions 数组。",
        "review-only.json 不要加 user_acceptance 状态或退回边。",
        "不要在本步改 task 运行时逻辑。"
      ],
      "acceptance": [
        "DEFAULT feature-dev 可 findYpiStudioTransition(completed, user_acceptance)。",
        "本仓三个标准 workflow JSON 含新边。",
        "review-only 仍只有 completed→archived。"
      ],
      "validation": [
        "node -e \"import('./lib/ypi-studio-workflows.ts').then(m=>{const w=m.DEFAULT_YPI_STUDIO_WORKFLOWS.find(x=>x.id==='feature-dev'); console.log(!!m.findYpiStudioTransition(w,'completed','user_acceptance'))})\""
      ],
      "risks": [
        "其他工作区磁盘 workflow 缺边：由 COMP-DOMAIN-03 返回明确 422 文案；文档说明可手补或 studio-init overwriteDefaults。"
      ]
    },
    {
      "id": "COMP-TYPES-02",
      "title": "扩展 Widget kind 与 return_to_user_acceptance body 类型",
      "phase": "foundation",
      "order": 2,
      "dependsOn": [],
      "parallelizable": true,
      "localReview": true,
      "files": [
        "lib/ypi-studio-types.ts",
        "lib/ypi-studio-tasks.ts"
      ],
      "instructions": [
        "YpiStudioWidgetUserActionKind 增加 return_to_user_acceptance | studio_archive。",
        "新增 YpiStudioWidgetReturnToUserAcceptanceBody：action 字面量、cwd、contextId、expectedRevision；无 override。",
        "在 ypi-studio-tasks.ts 增加 isYpiStudioWidgetReturnToUserAcceptanceBody 形状守卫（对齐 start_user_acceptance）。",
        "注释标明 studio_archive 无 PATCH body（Chat-only）。"
      ],
      "acceptance": [
        "tsc 可解析新类型。",
        "guard 拒绝 override / 缺字段 / 错误 action。"
      ],
      "validation": [
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "前端 filter 未更新会吞掉新 kind——由 COMP-WIDGET-05 处理。"
      ]
    },
    {
      "id": "COMP-DOMAIN-03",
      "title": "实现 returnYpiStudioToUserAcceptanceFromWidget + route 匹配",
      "phase": "domain",
      "order": 3,
      "dependsOn": ["COMP-WF-01", "COMP-TYPES-02"],
      "parallelizable": false,
      "localReview": true,
      "files": [
        "lib/ypi-studio-tasks.ts",
        "app/api/studio/tasks/[taskKey]/route.ts"
      ],
      "instructions": [
        "仿 startYpiStudioUserAcceptanceFromWidget 实现 returnYpiStudioToUserAcceptanceFromWidget：",
        "  - 要求 session-class contextId；withTaskMutationLock",
        "  - !archived；status===completed；assertTaskBoundToContext；assertExpectedRevision(planRevision)",
        "  - assertNoUnresolvedImprovementsForComplete 或等价防御",
        "  - findYpiStudioTransition(completed,user_acceptance)；缺边 throw 明确错误",
        "  - status=user_acceptance；completedAt=null；currentMember=state.owner；不写 approvalGrant",
        "  - event data: source=user-widget, action=return_to_user_acceptance",
        "  - writeRuntimePointer",
        "route：在 start_user_acceptance 分支旁增加 isYpiStudioWidgetReturnToUserAcceptanceBody 匹配，使用 widgetDecisionErrorResponse。",
        "不要在 route 为浮窗增加 silent archive 捷径。"
      ],
      "acceptance": [
        "completed→user_acceptance 成功且 completedAt 为 null。",
        "非 completed / 未绑定 / revision 错 / 无边 失败且无部分写。",
        "archived 拒绝。"
      ],
      "validation": [
        "扩展 scripts/test-ypi-studio-widget-actions.mjs 或 dag 脚本覆盖 helper",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "松散 transition 路径不会清 completedAt——文档要求 widget 只用显式 action；可选在 transitionYpiStudioTask 对离开 terminal 清 completedAt（若做，保持最小且测覆盖）。"
      ]
    },
    {
      "id": "COMP-PROJECT-04",
      "title": "completed 态 userActions 投影（归档 + 退回）",
      "phase": "projection",
      "order": 4,
      "dependsOn": ["COMP-TYPES-02", "COMP-WF-01"],
      "parallelizable": true,
      "localReview": true,
      "files": [
        "lib/ypi-studio-session-link.ts",
        "scripts/test-ypi-studio-widget-actions.mjs"
      ],
      "instructions": [
        "buildWidgetUserActions：status===completed && !archived 时投影：",
        "  primary studio_archive label=归档 requiresConfirmation=true",
        "  secondary return_to_user_acceptance label=退回用户验收（仅 supportsReturnToUserAcceptance!==false）",
        "推荐：buildProjection 计算 supportsReturnToUserAcceptance = !!findYpiStudioTransition(workflow,'completed','user_acceptance') 传入。",
        "id 形如 main:studio_archive:r{n} / main:return_to_user_acceptance:r{n}；targetLabel bound。",
        "保持 WIDGET_USER_ACTIONS_MAX=2；archived 仍 []。",
        "扩展 assert allowed kinds 列表与 completed 用例；planning/awaiting_approval 用例不受影响。"
      ],
      "acceptance": [
        "completed 投影 2 actions（标准 workflow）或 1（无退回边）。",
        "无 endpoint/body/path 字段。",
        "max ≤2。"
      ],
      "validation": [
        "npm run test:studio-widget-actions"
      ],
      "risks": [
        "与 canAcceptMain 同时出现——completed 时 canAcceptMain 本应为 false，确认不回归。"
      ]
    },
    {
      "id": "COMP-WIDGET-05",
      "title": "浮窗 decision：退回 PATCH + 归档 onComposeSend(/studio-archive)",
      "phase": "ui-logic",
      "order": 5,
      "dependsOn": ["COMP-DOMAIN-03", "COMP-PROJECT-04"],
      "parallelizable": false,
      "localReview": true,
      "files": [
        "components/YpiStudioSessionWidget.tsx"
      ],
      "instructions": [
        "userActionsForTask 允许 return_to_user_acceptance 与 studio_archive。",
        "decisionRegionTitle / decisionBusyLabel 覆盖新 kind（完成态收尾 / 退回中… / 发起归档…）。",
        "handleDecisionAction：",
        "  return_to_user_acceptance：confirm（ui.md 文案）→ lock → PATCH 显式 body → toast → onTaskChanged；不调用 onComposeSend。",
        "  studio_archive：confirm（强调 Chat 模型归档）→ lock → 若无 onComposeSend toast 失败；否则 await onComposeSend(\"/studio-archive\")（可选 reason 拼参）→ toast；不 PATCH archive。",
        "agentRunning / acceptingInFlight 禁用与 Hybrid B 一致；confirm 后二次 agentRunningRef 检查。",
        "ypiStudioWidgetActionNeedsChatContinue 保持 false 对新 kind（不要走 post-PATCH continue helper）。",
        "不修改 globals.css 视觉 token；不改 rail。"
      ],
      "acceptance": [
        "Completed 卡两按钮可用且样式复用 decision。",
        "退回仅 PATCH；归档仅 Chat slash。",
        "busy 规则与既有决策/验收一致。"
      ],
      "validation": [
        "node_modules/.bin/tsc --noEmit",
        "npm run lint",
        "手工 ui.md checklist"
      ],
      "risks": [
        "handleDecisionAction else 分支吞未知 kind——必须先分支新 kind。",
        "onComposeSend 在 agentRunning 时 no-op——依赖 disabled + 二次检查。"
      ]
    },
    {
      "id": "COMP-DOCS-TEST-06",
      "title": "文档、单测矩阵与全量校验",
      "phase": "verify",
      "order": 6,
      "dependsOn": ["COMP-WIDGET-05"],
      "parallelizable": false,
      "localReview": true,
      "files": [
        "docs/modules/frontend.md",
        "docs/modules/api.md",
        "docs/modules/library.md",
        "docs/architecture/overview.md",
        "scripts/test-ypi-studio-widget-actions.mjs",
        "scripts/test-ypi-studio-main-accept.mjs",
        "package.json"
      ],
      "instructions": [
        "更新 frontend/api/library/overview 中 userActions kinds、Hybrid B 说明、completed CTA、return action、archive Chat 主路径。",
        "补齐单测：投影、guard、return helper、canAcceptMain 在 completed 仍 false。",
        "确认 test:studio-widget-continue 仍仅三 continue kind。",
        "跑 lint + tsc + 相关 npm test scripts。",
        "不 commit。"
      ],
      "acceptance": [
        "checks.md 自动项全绿。",
        "文档与实现一致。"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "npm run test:studio-widget-actions",
        "npm run test:studio-widget-continue",
        "npm run test:studio-main-accept"
      ],
      "risks": [
        "文档过长段落需定点编辑，避免误伤其它 Studio 描述。"
      ]
    }
  ]
}
```

## 4. 验证命令（汇总）

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:studio-widget-actions
npm run test:studio-widget-continue
npm run test:studio-main-accept
# 可选：npm run test:studio-dag（若扩展 transition 用例）
```

## 5. 评审门禁

- [ ] 无视觉 CSS 改版
- [ ] 无浮窗 silent archive 主路径
- [ ] `/studio-archive` 经 onComposeSend
- [ ] return helper 清 completedAt
- [ ] userActions ≤2
- [ ] Hybrid B 既有矩阵回归

## 6. 回滚

1. 投影去掉 completed 分支。  
2. 前端 filter 去掉新 kind。  
3. route/helper 删除或 no-op。  
4. workflow 边可留。
