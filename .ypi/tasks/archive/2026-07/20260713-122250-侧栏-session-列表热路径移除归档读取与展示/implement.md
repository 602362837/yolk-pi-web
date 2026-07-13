# Implement：侧栏归档热路径剥离

## 需先阅读

- `AGENTS.md`
- `docs/architecture/overview.md`
- `docs/modules/api.md`
- `docs/modules/frontend.md`
- `docs/standards/code-style.md`
- `components/SessionSidebar.tsx`
- `app/api/projects/[projectId]/spaces/[spaceId]/sessions/route.ts`
- `app/api/sessions/route.ts`
- `app/api/sessions/archived/route.ts`
- `lib/session-reader.ts` 中 archive helpers
- `lib/usage-stats.ts` 的 includeArchived 路径
- 本任务获批的 `session-sidebar-without-archive-prototype.html`、`prd.md`、`design.md`、`checks.md`

## 人类可读子任务表

| ID | 阶段 | 子任务 | 依赖 | 主要文件 | 可并行 |
| --- | --- | --- | --- | --- | --- |
| UI-01 | UI | UI designer 交付侧栏去归档 HTML 原型并取得用户审批 | 无 | task artifacts | 否 |
| API-01 | Implement | project-space active route 移除 archive scan/字段/timing | UI-01 | project-space sessions route | 是 |
| API-02 | Implement | global sessions route 移除无人消费 archive 字段与扫描 | UI-01 | global sessions route | 是 |
| FE-01 | Implement | Sidebar 删除归档展示/状态/请求，保留 active 归档动作 | UI-01 | `SessionSidebar.tsx` | 是 |
| DOC-01 | Implement | 同步 API、Frontend、Architecture 文档 | API-01, API-02, FE-01 | docs | 否 |
| CHK-01 | Checks | 静态检查、检索、API/浏览器 smoke | DOC-01 | diff + runtime | 否 |
| REV-01 | Review | 独立检查范围、性能边界与归档能力回归 | CHK-01 | diff + checks | 否 |

## 执行要点

1. 先完成 UI 原型和用户审批，不允许实现员自行解释为免门禁。
2. API-01 删除 `scanArchivedCwds` import、archive timing/count 和 `archivedCounts` body 字段；不触碰 active list/filter。
3. API-02 将 `/api/sessions` 响应收敛为 `{ sessions }`；确认 `bin/ypic.js` 仍只读取 `sessions`。
4. FE-01 一次性删除 archived state、loader、effect、handler、区块和 `ArchivedSessionItem`，避免半删除残留。
5. 归档成功路径统一只 `loadSessions(false)`；archive-all 数量只用 active `filteredSessions.length`。
6. 不修改 `lib/session-reader.ts` archive helpers、archive routes、Usage 实现，除非为修复直接类型/导入错误且先上报范围原因。
7. 文档明确 global API 响应字段删除和 active 全量扫描仍存在。

## 验证命令

```bash
npm run lint
node_modules/.bin/tsc --noEmit
rg -n "archivedCounts|archivedCwds|archivedSessions|archivedExpanded|loadArchivedSessions|ArchivedSessionItem" components/SessionSidebar.tsx app/api/projects app/api/sessions/route.ts
rg -n "/api/sessions/archived" components hooks app
```

首个 `rg` 预期在目标热路径文件无命中；第二个只允许保留服务端 archived route/文档等显式能力，不允许 Sidebar 调用。

按 `checks.md` 启动 dev server 做浏览器 smoke。常规开发不要运行 `next build`。

## 评审门禁与回滚

- 实现前：HTML 原型和 `plan-review.md` 均有用户明确审批。
- 实现后：lint/typecheck、Network smoke 和 archive 能力边界检查通过。
- 检查员需确认没有顺手重构 active inventory/index。
- 回滚仅恢复相关 route/Sidebar/docs；无数据迁移或归档文件回滚。

## Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 1,
  "tasks": [
    {
      "id": "UI-01",
      "title": "生成并审批侧栏去归档 HTML 原型",
      "phase": "ui",
      "order": 1,
      "dependsOn": [],
      "files": [
        ".ypi/tasks/20260713-122250-侧栏-session-列表热路径移除归档读取与展示/session-sidebar-without-archive-prototype.html",
        ".ypi/tasks/20260713-122250-侧栏-session-列表热路径移除归档读取与展示/ui.md",
        ".ypi/tasks/20260713-122250-侧栏-session-列表热路径移除归档读取与展示/plan-review.md"
      ],
      "instructions": "由 ui-designer 基于现有 SessionSidebar 样式交付可运行 HTML 原型，展示 active 列表与归档按钮不变、归档区块消失、active 空态和 archive-all active-only 计数；提交用户审批。",
      "acceptance": [
        "存在真实 HTML 文件而非纯 Markdown 线框",
        "原型覆盖正常、空态、归档操作与窄侧栏",
        "用户明确批准原型和计划"
      ],
      "validation": [
        "在浏览器打开原型检查浅色/深色和窄侧栏",
        "确认 ui.md 与 plan-review.md 使用相对链接指向原型"
      ],
      "risks": [
        "当前 architect 子会话没有 Studio 派发工具",
        "删除恢复入口必须在审批时明确"
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "API-01",
      "title": "移除 project-space sessions 热路径归档扫描",
      "phase": "implement",
      "order": 2,
      "dependsOn": ["UI-01"],
      "files": [
        "app/api/projects/[projectId]/spaces/[spaceId]/sessions/route.ts"
      ],
      "instructions": "删除 scanArchivedCwds import、archive timing/count/pathKey 汇总和 archivedCounts 响应字段；保持 active list、legacy、Studio child、timing 日志其他阶段不变。",
      "acceptance": [
        "route 不调用 scanArchivedCwds",
        "响应不含 archivedCounts",
        "active/legacy/Studio child 契约保持"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "curl project-space route 并检查响应字段"
      ],
      "risks": [
        "误改 active listAllSessions 路径",
        "遗留 archive timing 文档或计数"
      ],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "API-02",
      "title": "收敛 global sessions 响应并移除归档扫描",
      "phase": "implement",
      "order": 3,
      "dependsOn": ["UI-01"],
      "files": [
        "app/api/sessions/route.ts",
        "bin/ypic.js"
      ],
      "instructions": "删除 global GET /api/sessions 对 scanArchivedCwds 的调用及 archivedCwds/archivedCounts 字段；只在必要时验证而不改动 ypic，因为它只消费 sessions。",
      "acceptance": [
        "GET /api/sessions 返回 sessions 且不扫描 archive",
        "includeGit/includeStudioChildren 保持",
        "ypic recent-session 查找兼容"
      ],
      "validation": [
        "仓库搜索 archivedCwds/archivedCounts 消费方",
        "curl /api/sessions",
        "npm run lint",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "未记录外部客户端依赖已删除字段"
      ],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "FE-01",
      "title": "删除 Sidebar 归档展示与读取状态",
      "phase": "implement",
      "order": 4,
      "dependsOn": ["UI-01"],
      "files": [
        "components/SessionSidebar.tsx"
      ],
      "instructions": "删除 archivedCounts/archivedCwds/archivedSessions/archivedExpanded、loadArchivedSessions、unarchive handler、展开 effect、归档区块与 ArchivedSessionItem；归档成功仅刷新 active；空态只看 active；archive-all 只计 active。",
      "acceptance": [
        "侧栏无已归档区块和 /api/sessions/archived 请求",
        "单个/批量/全部归档入口保留",
        "归档后 active row 消失且列表刷新",
        "空态与 archive-all 数量正确"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "rg archived state/loader/component",
        "浏览器 Network 和交互 smoke"
      ],
      "risks": [
        "删除 ArchivedSessionItem 时误伤 active SessionTreeItem",
        "archive-all 文案仍暗示已有归档计数"
      ],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "DOC-01",
      "title": "同步归档热路径与侧栏文档",
      "phase": "implement",
      "order": 5,
      "dependsOn": ["API-01", "API-02", "FE-01"],
      "files": [
        "docs/modules/frontend.md",
        "docs/modules/api.md",
        "docs/architecture/overview.md"
      ],
      "instructions": "更新 SessionSidebar、两个 list API、Session List Performance 和 Archive path 描述；保留 archive API/storage/Usage 能力并注明 active 全量扫描仍未重构。",
      "acceptance": [
        "文档不再声称 Sidebar/picker 消费 archive counts",
        "文档保留显式归档能力说明",
        "性能边界诚实"
      ],
      "validation": [
        "rg archivedCwds archivedCounts docs/modules docs/architecture/overview.md",
        "人工对照实际响应和组件"
      ],
      "risks": [
        "历史 research 文档被误当现行契约；无需重写归档研究档案"
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "CHK-01",
      "title": "执行归档热路径与回归检查",
      "phase": "checks",
      "order": 6,
      "dependsOn": ["DOC-01"],
      "files": [
        "checks.md",
        "components/SessionSidebar.tsx",
        "app/api/projects/[projectId]/spaces/[spaceId]/sessions/route.ts",
        "app/api/sessions/route.ts"
      ],
      "instructions": "执行静态检查、目标符号检索、API shape 检查和浏览器 smoke；重点确认 Network 零 archived 请求以及 Usage/显式 archive API 未改。",
      "acceptance": [
        "lint 与 typecheck 通过",
        "手工 smoke 有记录",
        "无 blocker/high 回归"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "checks.md 全项"
      ],
      "risks": [
        "仅依赖静态检查会遗漏浏览器 Network 行为"
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "REV-01",
      "title": "独立评审范围与归档能力边界",
      "phase": "review",
      "order": 7,
      "dependsOn": ["CHK-01"],
      "files": [
        "components/SessionSidebar.tsx",
        "app/api/projects/[projectId]/spaces/[spaceId]/sessions/route.ts",
        "app/api/sessions/route.ts",
        "docs/modules/frontend.md",
        "docs/modules/api.md",
        "docs/architecture/overview.md",
        "checks.md"
      ],
      "instructions": "检查员对照批准原型、PRD 和 Design 审查：archive scan 是否完全脱离侧栏热路径、active 行为是否保持、archive/Usage 底层是否未误伤、global API 兼容风险是否记录。",
      "acceptance": [
        "实现与审批原型一致",
        "无未处理 blocker/high finding",
        "验证和性能边界说明完整"
      ],
      "validation": [
        "审阅 git diff",
        "复核 checks.md 与浏览器/API 证据"
      ],
      "risks": [
        "将 active 全量扫描既有问题误判为本任务失败或顺手扩 scope"
      ],
      "parallelizable": false,
      "localReview": true
    }
  ]
}
```
