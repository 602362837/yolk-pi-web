# Implement — IMP-003 任务浮窗主任务用户验收

## 需先阅读

1. 本改进 `brief.md` / `prd.md` / `design.md` / `checks.md` / `ui.md` / `plan-review.md`
2. `components/YpiStudioSessionWidget.tsx`（`handleAcceptImprovement`、`acceptableImprovementsForTask`、改进按钮区）
3. `lib/ypi-studio-session-link.ts`（`buildProjection` / `canAccept`）
4. `lib/ypi-studio-types.ts`（`YpiStudioTaskWidgetProjection`）
5. `lib/ypi-studio-tasks.ts`（`transitionYpiStudioTask`、`assertNoUnresolvedImprovementsForComplete`）
6. `lib/ypi-studio-workflows.ts`（`user_acceptance → completed`）
7. `docs/modules/frontend.md` Session Widget 段
8. HTML 原型 `studio-main-task-accept-prototype.html`

## 人类可读子任务表

| ID | 阶段 | 顺序 | 内容 | 依赖 | 主要文件 | 可并行 |
| --- | --- | ---: | --- | --- | --- | --- |
| MAIN-ACCEPT-1 | foundation | 1 | projection `canAcceptMain` 纯条件 + 类型 + 单测 | — | `lib/ypi-studio-types.ts`, `lib/ypi-studio-session-link.ts`, 测试脚本 | 否 |
| MAIN-ACCEPT-2 | widget | 2 | 浮窗主任务按钮、AppPrompt、PATCH completed、busy/错误 | MAIN-ACCEPT-1 | `components/YpiStudioSessionWidget.tsx`, `app/globals.css` | 否 |
| MAIN-ACCEPT-3 | validation | 3 | 文档、lint/tsc、对照 checks 人工清单 | MAIN-ACCEPT-2 | `docs/modules/frontend.md` | 否 |

## 执行步骤

### MAIN-ACCEPT-1 — Projection

- 在 `YpiStudioTaskWidgetProjection` 增加可选 `canAcceptMain?: boolean`。
- 抽纯函数（可同文件或小 helper）：

```ts
function canAcceptMainTask(input: {
  status: string;
  archived?: boolean;
  unresolvedImprovementCount: number;
}): boolean {
  return !input.archived
    && input.status === "user_acceptance"
    && input.unresolvedImprovementCount === 0;
}
```

- `buildProjection` 设置 `canAcceptMain: canAcceptMainTask(...) ? true : undefined`。
- 测试覆盖 R1 真值表（见 checks）。

### MAIN-ACCEPT-2 — Widget 写路径

- `TaskCard`（或等价）在 `canAcceptMain` 时渲染主任务验收区。
- 新增 `handleAcceptMainTask`，镜像改进验收：
  - 校验 `cwd`、`contextId`；
  - AppPrompt 二次确认（文案见 ui.md）；
  - `PATCH` `{ cwd, to:"completed", contextId, reason:"User accepted main task from session widget" }`；
  - 成功/失败 toast + `onTaskChanged`；
  - in-flight 防双击（可与改进验收互斥）。
- 样式：`.ypi-studio-widget-main-accept*`，成功色，与橙按钮区分。
- 点击 `stopPropagation`，不触发 Detail/拖动。
- **禁止**乐观把 status 改成 completed。

### MAIN-ACCEPT-3 — 文档与验证

- 更新 `docs/modules/frontend.md`：说明主任务验收写路径与门禁；修正“never completes main task”。
- `npm run lint`、`node_modules/.bin/tsc --noEmit`、相关 test script。
- 不改主任务实现计划 DAG；本改进自有 3 子任务。

## Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "title": "IMP-003 任务浮窗主任务用户验收一键完成",
  "maxConcurrency": 1,
  "subtasks": [
    {
      "id": "MAIN-ACCEPT-1",
      "title": "Projection 增加 canAcceptMain 与纯函数测试",
      "phase": "foundation",
      "order": 1,
      "dependsOn": [],
      "files": [
        "lib/ypi-studio-types.ts",
        "lib/ypi-studio-session-link.ts",
        "scripts/test-ypi-studio-main-accept.mjs",
        "package.json"
      ],
      "instructions": [
        "新增 YpiStudioTaskWidgetProjection.canAcceptMain 可选字段。",
        "在 session-link projection 中按 user_acceptance && !archived && unresolved===0 设置标志；抽纯函数便于测试。",
        "新增/注册轻量测试覆盖真值表；不改服务端 transition 逻辑。"
      ],
      "acceptance": [
        "user_acceptance 且无未解决改进时 canAcceptMain 为 true",
        "有未解决改进、review、ready、archived、completed 时不为 true",
        "测试脚本通过"
      ],
      "validation": [
        "npm run test:studio-main-accept 或等价脚本",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "误用 review_ready 作为可完成条件",
        "unresolved 计数与 isImprovementUnresolved 不一致"
      ],
      "parallelizable": false,
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "MAIN-ACCEPT-2",
      "title": "浮窗主任务验收按钮与 PATCH completed",
      "phase": "widget",
      "order": 2,
      "dependsOn": ["MAIN-ACCEPT-1"],
      "files": [
        "components/YpiStudioSessionWidget.tsx",
        "app/globals.css"
      ],
      "instructions": [
        "按 canAcceptMain 渲染「确认主任务已验收完成」；AppPrompt 二次确认。",
        "确认后 PATCH 主任务 to=completed + contextId + reason；失败刷新；与改进按钮样式/文案区分。",
        "stopPropagation；in-flight 互斥；不乐观更新；不 archive。"
      ],
      "acceptance": [
        "仅 user_acceptance 可见主任务按钮",
        "取消不发请求；确认后走 completed 且带 reason",
        "缺 contextId 只 toast",
        "与改进验收视觉可区分"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "浏览器人工：确认/取消/失败提示"
      ],
      "risks": [
        "误调 transition_improvement",
        "漏 reason 触发 requiresUserApproval 错误",
        "按钮冒泡触发 Detail"
      ],
      "parallelizable": false,
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "MAIN-ACCEPT-3",
      "title": "文档与回归验证",
      "phase": "validation",
      "order": 3,
      "dependsOn": ["MAIN-ACCEPT-2"],
      "files": [
        "docs/modules/frontend.md"
      ],
      "instructions": [
        "更新 frontend 模块对 Session Widget 主任务验收的说明。",
        "对照 checks.md 完成 lint/tsc/测试与人工清单；确认改进验收路径未回归。"
      ],
      "acceptance": [
        "文档描述 canAcceptMain 与 PATCH 门禁",
        "lint/tsc/测试通过",
        "改进验收与资料新标签行为无回归"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "相关 test 脚本"
      ],
      "risks": [
        "文档仍写 never completes main task 造成漂移"
      ],
      "parallelizable": false,
      "localReview": { "required": true, "reviewer": "checker" }
    }
  ],
  "execution": {
    "mode": "serial",
    "maxParallel": 1,
    "groups": [
      {
        "id": "all",
        "title": "主任务浮窗验收",
        "relation": "serial",
        "dependencies": [],
        "subtaskIds": ["MAIN-ACCEPT-1", "MAIN-ACCEPT-2", "MAIN-ACCEPT-3"]
      }
    ]
  }
}
```

## 验证命令

```bash
npm run test:studio-main-accept   # 或实现时注册的等价脚本名
npm run lint
node_modules/.bin/tsc --noEmit
```

不得运行 `next build`。

## 检查门禁

- 用户批准本改进 `plan-review.md` + HTML 原型后才可实现。
- 不得绕过 unresolved / archive / requiresUserApproval / context 绑定。
- 不得修改主任务 transition 服务端语义，除非发现 bug 并在审批中声明。

## 回滚

还原 projection 字段、widget handler/UI、CSS、文档与测试即可。
