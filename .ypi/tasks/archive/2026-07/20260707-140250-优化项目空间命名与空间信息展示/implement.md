# implement

## 执行顺序

1. 修改 Sidebar 空间展示 helper：主空间默认名、顶部副标题、WorkTree badge tooltip。
2. 如确认要展示创建时基准，补充 `baseRef` 可选字段并在 WorkTree 创建链路持久化。
3. 更新受影响文档。
4. 跑 lint/type-check 并做手工 UI 验收。

## 需先阅读的文件

- `components/SessionSidebar.tsx`
- `lib/project-registry-types.ts`
- `lib/project-registry.ts`
- `lib/git-worktree.ts`
- `lib/types.ts`
- `lib/workspace-title.ts`
- `app/api/git/worktrees/route.ts`
- `docs/modules/frontend.md`
- `docs/modules/library.md`
- `docs/architecture/overview.md`

## Implementation Plan

| id | phase | title | dependsOn | files |
| --- | --- | --- | --- | --- |
| PS-01 | frontend | 主空间中文 fallback 与空间信息格式化 | - | `components/SessionSidebar.tsx` |
| PS-02 | frontend | WorkTree badge/dropdown tooltip 补充分支与基准 | PS-01 | `components/SessionSidebar.tsx` |
| PS-03 | data | 可选持久化 WorkTree 创建 baseRef | PS-01 | `lib/project-registry-types.ts`, `lib/project-registry.ts`, `lib/git-worktree.ts`, `lib/types.ts`, `app/api/git/worktrees/route.ts` |
| PS-04 | docs | 同步架构/模块文档 | PS-01, PS-03 | `docs/architecture/overview.md`, `docs/modules/frontend.md`, `docs/modules/library.md`, `docs/modules/api.md` |
| PS-05 | checks | 自动与手工验证 | PS-01, PS-02, PS-03, PS-04 | n/a |

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "subtasks": [
    {
      "id": "PS-01",
      "title": "主空间中文 fallback 与顶部空间信息格式化",
      "phase": "frontend",
      "order": 1,
      "dependsOn": [],
      "files": ["components/SessionSidebar.tsx"],
      "instructions": "将 displaySpaceName 的 main fallback 改为 主空间；新增纯格式化 helper，顶部副标题展示 空间：<name> + 分支/WorkTree/基准信息，detail/tooltip 保留完整路径与状态。不要修改 spaceId。",
      "acceptance": ["main space 默认显示为 主空间", "顶部信息包含空间名和 Git/WorkTree 状态", "非 Git/缺失状态有明确兜底文案"],
      "validation": ["npm run lint", "node_modules/.bin/tsc --noEmit", "手工选择 main 空间、非 Git 空间验证文案"],
      "risks": ["旧 displayName=Main 是否需要覆盖需产品确认", "顶部一行信息过密需用省略和 tooltip 控制"],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "PS-02",
      "title": "WorkTree badge/dropdown tooltip 补充分支与基准",
      "phase": "frontend",
      "order": 2,
      "dependsOn": ["PS-01"],
      "files": ["components/SessionSidebar.tsx"],
      "instructions": "增强 WorktreeBadge title，显示 WorkTree 分支与基准/来源；空间列表仍保持一行，主信息放顶部和 tooltip。",
      "acceptance": ["WorkTree badge tooltip 可看到 branch 与 base/unknown", "列表行不明显增高或撑破布局"],
      "validation": ["手工打开空间下拉并 hover WorkTree badge"],
      "risks": ["过长分支名需省略显示"],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "PS-03",
      "title": "可选持久化 WorkTree 创建 baseRef",
      "phase": "data",
      "order": 3,
      "dependsOn": ["PS-01"],
      "files": ["lib/project-registry-types.ts", "lib/project-registry.ts", "lib/git-worktree.ts", "lib/types.ts", "app/api/git/worktrees/route.ts"],
      "instructions": "在 worktree metadata 中增加可选 baseRef；创建 WorkTree 后将 result.baseRef 写入 registry；刷新发现 worktree 时保留已有 baseRef，旧/外部 worktree 没有 baseRef 时 UI 走 mainWorktreeBranch/unknown 兜底。若主会话决定不扩数据结构，此子任务可跳过。",
      "acceptance": ["新建 WorkTree registry space 含 baseRef", "刷新项目 worktree 不丢 baseRef", "旧 registry 无 baseRef 仍能显示"],
      "validation": ["npm run lint", "node_modules/.bin/tsc --noEmit", "创建 WorkTree 后检查 /api/projects 返回的 space.worktree.baseRef"],
      "risks": ["Git 无法恢复旧 WorkTree 创建来源", "字段新增需同步所有类型消费者"],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "PS-04",
      "title": "同步文档",
      "phase": "docs",
      "order": 4,
      "dependsOn": ["PS-01", "PS-03"],
      "files": ["docs/modules/frontend.md", "docs/modules/library.md", "docs/modules/api.md", "docs/architecture/overview.md"],
      "instructions": "根据实际代码改动更新 SessionSidebar 展示说明、Project Registry worktree metadata 说明；若未新增 API/字段，可只更新 frontend 文档。",
      "acceptance": ["文档描述与最终实现一致"],
      "validation": ["人工 review docs diff"],
      "risks": ["文档过度承诺 baseRef 对旧 WorkTree 的准确性"],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "PS-05",
      "title": "验证与回归检查",
      "phase": "checks",
      "order": 5,
      "dependsOn": ["PS-01", "PS-02", "PS-03", "PS-04"],
      "files": [],
      "instructions": "执行 lint/type-check；手工验证主空间、普通 Git 分支、WorkTree、有/无基准、missing path、长分支名省略。",
      "acceptance": ["lint/type-check 通过", "所有目标场景文案符合 ui.md"],
      "validation": ["npm run lint", "node_modules/.bin/tsc --noEmit"],
      "risks": ["需要本地 Git WorkTree 场景才能完整手工验证"],
      "parallelizable": false,
      "localReview": true
    }
  ]
}
```

## 建议验证命令

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

如新增/调整 WorkTree metadata，补充手工或临时 API 验证：

```bash
# 启动 dev 后检查项目空间返回
curl -s 'http://localhost:30141/api/projects' | jq '.projects[].spaces'
```
