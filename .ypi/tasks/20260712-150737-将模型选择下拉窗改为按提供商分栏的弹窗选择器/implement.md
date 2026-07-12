# Implement

## 需先阅读

- `AGENTS.md`
- `docs/modules/frontend.md`
- `docs/standards/code-style.md`
- `components/ModelSelect.tsx`
- `components/ChatInput.tsx` 的模型 option 映射和 selector 调用
- `components/SettingsConfig.tsx` 的 `ModelPolicySelect`
- `components/ProjectSpaceSwitchDialog.tsx` 的 modal/focus 实现
- `app/api/models/route.ts`
- 本任务已审批的 `model-selector-prototype.html`、`prd.md`、`design.md`、`checks.md`

## 建议执行顺序

| ID | 阶段 | 子任务 | 依赖 | 主要文件 | 可并行 |
| --- | --- | --- | --- | --- | --- |
| UI-01 | UI | ui-designer 生成 HTML 原型并取得用户审批 | 无 | task artifacts | 否 |
| IMP-01 | Implement | 按审批原型重构共享 ModelSelect 模态与分栏 | UI-01 | `components/ModelSelect.tsx`, 可选 `app/globals.css` | 否 |
| IMP-02 | Implement | 回归聊天与 Settings 调用契约，做最小适配 | IMP-01 | `components/ChatInput.tsx`, `components/SettingsConfig.tsx` | 否 |
| CHK-01 | Checks | 静态检查、桌面/移动与键盘人工验收 | IMP-02 | 相关文件及浏览器 | 否 |
| REV-01 | Review | 独立检查共享组件回归、焦点与滚动清理 | CHK-01 | diff + checks | 否 |

## 实现要点

1. 删除 `PanelPosition` 和 trigger 锚定位置计算，但保留 `placement` prop 作为兼容 no-op，避免扩大调用方改动。
2. 从 `filteredOptions` 派生 provider 栏和扁平键盘顺序，禁止两套独立排序。
3. 复用项目 modal 模式实现 portal、backdrop、focus trap、Escape、focus restore 和 body scroll lock。
4. 用 scoped class/CSS media query 实现 provider 网格与移动单列；样式严格跟随审批原型。
5. 保持 `selectValue` 的 once-only onChange 和现有 fallback/disabled 行为。
6. 只在必要时调整 ChatInput/Settings 调用，不改变 option value 编码。

## 验证命令

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

启动开发服务器后按 `checks.md` 做浏览器验收；常规开发不要运行 `next build`。

## 评审与回滚

- 实现前门禁：HTML 原型及计划均有用户审批记录。
- 合并前门禁：lint/typecheck 通过，聊天与 Settings 入口均完成人工验收。
- 回滚：还原 `ModelSelect.tsx` 及本任务新增的 scoped CSS；无数据迁移。

## Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 1,
  "tasks": [
    {
      "id": "UI-01",
      "title": "生成并审批模型选择器 HTML 原型",
      "phase": "ui",
      "order": 1,
      "dependsOn": [],
      "files": [
        ".ypi/tasks/20260712-150737-将模型选择下拉窗改为按提供商分栏的弹窗选择器/model-selector-prototype.html",
        ".ypi/tasks/20260712-150737-将模型选择下拉窗改为按提供商分栏的弹窗选择器/ui.md"
      ],
      "instructions": "由 ui-designer 基于现有 ModelSelect、ChatInput、SettingsConfig 和项目 modal 视觉生成可交互 HTML 原型，覆盖桌面、移动、搜索、空态、策略栏、主题和键盘行为；提交用户审批。",
      "acceptance": [
        "交付真实 HTML 文件而非 Markdown 线框",
        "用户明确批准分栏语义、响应式布局和交互"
      ],
      "validation": ["在浏览器打开原型并检查 1440px、768px、320px 视口"],
      "risks": ["分栏语义尚未由用户确认", "当前 architect 环境无法派发 ui-designer"],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "IMP-01",
      "title": "重构共享 ModelSelect 为 provider 分栏模态",
      "phase": "implement",
      "order": 2,
      "dependsOn": ["UI-01"],
      "files": ["components/ModelSelect.tsx", "app/globals.css"],
      "instructions": "按审批原型将锚定下拉改为 viewport modal；实现 provider 分栏、搜索、当前态、响应式、portal、focus trap、focus restore、Escape/backdrop close 和 scroll lock。保留公开 props 与 value/onChange 语义。",
      "acceptance": [
        "搜索与分栏使用同一过滤结果顺序",
        "所有关闭路径不修改值且恢复焦点",
        "移动端无横向溢出"
      ],
      "validation": ["npm run lint", "node_modules/.bin/tsc --noEmit", "浏览器键盘和响应式检查"],
      "risks": ["嵌套 Settings modal 的焦点和滚动锁冲突", "过滤后高亮索引错位"],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "IMP-02",
      "title": "验证并最小适配聊天与 Settings 调用方",
      "phase": "implement",
      "order": 3,
      "dependsOn": ["IMP-01"],
      "files": ["components/ChatInput.tsx", "components/SettingsConfig.tsx"],
      "instructions": "确认聊天 compact selector、streaming disabled、fallback model 与 Settings 模型策略栏均兼容；仅在必要时做最小调用参数或标签适配，不改变 provider/modelId 编码。",
      "acceptance": [
        "聊天选择仍传递精确 provider + modelId",
        "Settings 特殊策略和具体模型保存后可还原",
        "共享调用方无额外业务分叉"
      ],
      "validation": ["npm run lint", "node_modules/.bin/tsc --noEmit", "人工检查 ChatInput 与至少三个 Settings 模型字段"],
      "risks": ["只验证聊天而遗漏 Settings 多入口"],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "CHK-01",
      "title": "执行模型选择器质量与回归检查",
      "phase": "checks",
      "order": 4,
      "dependsOn": ["IMP-02"],
      "files": ["checks.md", "components/ModelSelect.tsx", "components/ChatInput.tsx", "components/SettingsConfig.tsx"],
      "instructions": "执行静态检查和 checks.md 全部人工验收，重点覆盖搜索字段、键盘顺序、嵌套 modal、主题、缩放和 320px 视口。",
      "acceptance": ["lint 与 typecheck 通过", "checks.md 人工项有结果记录", "无阻塞级回归"],
      "validation": ["npm run lint", "node_modules/.bin/tsc --noEmit", "浏览器人工验收"],
      "risks": ["仓库缺少通用前端自动测试框架"],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "REV-01",
      "title": "独立评审共享选择器改动",
      "phase": "review",
      "order": 5,
      "dependsOn": ["CHK-01"],
      "files": ["components/ModelSelect.tsx", "app/globals.css", "checks.md"],
      "instructions": "检查员基于审批原型、PRD 和 Design 评审行为回归、可访问性、cleanup、滚动与 z-index 风险；阻塞项退回实现。",
      "acceptance": ["原型与实现一致", "无未处理 blocker/high finding", "验证证据完整"],
      "validation": ["审阅 git diff", "复核 checks.md 证据"],
      "risks": ["视觉实现偏离尚未记录的原型决策"],
      "parallelizable": false,
      "localReview": true
    }
  ]
}
```
