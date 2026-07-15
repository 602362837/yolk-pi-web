# Implement — IMP-001 最大合理替换

## 需先阅读

- 本改进修订版：`brief.md` `prd.md` `ui.md` `design.md` `checks.md` `plan-review.md`
- 原型：`icon-flow-opt-in-prototype.html`
- 主任务基线：`ActionFlowIcon.tsx`、`app/globals.css` icon-flow 段、`AppShell.tsx`、`BranchNavigator.tsx`
- `docs/modules/frontend.md`、`docs/standards/code-style.md`

## 人类可读计划

| ID | 阶段 | 子任务 | 依赖 | 主要文件 | 可并行 |
| --- | --- | --- | --- | --- | --- |
| IMP-A | Implement | CSS 解耦：宿主无关 `data-icon-flow` | 无 | `app/globals.css` | 否 |
| IMP-B | Implement | helper + ActionFlowIcon 契约注释 + 现有 B0 等价迁移 | IMP-A | `components/iconFlow.ts`、`ActionFlowIcon.tsx`、`AppShell.tsx`、`BranchNavigator.tsx` | 否 |
| IMP-C | Implement | 批量替换 B1：Chat 输入 / Browser Share / Message actions | IMP-B | `BrowserShareControl.tsx`、`ChatInput.tsx`、`MessageView.tsx` | 否 |
| IMP-D | Implement | 批量替换 B2+B3：侧栏工具条 + 文件/Usage/Models/Skills 工具条 | IMP-C | `SessionSidebar.tsx`、`AppShell.tsx`（explorer 刷新）、`FileViewer.tsx`、`ChatGptUsagePanel.tsx`、`UsageStatsModal.tsx`、`UsageProviderModelTable.tsx`、`ModelsConfig.tsx`、`SkillsConfig.tsx` | 否 |
| IMP-E | Implement | 尽量 B4：Terminal 等非危险工具条 + 可选 theme polish | IMP-D | `TerminalPanel.tsx`（及其他 B4） | 否 |
| DOC-A | Implement | frontend 文档 + 改进 handoff | IMP-D（建议 IMP-E 后） | `docs/modules/frontend.md`、本目录 `handoff.md` | 否 |
| CHK-A | Checks | 按 checks 验证白名单完成度与黑名单零误接入 | DOC-A | diff / 浏览器 | 否 |

## 实现要点

1. **禁止**全局 `button` 动画；无 `data-icon-flow` 不得流动。
2. 解耦后现有 tag 入口行为等价（ambient / interactive / off）。
3. 白名单替换手法见 `design.md`：几何进 `ActionFlowIcon`，宿主 `iconFlowAttrs("interactive")` 或等价 attr。
4. **黑名单零容忍**：Delete/Close/Stop fill/Git spin/会话行/解绑拒绝等不得加 flow。
5. `ModelsConfig` 只改工具条级 Refresh/Test/Copy/Show key 等，不做账户 Disable 行。
6. Compact/Stop 等实心态保持 fill，不包 overlay。
7. 删除冲突的内联 hover 改色时勿动业务 handler。
8. B4 做不到写 handoff 偏差，不得为此缩小 B1–B3。
9. 不引入 `FlowIconButton`；不改 API/session。

## 验证命令

```bash
npm run lint
node_modules/.bin/tsc --noEmit
rg -n "data-icon-flow|ActionFlowIcon|iconFlowAttrs|action-flow-icon" components app/globals.css docs/modules/frontend.md
rg -n "button[^{]*\{[^}]*action-icon-flow|button:hover[^{]*\{[^}]*animation" app/globals.css
rg -n "data-icon-flow" components --glob "*.tsx"
```

## 评审门禁与回滚

- 实现前：用户批准修订 `plan-review.md`（最大合理替换）。
- 实现后：lint/tsc；白名单抽样 hover；黑名单静止；reduced-motion；顶栏/侧栏无回归。
- 回滚：按批次文件回退 + globals。

## Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "updatedAt": "2026-07-15T02:45:00.000Z",
  "sourceArtifact": "implement.md",
  "summary": "解耦 data-icon-flow 后，按最大合理白名单批量替换 components 中独立 stroke action 图标为 ActionFlowIcon interactive 流动，并保持黑名单与 a11y。",
  "strategy": "串行 DAG：CSS 解耦 → helper/B0 → Chat 批 → 面板/侧栏批 → 可选 Terminal 批 → 文档 → 检查。",
  "maxConcurrency": 1,
  "scheduler": {
    "mode": "dag",
    "strategy": "ready_fifo",
    "failFast": true,
    "defaultFailurePolicy": "block_dependents"
  },
  "subtasks": [
    {
      "id": "IMP-A",
      "title": "解耦 CSS 为宿主无关 data-icon-flow opt-in",
      "phase": "implement",
      "order": 1,
      "dependsOn": [],
      "files": ["app/globals.css"],
      "relation": "serial",
      "instructions": [
        "将 interactive/ambient/off overlay 规则改为 [data-icon-flow=…] 宿主无关，并要求后代 .action-flow-icon__overlay。",
        "无 data-icon-flow 时不得持续流动。",
        "ambient 错峰仍限定 .sidebar-utility-actions。",
        "disabled/off/prefers-reduced-motion 隐藏 overlay；禁止 button 全局 animation。"
      ],
      "acceptance": [
        "未设置 data-icon-flow 的控件不流动",
        "现有 tag 入口在等价 attr 下行为保持",
        "无 button 级强制 flow 规则"
      ],
      "validation": ["npm run lint", "静态搜索 globals 选择器", "快速回归顶栏/侧栏"],
      "risks": ["选择器过宽", "ambient 泄漏", "specificity 导致 disabled 失效"],
      "parallelizable": false,
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "IMP-B",
      "title": "helper + B0 现有入口等价迁移",
      "phase": "implement",
      "order": 2,
      "dependsOn": ["IMP-A"],
      "files": [
        "components/iconFlow.ts",
        "components/ActionFlowIcon.tsx",
        "components/AppShell.tsx",
        "components/BranchNavigator.tsx"
      ],
      "relation": "serial",
      "instructions": [
        "新增 IconFlowMode 与 iconFlowAttrs；不引入 FlowIconButton。",
        "B0 AppShell/BranchNavigator 使用稳定 attr；不改 onClick/aria/badge/顺序。",
        "ActionFlowIcon 注释写明必须搭配宿主 data-icon-flow。"
      ],
      "acceptance": [
        "helper 无副作用可复用",
        "侧栏 ambient、顶栏 interactive、disabled off 正确",
        "无业务回归"
      ],
      "validation": ["npm run lint", "node_modules/.bin/tsc --noEmit"],
      "risks": ["迁移漏 attr", "双 class 冲突"],
      "parallelizable": false,
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "IMP-C",
      "title": "批量替换 B1：Chat 输入 / Browser Share / Message",
      "phase": "implement",
      "order": 3,
      "dependsOn": ["IMP-B"],
      "files": [
        "components/BrowserShareControl.tsx",
        "components/ChatInput.tsx",
        "components/MessageView.tsx"
      ],
      "relation": "serial",
      "instructions": [
        "Browser Share 绑定 pill → ActionFlowIcon + interactive；解绑/拒绝不加 flow。",
        "ChatInput：Attach image/file、Send/Steer/Follow-up stroke 图标、Compact stroke 态、auto-scroll/sound toggles → interactive；Stop/Compacting fill 与附件 remove X 不换。",
        "MessageView：Copy / Edit from here 等独立消息 action → interactive；不改消息列表密集布局逻辑。"
      ],
      "acceptance": [
        "B1 白名单入口 hover 可流动",
        "黑名单 Stop/remove/解绑静止",
        "发送/附件/Browser Share 业务不变"
      ],
      "validation": ["lint/tsc", "浏览器抽样 Chat 底栏与消息 action"],
      "risks": ["底栏密度噪声", "状态色被覆盖", "动态 sound 双几何"],
      "parallelizable": false,
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "IMP-D",
      "title": "批量替换 B2+B3：侧栏工具条与面板工具条",
      "phase": "implement",
      "order": 4,
      "dependsOn": ["IMP-C"],
      "files": [
        "components/SessionSidebar.tsx",
        "components/AppShell.tsx",
        "components/FileViewer.tsx",
        "components/ChatGptUsagePanel.tsx",
        "components/UsageStatsModal.tsx",
        "components/UsageProviderModelTable.tsx",
        "components/ModelsConfig.tsx",
        "components/SkillsConfig.tsx"
      ],
      "relation": "serial",
      "instructions": [
        "SessionSidebar：新建会话、工作树、刷新、Workspace actions → interactive；会话行 Rename/Archive/Delete/Expand forks 禁止。",
        "AppShell 项目空间刷新（非完成勾）→ interactive。",
        "FileViewer Add to chat 工具条 → interactive。",
        "Usage/Models/Skills 面板级 Refresh/Test/Add skill/Copy/Show key 等 stroke 工具条 → interactive；Close/Delete/Disable 行禁止；Git 风格 spin 不叠加。"
      ],
      "acceptance": [
        "B2/B3 白名单完成",
        "会话列表与危险操作无 flow",
        "面板开关与刷新业务不变"
      ],
      "validation": ["lint/tsc", "静态 data-icon-flow 文件列表", "浏览器抽样侧栏与 Models/Usage"],
      "risks": ["ModelsConfig 误改行内", "刷新完成态勾与 flow 冲突"],
      "parallelizable": false,
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "IMP-E",
      "title": "尽量 B4：Terminal 等非危险工具条",
      "phase": "implement",
      "order": 5,
      "dependsOn": ["IMP-D"],
      "files": ["components/TerminalPanel.tsx"],
      "relation": "serial",
      "instructions": [
        "Terminal：New local / Open SSH / Maximize 等非关闭 stroke 图标尽量 interactive。",
        "Close tab、关闭终端并结束进程、resize 禁止。",
        "若时间或几何不可迁，handoff 记录跳过原因，不得回退 B1–B3。",
        "可选：theme toggle pressed 不持续 flow（仅 hover/focus）。"
      ],
      "acceptance": [
        "无黑名单误接入",
        "能换的 Terminal 工具条已换或已记录偏差"
      ],
      "validation": ["lint/tsc", "Terminal 工具条抽样"],
      "risks": ["图标为 emoji/text 无法迁", "关闭钮误伤"],
      "parallelizable": false,
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "DOC-A",
      "title": "更新 frontend 文档与改进 handoff",
      "phase": "implement",
      "order": 6,
      "dependsOn": ["IMP-E"],
      "files": [
        "docs/modules/frontend.md",
        ".ypi/tasks/20260715-085126-操作按钮科技感-流动-tag-化与全局圆角/improvements/imp_otcmzivo/handoff.md"
      ],
      "relation": "serial",
      "instructions": [
        "记录 opt-in 契约、最大合理替换策略、黑白名单、ambient 限制、回滚。",
        "handoff 写明各批完成文件、跳过项、lint/tsc、浏览器证据与偏差。"
      ],
      "acceptance": ["文档与代码一致", "不夸大未做浏览器证据"],
      "validation": ["审阅 diff 与文档链接"],
      "risks": ["文档鼓励突破黑名单"],
      "parallelizable": false,
      "localReview": { "required": true, "reviewer": "checker" }
    }
  ]
}
```
