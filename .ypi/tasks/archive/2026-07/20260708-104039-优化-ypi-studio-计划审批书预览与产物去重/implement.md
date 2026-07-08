# Implement — 执行规划

> 本文件只提供实现计划。当前任务仍停留在 planning；必须先由 UI 设计员产出 HTML 原型并经用户确认，主会话再保存 implementationPlan、进入 `awaiting_approval`，用户明确批准后才能实现。

## 执行步骤

| ID | 阶段 | 标题 | 主要文件 | 可并行 | 本地评审 |
| --- | --- | --- | --- | --- | --- |
| plan-review-contract | backend | 增加计划审批书 artifact 与 awaiting 校验 | `lib/ypi-studio-tasks.ts`, `lib/ypi-studio-workflows.ts`, `lib/ypi-studio-extension.ts`, `lib/ypi-studio-types.ts` | 否 | 是 |
| task-file-preview | api/security | 设计并实现任务目录相对文件解析/预览 | `app/api/studio/tasks/[taskKey]/files/route.ts`, `lib/ypi-studio-tasks.ts`, `docs/modules/api.md` | 是 | 是 |
| markdown-link-handler | frontend | 为审批书 Markdown 增加受控链接点击能力 | `components/MarkdownBody.tsx`, `components/YpiStudioPanel.tsx` | 是 | 是 |
| approval-tab-ui | frontend | 新增任务详情审批书 Tab | `components/YpiStudioPanel.tsx`, `components/FileViewer.tsx` | 否 | 是 |
| artifacts-dedupe | frontend | 重构 TaskArtifactsTab 去重/排序/完成状态 | `components/YpiStudioPanel.tsx` | 是 | 是 |
| docs-tests | validation | 补充文档与回归验证 | `docs/modules/api.md`, `docs/modules/frontend.md`, `docs/modules/library.md`, tests/scripts as needed | 否 | 是 |

## 需先阅读的文件

- `docs/architecture/overview.md`
- `docs/modules/api.md`
- `docs/modules/frontend.md`
- `docs/modules/library.md`
- `components/YpiStudioPanel.tsx`
- `components/MarkdownBody.tsx`
- `components/FileViewer.tsx`
- `lib/ypi-studio-tasks.ts`
- `lib/ypi-studio-workflows.ts`
- `lib/ypi-studio-extension.ts`
- `app/api/studio/tasks/[taskKey]/route.ts`
- `app/api/files/[...path]/route.ts`

## 关键改动点

1. **计划审批书契约**
   - `DEFAULT_ARTIFACTS` 添加 `plan-review: "plan-review.md"`。
   - workflow `planning` / `awaiting_approval` requiredArtifacts 添加 `plan-review.md`。
   - awaiting transition 阻止空/TBD `plan-review.md`。
   - prompt/extension 明确架构师必须生成该文件。

2. **审批 Tab**
   - 新增 `TaskDetailTab = "approval"`。
   - `TaskApprovalTab` 优先读取 `task.documents["plan-review"]` 或 resolve 到 `plan-review.md`。
   - status 为 `awaiting_approval` 时默认/突出展示审批 Tab。
   - 展示 approvalGate/approvalGrant 状态，但不提供绕过按钮。

3. **Markdown 链接解析**
   - 仅审批书预览启用 link handler。
   - 客户端拒绝明显非法 href；服务端 preview route 做最终边界校验。
   - `.html` 优先预览，其他文件走 FileViewer。

4. **产物去重**
   - 把现有 `new Set([...Object.values, ...required, ...optional, ...Object.keys, ...documents])` 替换为 `buildStudioArtifactItems(task)`。
   - canonical 去重键使用 fileName，合并 key/fileName/document/progress refs。
   - 排序固定：plan-review -> required -> optional -> mapping -> documents。

5. **文档与测试**
   - 更新 API/frontend/library docs。
   - 增加最小纯函数测试或脚本覆盖 artifact resolve/dedupe 与链接安全解析。
   - 手工验证 UI 原型审批、Markdown 链接、HTML 预览、approval gate。

## 验证命令

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

如增加测试脚本，补充运行对应命令（例如 `npm run test:studio-artifacts`）。

## 检查门禁

- UI 设计员 HTML 原型已产出并被用户确认。
- `plan-review.md` 已在任务详情审批 Tab 可读。
- `awaiting_approval -> implementing` 仍要求当前 context 的显式 approvalGrant。
- 非法相对链接不会打开任务目录外文件。
- Artifacts Tab 不再重复显示同一文件。

## Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "title": "优化 YPI Studio 计划审批书预览与产物去重",
  "maxConcurrency": 2,
  "scheduler": {
    "mode": "dag",
    "strategy": "ready_fifo",
    "defaultFailurePolicy": "block_dependents"
  },
  "execution": {
    "mode": "mixed",
    "maxParallel": 2,
    "groups": [
      {
        "id": "g1-contract",
        "title": "计划审批书契约与门禁",
        "relation": "serial",
        "dependencies": [],
        "subtaskIds": ["plan-review-contract"]
      },
      {
        "id": "g2-preview-ui",
        "title": "预览能力与前端入口",
        "relation": "parallel",
        "dependencies": ["plan-review-contract"],
        "subtaskIds": ["task-file-preview", "markdown-link-handler", "artifacts-dedupe"]
      },
      {
        "id": "g3-approval-tab",
        "title": "审批书 Tab 集成",
        "relation": "serial",
        "dependencies": ["task-file-preview", "markdown-link-handler", "artifacts-dedupe"],
        "subtaskIds": ["approval-tab-ui"]
      },
      {
        "id": "g4-validation",
        "title": "文档、验证与回归",
        "relation": "serial",
        "dependencies": ["approval-tab-ui"],
        "subtaskIds": ["docs-tests"]
      }
    ]
  },
  "subtasks": [
    {
      "id": "plan-review-contract",
      "title": "增加 plan-review.md 标准 artifact 与 awaiting 校验",
      "phase": "backend",
      "order": 1,
      "dependsOn": [],
      "relation": "serial",
      "member": "implementer",
      "files": [
        "lib/ypi-studio-tasks.ts",
        "lib/ypi-studio-workflows.ts",
        "lib/ypi-studio-extension.ts",
        "lib/ypi-studio-types.ts"
      ],
      "instructions": [
        "将 plan-review 映射到 plan-review.md，并保证新任务创建占位文件。",
        "兼容旧任务：读取/更新时可补齐默认 artifact 映射，但不要破坏归档任务读取。",
        "在转入 awaiting_approval 前校验 plan-review.md 非空且非 TBD。",
        "更新 workflow instruction 和 Studio prompt，要求架构师生成计划审批书；UI 变化仍必须等待 UI designer HTML 原型。"
      ],
      "acceptance": [
        "新建任务包含 plan-review.md。",
        "缺失或 TBD 的 plan-review.md 不能进入 awaiting_approval。",
        "approvalGate/approvalGrant 行为未改变。"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "旧任务可能显示新增缺失产物；只在审批相关状态重点提示。",
        "校验过严可能阻塞非 UI 任务；只强制计划审批书本身，不强制 HTML。"
      ],
      "parallelizable": false,
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "task-file-preview",
      "title": "实现任务目录相对文件安全解析与 HTML 预览 route",
      "phase": "api-security",
      "order": 2,
      "dependsOn": ["plan-review-contract"],
      "relation": "parallel",
      "member": "implementer",
      "files": [
        "app/api/studio/tasks/[taskKey]/files/route.ts",
        "lib/ypi-studio-tasks.ts",
        "docs/modules/api.md"
      ],
      "instructions": [
        "新增或复用 helper 根据 taskKey + cwd 定位任务目录，并解析相对 path。",
        "拒绝 URL scheme、绝对路径、.. 逃逸、空路径和符号链接逃逸。",
        "提供 read/meta/preview 能力；HTML preview 使用 CSP sandbox，禁止外部资源、表单和顶层跳转。",
        "客户端校验只做体验，服务端 route 是安全边界。"
      ],
      "acceptance": [
        "合法 ./ui-prototype.html 可预览。",
        "../task.json、/etc/passwd、https://example.com、javascript:alert(1) 均被拒绝。",
        "API 文档记录新增 route。"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "手工 curl 合法/非法 path"
      ],
      "risks": [
        "HTML 原型可能依赖外链资源；首版应要求自包含 HTML。",
        "CSP 过严可能影响原型脚本；可在 UI 原型规范中要求静态自包含。"
      ],
      "parallelizable": true,
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "markdown-link-handler",
      "title": "为审批书 Markdown 增加受控链接处理",
      "phase": "frontend",
      "order": 3,
      "dependsOn": ["plan-review-contract"],
      "relation": "parallel",
      "member": "implementer",
      "files": [
        "components/MarkdownBody.tsx",
        "components/YpiStudioPanel.tsx"
      ],
      "instructions": [
        "给 MarkdownBody 增加可选 link override，默认行为保持不变。",
        "只在 TaskApprovalTab 中启用相对链接拦截。",
        "实现客户端 normalize/reject 逻辑并显示非法链接提示。",
        "点击合法文件时调用 onOpenFile 或 HTML preview route。"
      ],
      "acceptance": [
        "Chat Markdown 不受影响。",
        "计划审批书内相对链接可点击打开。",
        "非法链接不会导航当前页面。"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "浏览器手工点击合法/非法链接"
      ],
      "risks": [
        "ReactMarkdown component typing 需保持兼容。"
      ],
      "parallelizable": true,
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "artifacts-dedupe",
      "title": "重构 TaskArtifactsTab canonical 去重与排序",
      "phase": "frontend",
      "order": 4,
      "dependsOn": ["plan-review-contract"],
      "relation": "parallel",
      "member": "implementer",
      "files": [
        "components/YpiStudioPanel.tsx"
      ],
      "instructions": [
        "用 buildStudioArtifactItems(task) 替换当前 new Set 聚合。",
        "按 fileName canonical 去重，合并 key/fileName/required/document 来源。",
        "排序采用 plan-review -> required -> optional -> mapping -> documents。",
        "完成状态与必需/可选状态基于 normalized refs 计算。"
      ],
      "acceptance": [
        "prd 与 prd.md 只出现一次。",
        "plan-review.md 显示在最前。",
        "completed/required/optional badge 正确。"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "手工打开当前任务 Artifacts Tab 检查无重复"
      ],
      "risks": [
        "对象枚举顺序差异导致排序抖动；需要显式 order。"
      ],
      "parallelizable": true,
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "approval-tab-ui",
      "title": "新增任务详情审批书 Tab 并集成预览交互",
      "phase": "frontend",
      "order": 5,
      "dependsOn": ["task-file-preview", "markdown-link-handler", "artifacts-dedupe"],
      "relation": "serial",
      "member": "implementer",
      "files": [
        "components/YpiStudioPanel.tsx",
        "components/FileViewer.tsx",
        "docs/modules/frontend.md"
      ],
      "instructions": [
        "按已批准 HTML 原型实现审批书 Tab。",
        "awaiting_approval 任务默认突出审批书入口，缺失时显示补齐提示。",
        "展示 approvalGate/approvalGrant 状态，明确预览不等于批准。",
        "HTML 原型链接优先打开预览；其他文件使用 FileViewer。"
      ],
      "acceptance": [
        "用户在任务详情可直接审阅计划审批书。",
        "缺失 plan-review.md 时空状态可理解。",
        "审批 Tab 不会授予实现权限。"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "浏览器手工验收 UI 原型中的主要状态"
      ],
      "risks": [
        "未获 UI 原型审批不得执行该子任务。",
        "默认选中审批 Tab 需避免打断用户已有 tab 状态。"
      ],
      "parallelizable": false,
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    },
    {
      "id": "docs-tests",
      "title": "更新文档并完成自动/手工验证",
      "phase": "validation",
      "order": 6,
      "dependsOn": ["approval-tab-ui"],
      "relation": "serial",
      "member": "implementer",
      "files": [
        "docs/modules/api.md",
        "docs/modules/frontend.md",
        "docs/modules/library.md",
        "docs/architecture/overview.md",
        "scripts/test-ypi-studio-artifacts.mjs"
      ],
      "instructions": [
        "更新模块文档描述 plan-review、审批 Tab、task file preview route 和 artifacts 去重。",
        "如新增测试脚本，覆盖 artifact canonical resolve 与相对链接安全解析。",
        "运行 lint、tsc 和新增测试。",
        "整理手工验收记录。"
      ],
      "acceptance": [
        "文档与实现一致。",
        "自动验证通过。",
        "手工验证覆盖 awaiting_approval、HTML 原型链接、非法链接、产物去重。"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "npm run test:studio-artifacts（如新增）"
      ],
      "risks": [
        "测试脚本名称需同步 package.json/standards 文档。"
      ],
      "parallelizable": false,
      "localReview": {
        "required": true,
        "reviewer": "checker"
      }
    }
  ]
}
```
