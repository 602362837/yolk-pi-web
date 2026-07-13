# Implement

## 实施前门禁

1. 主会话派发 `ui-designer`，交付任务目录内 HTML 原型。
2. 用户审批 HTML 原型和 `plan-review.md`。
3. 确认 toast 是否纳入、文案语言策略、backdrop 策略。
4. 主会话保存 implementationPlan 并进入 `awaiting_approval`；未审批不得实现。

## 优先阅读

- `AGENTS.md`
- `docs/modules/frontend.md`
- `docs/standards/code-style.md`
- `app/layout.tsx`、`components/AppShell.tsx`
- `components/ProjectSpaceSwitchDialog.tsx`
- `components/DiffModal.tsx`
- 本任务 `prd.md`、`ui.md`、`design.md`、获批 HTML 原型
- 所有迁移调用文件

## 人类可读子任务表

| ID | 阶段 | 内容 | 依赖 | 可并行 |
| --- | --- | --- | --- | --- |
| S1 | foundation | 实现提示类型、Provider、队列、dialog、焦点/键盘/滚动控制并挂载根部 | UI/计划审批 | 否 |
| S2 | feedback | 实现 toast viewport，并迁移 ModelsConfig 局部 toast（仅在获批纳入时） | S1 | 是 |
| S3 | migrate-core | 迁移 Sidebar、Studio、Usage、FileViewer 的 confirm | S1 | 是 |
| S4 | migrate-terminal-models | 迁移 AppShell、TerminalPanel、ModelsConfig confirm/prompt | S1 | 是 |
| S5 | verify-docs | 全量静态检查、交互回归、更新 frontend 文档 | S2/S3/S4 | 否 |

```json
{
  "schemaVersion": 2,
  "maxConcurrency": 3,
  "subtasks": [
    {
      "id": "S1-prompt-foundation",
      "title": "建立统一提示窗基础设施",
      "phase": "foundation",
      "order": 1,
      "dependsOn": [],
      "files": ["components/AppPromptProvider.tsx", "components/AppPromptDialog.tsx", "components/AppShell.tsx", "app/layout.tsx", "app/globals.css"],
      "instructions": "按获批 HTML 原型实现 notice/confirm/prompt 类型化 API、FIFO 队列、exactly-once settlement、portal、focus trap、焦点恢复、Escape/Enter、IME、scroll lock、响应式和 reduced-motion。只在一个合适根节点挂载 Provider。",
      "acceptance": ["API 返回契约与 design.md 一致", "并发请求 FIFO 且 Promise 恰好结算一次", "Provider 卸载取消所有请求", "键盘与移动端行为符合获批原型"],
      "validation": ["node_modules/.bin/tsc --noEmit", "npm run lint", "桌面/375px 手工验证 focus trap、Escape、Enter、焦点恢复"],
      "risks": ["根挂载范围不足", "嵌套 modal 的 Escape 和焦点冲突", "Strict Mode 重复清理"],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "S2-toast",
      "title": "统一非阻塞 Toast 反馈",
      "phase": "feedback",
      "order": 2,
      "dependsOn": ["S1-prompt-foundation"],
      "files": ["components/AppPromptProvider.tsx", "components/AppToastViewport.tsx", "components/ModelsConfig.tsx", "app/globals.css"],
      "instructions": "仅在用户批准纳入 toast 时实现。提供 live region、tone、自动/手动关闭、最多三条、timer cleanup，并迁移 ModelsConfig 局部 toast。",
      "acceptance": ["toast 不抢焦点", "success/error 可被读屏识别", "timer 无泄漏且窄屏不溢出", "ModelsConfig 原有反馈语义保留"],
      "validation": ["node_modules/.bin/tsc --noEmit", "npm run lint", "手工验证浅色/深色、堆叠、关闭、hover/focus 暂停"],
      "risks": ["范围决策未确认", "live region 重复播报"],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "S3-migrate-general",
      "title": "迁移常规确认调用",
      "phase": "migration",
      "order": 3,
      "dependsOn": ["S1-prompt-foundation"],
      "files": ["components/ChatGptUsagePanel.tsx", "components/SessionSidebar.tsx", "components/YpiStudioPanel.tsx", "components/FileViewer.tsx"],
      "instructions": "迁移 8 个 window.confirm，保持原文、条件、参数和后续异步业务逻辑；为危险操作设置获批 intent。",
      "acceptance": ["目标文件无原生 confirm", "取消不执行操作", "确认只执行一次", "嵌套 drawer/modal 场景焦点正确恢复"],
      "validation": ["rg -n '\\bwindow\\.confirm\\s*\\(' components/ChatGptUsagePanel.tsx components/SessionSidebar.tsx components/YpiStudioPanel.tsx components/FileViewer.tsx", "npm run lint", "逐场景手工确认取消/确认"],
      "risks": ["async handler 改造遗漏 await", "两处项目归档入口行为不一致"],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "S4-migrate-terminal-models",
      "title": "迁移终端与账号确认输入调用",
      "phase": "migration",
      "order": 4,
      "dependsOn": ["S1-prompt-foundation"],
      "files": ["components/AppShell.tsx", "components/TerminalPanel.tsx", "components/ModelsConfig.tsx"],
      "instructions": "迁移 5 个 confirm 和 1 个 prompt。账户备注严格区分 null 取消与空字符串清除；终端关闭确认保持原终止逻辑和调用顺序。",
      "acceptance": ["目标文件无原生 confirm/prompt", "备注取消不修改，空提交可清除", "终端取消不关闭进程，确认只终止一次"],
      "validation": ["rg -n '\\bwindow\\.(confirm|prompt)\\s*\\(' components/AppShell.tsx components/TerminalPanel.tsx components/ModelsConfig.tsx", "npm run lint", "手工验证终端 dock/最后 tab/跨 workspace 与备注输入"],
      "risks": ["prompt 空值语义回归", "终端重复关闭", "Provider 与 AppShell 循环依赖"],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "S5-verify-document",
      "title": "全量验证并更新前端文档",
      "phase": "verification",
      "order": 5,
      "dependsOn": ["S2-toast", "S3-migrate-general", "S4-migrate-terminal-models"],
      "files": ["docs/modules/frontend.md", "app/globals.css"],
      "instructions": "按最终范围更新组件地图，执行全量原生弹窗扫描、lint、类型检查和桌面/移动端人工验收。若 toast 被排除，S2 标记 skipped 并记录后续风险。",
      "acceptance": ["生产 TS/TSX 无浏览器原生 alert/confirm/prompt", "文档记录统一组件职责", "所有 checks.md 项目有证据"],
      "validation": ["rg -n '\\b(window\\.)?(alert|confirm|prompt)\\s*\\(' app components hooks lib --glob '*.{ts,tsx}'", "npm run lint", "node_modules/.bin/tsc --noEmit"],
      "risks": ["正则误报 session.prompt", "缺少浏览器自动化测试"],
      "parallelizable": false,
      "localReview": true
    }
  ]
}
```

## 验证命令

```bash
rg -n '\bwindow\.(alert|confirm|prompt)\s*\(' app components hooks lib --glob '*.{ts,tsx}'
npm run lint
node_modules/.bin/tsc --noEmit
```

如引入组件测试工具，至少覆盖队列、取消返回值、prompt 空值、卸载结算和 timer cleanup；不要仅依赖快照。

## 评审与回滚门禁

- Implementer 每个迁移子任务需本地 review，checker 最终复核全部 14 个调用。
- UI 原型差异必须回到用户审批，不由实现员自行决定。
- 回滚按 S3/S4 调用点和 S1 Provider 成套回退；无数据迁移。

## 2026-07-12 返工恢复说明

### 失败证据与结论

首次实施登记中的 S1-S5 虽被运行器记为 `done`，但不能视为完成：

- 5 次 implementer 运行均在约 1-2 秒内结束，每次 transcript 仅 5 条记录、0 次工具调用。
- 5 次运行都只有 `SDK child run finished without a captured final assistant message.`，没有文件清单、diff、验证结果或阻塞说明。
- `git status --short` 仅显示当前任务目录为未跟踪内容，没有生产代码改动。
- 原生调用扫描仍返回 13 个 `window.confirm` 和 1 个 `window.prompt`。
- `review.md` 在 checker 运行后仍为 TBD，checker 同样没有工具调用和可采信检查输出。

因此原 S1-S5 全部判定为**未执行**，必须重新排队。旧 ID 已在 `task.json` 的 implementationProgress 中固化为 `done`，恢复时不能再次 claim 旧 ID；主会话必须保存下面的新计划，让 `-retry-1` ID 形成全新的待执行队列。

### 派发与输出捕获门禁

1. 主会话先确认用户已经批准的最终范围，尤其是 toast 是否纳入；不得由 implementer 猜测。
2. 保存下面唯一带 `json ypi-implementation-plan` 标记的恢复计划，确认进度显示 0/5 done，首个 ready 为 `S1-prompt-foundation-retry-1`。
3. 先单独派发 R1。R1 返回后，主会话必须检查 transcript 至少包含源码读取/编辑/验证工具调用，并核对工作区出现预期生产代码差异；不满足则标失败并停止后续派发。
4. R1 通过本地证据审查后，才并行派发 R2-R4。每个运行必须返回改动文件、关键行为、验证命令及结果、剩余风险；空 final message 不得标 done。
5. R2-R4 的工作区差异和原生调用扫描符合预期后，再派发 R5。R5 必须实际运行全量扫描、lint、type-check，更新文档并形成可供 checker 复核的摘要。
6. checker 必须读取 diff、执行检查并写入 `review.md`。无工具调用或 `review.md` 未更新时不得从 checking 进入完成态。

### 恢复 Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "maxConcurrency": 3,
  "subtasks": [
    {
      "id": "S1-prompt-foundation-retry-1",
      "title": "返工：建立统一提示窗基础设施",
      "phase": "foundation-retry",
      "order": 1,
      "dependsOn": [],
      "files": ["components/AppPromptProvider.tsx", "components/AppPromptDialog.tsx", "components/AppShell.tsx", "app/layout.tsx", "app/globals.css"],
      "instructions": "按已审批原型和 design.md 实际实现 notice/confirm/prompt、FIFO、exactly-once、portal、焦点/键盘/IME/滚动控制及根挂载。完成后返回改动文件、diff 摘要和验证结果；没有实际生产代码改动时必须报告阻塞，不得宣称完成。",
      "acceptance": ["工作区出现提示窗基础设施生产代码差异", "API、FIFO、卸载结算和键盘契约符合 design.md", "最终输出列出文件和验证证据"],
      "validation": ["git diff --check", "npm run lint", "node_modules/.bin/tsc --noEmit"],
      "risks": ["SDK 子运行再次空结束", "根挂载范围不足", "Strict Mode 和嵌套 modal 冲突"],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "S2-toast-retry-1",
      "title": "返工：统一非阻塞 Toast 反馈",
      "phase": "feedback-retry",
      "order": 2,
      "dependsOn": ["S1-prompt-foundation-retry-1"],
      "files": ["components/AppPromptProvider.tsx", "components/AppToastViewport.tsx", "components/ModelsConfig.tsx", "app/globals.css"],
      "instructions": "仅按主会话确认的已审批范围实现 toast；若范围排除 toast，主会话应将本子任务明确标 skipped，不得空跑后标 done。纳入时实际迁移 ModelsConfig 局部 toast并返回验证证据。",
      "acceptance": ["处理结果与已确认 toast 范围一致", "纳入时有生产代码差异且不抢焦点、timer 可清理", "最终输出列出文件和验证证据"],
      "validation": ["git diff --check", "npm run lint", "node_modules/.bin/tsc --noEmit"],
      "risks": ["toast 范围记录不明确", "live region 重复播报", "共享文件并行冲突"],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "S3-migrate-general-retry-1",
      "title": "返工：迁移常规确认调用",
      "phase": "migration-retry",
      "order": 3,
      "dependsOn": ["S1-prompt-foundation-retry-1"],
      "files": ["components/ChatGptUsagePanel.tsx", "components/SessionSidebar.tsx", "components/YpiStudioPanel.tsx", "components/FileViewer.tsx"],
      "instructions": "实际迁移目标文件中的 8 个 window.confirm，保持原业务条件、文案和异步控制流。返回逐文件数量、扫描结果和验证证据。",
      "acceptance": ["四个目标文件不再包含 window.confirm", "取消不执行且确认只执行一次", "最终输出列出文件和验证证据"],
      "validation": ["rg -n '\\bwindow\\.confirm\\s*\\(' components/ChatGptUsagePanel.tsx components/SessionSidebar.tsx components/YpiStudioPanel.tsx components/FileViewer.tsx", "git diff --check", "npm run lint"],
      "risks": ["遗漏 await", "归档入口行为不一致", "SDK 子运行再次空结束"],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "S4-migrate-terminal-models-retry-1",
      "title": "返工：迁移终端与账号确认输入调用",
      "phase": "migration-retry",
      "order": 4,
      "dependsOn": ["S1-prompt-foundation-retry-1"],
      "files": ["components/AppShell.tsx", "components/TerminalPanel.tsx", "components/ModelsConfig.tsx"],
      "instructions": "实际迁移 5 个 confirm 和 1 个 prompt，严格保留备注 null/空字符串语义及终端关闭顺序。返回逐文件数量、扫描结果和验证证据。",
      "acceptance": ["三个目标文件不再包含 window.confirm/window.prompt", "备注取消与清空语义正确", "终端取消不终止且确认只执行一次"],
      "validation": ["rg -n '\\bwindow\\.(confirm|prompt)\\s*\\(' components/AppShell.tsx components/TerminalPanel.tsx components/ModelsConfig.tsx", "git diff --check", "npm run lint"],
      "risks": ["prompt 空值回归", "终端重复关闭", "ModelsConfig 与 R2 并行冲突"],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "S5-verify-document-retry-1",
      "title": "返工：全量验证并更新前端文档",
      "phase": "verification-retry",
      "order": 5,
      "dependsOn": ["S2-toast-retry-1", "S3-migrate-general-retry-1", "S4-migrate-terminal-models-retry-1"],
      "files": ["docs/modules/frontend.md", "app/globals.css"],
      "instructions": "核对完整 diff，更新前端组件文档，实际执行全量原生调用扫描、lint、type-check 和 git diff --check。最终输出必须逐项给出命令结果；失败时报告阻塞，不得标完成。",
      "acceptance": ["生产 TS/TSX 无浏览器原生 alert/confirm/prompt", "frontend 文档与最终范围一致", "最终输出包含全部自动验证结果"],
      "validation": ["rg -n '\\bwindow\\.(alert|confirm|prompt)\\s*\\(' app components hooks lib --glob '*.{ts,tsx}'", "git diff --check", "npm run lint", "node_modules/.bin/tsc --noEmit"],
      "risks": ["依赖未真实实现却进入验证", "缺少浏览器自动化覆盖", "checker 再次空结束"],
      "parallelizable": false,
      "localReview": true
    }
  ]
}
```

### 主会话状态操作

架构师子会话不直接修改 `task.json`。主会话应通过 Studio 的 implementation plan 保存/重排能力登记上述恢复计划，并保留旧 runIds 作为失败审计记录。不要手工把旧 S1-S5 从 done 改回 pending；新 ID 用于避免旧进度污染和确保下一轮可 claim。
