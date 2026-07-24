# Implement：project-space session index

## 先阅读

- `AGENTS.md`
- `docs/architecture/overview.md`（Project Registry、Session files、inventory contract）
- `docs/modules/api.md`（project-space sessions、archive、Studio child routes）
- `docs/modules/library.md`（registry、session reader/scanner、旧index、Studio task）
- `docs/modules/frontend.md`（SessionSidebar现有请求/显示契约）
- `docs/standards/code-style.md`
- `app/api/projects/[projectId]/spaces/[spaceId]/sessions/route.ts`
- `lib/project-registry.ts`、`lib/project-registry-types.ts`
- `lib/project-session-index.ts`
- `lib/session-reader.ts`、`lib/session-metadata-scanner.ts`、`lib/session-header-metadata.ts`
- `lib/agent-session-bootstrap.ts`、`lib/rpc-manager.ts`
- `lib/ypi-studio-child-session-runner.ts`、`lib/studio-child-session-list.ts`
- session rename/archive/unarchive/delete/WorkTree cleanup routes

## 人类可读子任务表

| ID | Phase | Order | 内容 | Depends on | 可并行 |
| --- | --- | ---: | --- | --- | --- |
| PSI-01 | foundation | 1 | 本地space index schema、路径、ignore、原子并发store | - | 否 |
| PSI-02 | query | 2 | 定向cwd候选、文件校验、摘要复用、完整恢复与migration | PSI-01 | 是 |
| PSI-03 | lifecycle | 2 | create/fork/Studio child/rename/archive/delete/relink维护 | PSI-01 | 是 |
| PSI-04 | projection | 3 | Studio child筛选后batch projection与task cache | PSI-02 | 是（与PSI-03可并行） |
| PSI-05 | integration | 4 | route接入、缓存失效、错误/timing/API等价 | PSI-02, PSI-03, PSI-04 | 否 |
| PSI-06 | verification | 5 | focused tests、300/180 benchmark、设置/模型并发基准 | PSI-05 | 否 |
| PSI-07 | docs | 6 | 架构/API/library文档与回滚说明 | PSI-06 | 否 |

## 执行顺序

1. 先建立新store和安全测试，不直接改route。
2. PSI-02与PSI-03可由两个实现员并行：查询侧不能假设所有mutation已覆盖；生命周期侧不能把index当JSONL事务。
3. PSI-04只处理已筛入当前space的child，不先改Sidebar语义。
4. PSI-05一次性切换project-space route，保留feature flag/单一回滚入口。
5. PSI-06没有通过“损坏不漏项”和性能门禁前，不进入文档收尾/检查。
6. 任何用户可见loading/stale/partial/child结构改动必须停止并补UI HTML原型审批。

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "sourceArtifact": "implement.md",
  "summary": "为每个Project Registry space建立自身根目录下的候选索引，project-space列表改用定向校验和安全恢复，并在筛选后批量投影Studio child；不移动JSONL、不改UI。",
  "strategy": "先建立安全且可恢复的space-local store，再并行完成读路径和mutation维护，之后接入route并用完整性/性能fixture验收。",
  "maxConcurrency": 2,
  "scheduler": {
    "mode": "dag",
    "strategy": "ready_fifo",
    "failFast": true,
    "defaultFailurePolicy": "block_dependents"
  },
  "execution": {
    "mode": "mixed",
    "maxParallel": 2,
    "groups": [
      {
        "id": "G1",
        "title": "索引基础",
        "relation": "serial",
        "subtaskIds": ["PSI-01"]
      },
      {
        "id": "G2",
        "title": "查询与生命周期",
        "relation": "parallel",
        "dependencies": ["G1"],
        "subtaskIds": ["PSI-02", "PSI-03"]
      },
      {
        "id": "G3",
        "title": "Studio投影",
        "relation": "serial",
        "dependencies": ["G2"],
        "subtaskIds": ["PSI-04"]
      },
      {
        "id": "G4",
        "title": "接入与验证",
        "relation": "serial",
        "dependencies": ["G3"],
        "subtaskIds": ["PSI-05", "PSI-06", "PSI-07"]
      }
    ]
  },
  "subtasks": [
    {
      "id": "PSI-01",
      "title": "实现space-local index基础设施",
      "phase": "foundation",
      "order": 1,
      "dependsOn": [],
      "relation": "serial",
      "files": [
        "lib/project-space-session-index.ts",
        "lib/project-session-index.ts",
        "lib/project-registry.ts",
        "lib/project-registry-types.ts",
        ".gitignore",
        "scripts/test-project-space-session-index.mjs",
        "package.json"
      ],
      "instructions": [
        "定义schema-v1及严格有界解析：top-level身份/coverage和entry的agentDir-relative sessionFile、cwdPathKey、fingerprint、摘要、parent及allowlisted studioChild pointer。",
        "由registry space.path/realPath/pathKey解析<space-root>/.ypi/sessions/index.v1.json；拒绝symlink/越界/身份不匹配。",
        "实现目录内.gitignore内容*、仓库精确/.ypi/sessions/规则与git check-ignore验证；绝不忽略整个.ypi。",
        "实现process queue、跨进程mkdir lock、lock-time merge、temp+rename和last-good保留；写失败不得损坏JSONL或旧index。",
        "保留旧lib/project-session-index.ts读取能力作为migration adapter，不将其作为新热路径。"
      ],
      "acceptance": [
        "main/worktree各自解析到自身根目录且身份隔离",
        "非法路径、symlink、archive路径、future/malformed schema fail closed",
        "并发upsert/remove不丢更新，失败保留上个有效文件",
        "index/tmp/lock被Git忽略而.ypi/tasks仍可跟踪"
      ],
      "validation": [
        "npm run test:project-space-session-index -- --group store",
        "临时Git仓库运行git status --short --ignored",
        "node_modules/.bin/tsc --noEmit"
      ],
      "risks": [
        "覆盖用户已有.ypi/sessions/.gitignore",
        "lock stale recovery误抢活进程",
        "pathKey与display path混用"
      ],
      "parallelizable": false,
      "member": "implementer",
      "priority": 100,
      "failurePolicy": "block_dependents",
      "retry": { "maxAttempts": 2 },
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "PSI-02",
      "title": "实现定向查询与完整恢复",
      "phase": "query",
      "order": 2,
      "dependsOn": ["PSI-01"],
      "relation": "parallel",
      "parallelGroup": "G2",
      "files": [
        "lib/project-space-session-list.ts",
        "lib/project-space-session-index.ts",
        "lib/session-metadata-scanner.ts",
        "lib/session-header-metadata.ts",
        "lib/session-reader.ts",
        "scripts/test-project-space-session-index.mjs"
      ],
      "instructions": [
        "实现listSessionsForProjectSpace：local entries与registry-known cwd/realPath encoded目录候选合并，只枚举目标space目录。",
        "每个候选执行active-root containment、regular-file stat、bounded header id/link校验；fingerprint未变复用摘要，变化仅scanSessionMetadata该文件。",
        "missing/corrupt/partial时合并旧global seed、directed scan和global header-only discovery；只为匹配文件扫描摘要。",
        "实现keyed single-flight、5s目标/10s硬预算：无last-good超时返回可重试错误，禁止partial 200；有last-good也必须重新校验文件/header。",
        "complete index超过5min仅触发后台低优先级header reconcile，不把全局扫描放回每次request主路径。"
      ],
      "acceptance": [
        "完整热index不调用scanSessionInventory/listAllSessions",
        "index缺失、损坏、部分覆盖不会静默漏合法session",
        "同cwd外部新文件由定向目录发现，legacy只在includeLegacy时返回",
        "并发恢复只运行一次且rejected promise可重试"
      ],
      "validation": [
        "npm run test:project-space-session-index -- --group query",
        "npm run test:project-space-session-index -- --group recovery",
        "受控I/O计数断言只重扫变化文件"
      ],
      "risks": [
        "复制SDK encoded-cwd规则后版本漂移",
        "header-only discovery仍被错误实现成全文件流扫描",
        "last-good包含已删除或改绑entry"
      ],
      "parallelizable": true,
      "member": "implementer",
      "priority": 90,
      "failurePolicy": "block_dependents",
      "retry": { "maxAttempts": 2 },
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "PSI-03",
      "title": "接入session生命周期维护",
      "phase": "lifecycle",
      "order": 2,
      "dependsOn": ["PSI-01"],
      "relation": "parallel",
      "parallelGroup": "G2",
      "files": [
        "lib/agent-session-bootstrap.ts",
        "lib/rpc-manager.ts",
        "lib/ypi-studio-child-session-runner.ts",
        "lib/session-project-link.ts",
        "lib/session-reader.ts",
        "app/api/sessions/[id]/route.ts",
        "app/api/sessions/archive/route.ts",
        "app/api/sessions/archive-all/route.ts",
        "app/api/sessions/unarchive/route.ts",
        "app/api/git/worktrees/route.ts",
        "app/api/git/worktrees/archive/route.ts"
      ],
      "instructions": [
        "将create/bootstrap、fork、Studio child header创建迁移到local upsert，停止新写旧global sidecar。",
        "为rename、archive、unarchive、delete、delete-by-cwd/WorkTree cleanup、cascade parent rewrite补remove/upsert/refresh/invalidate。",
        "把project-space header写收口为可复用relink helper：先header真相，再old remove/new upsert；失败由reconciliation修复，不回滚已成功JSONL。",
        "在message/agent end等已知摘要变化点失效space snapshot；stat fingerprint继续作为漏通知兜底。",
        "审计所有writeSessionProjectLink、unlink/rename session file调用方并补focused lifecycle tests。"
      ],
      "acceptance": [
        "所有已知本进程mutation后列表立即正确，不依赖TTL",
        "Studio child创建后进入对应space候选并保持parent关联",
        "archive index不含sessions-archive路径，unarchive按header恢复",
        "旧global sidecar不再新增写入但文件不删除"
      ],
      "validation": [
        "npm run test:project-space-session-index -- --group lifecycle",
        "npm run test:studio-child-sessions",
        "rg审计所有session写/移/删和writeSessionProjectLink调用"
      ],
      "risks": [
        "漏掉隐蔽mutation导致短暂陈旧",
        "删除/归档部分成功时index与API结果不一致",
        "child状态更新造成过度写放大"
      ],
      "parallelizable": true,
      "member": "implementer",
      "priority": 90,
      "failurePolicy": "block_dependents",
      "retry": { "maxAttempts": 2 },
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "PSI-04",
      "title": "实现筛选后的Studio批量投影",
      "phase": "projection",
      "order": 3,
      "dependsOn": ["PSI-02"],
      "relation": "serial",
      "files": [
        "lib/project-space-session-list.ts",
        "lib/session-reader.ts",
        "lib/studio-child-session-list.ts",
        "lib/session-title.ts",
        "scripts/test-project-space-session-index.mjs",
        "scripts/test-studio-child-sessions.mjs"
      ],
      "instructions": [
        "先筛当前space roots和parent可见children，再按cwdPathKey+taskId分组读取task detail。",
        "每个cwd的listYpiStudioTasks(scope:all) fallback最多一次；每个unique task detail最多一次。",
        "task detail可共享，但run/subtask-specific display逐child派生；cache key使用task.json mtime+size，TTL30s且有界single-flight。",
        "保持header-only subtaskId降级和现有studioChildrenByParentSessionId/child row语义。"
      ],
      "acceptance": [
        "全局180 children不再被当前space route投影",
        "studioProjectionCalls不超过目标space unique linked task数",
        "同task不同run/subtask标题与summary不串",
        "task读取失败不使session列表失败"
      ],
      "validation": [
        "npm run test:studio-child-sessions",
        "npm run test:session-title",
        "npm run test:project-space-session-index -- --group studio"
      ],
      "risks": [
        "只按taskId缓存导致不同cwd串任务",
        "持久化display造成task更新后陈旧",
        "遗漏parent可见门禁"
      ],
      "parallelizable": true,
      "member": "implementer",
      "priority": 80,
      "failurePolicy": "block_dependents",
      "retry": { "maxAttempts": 2 },
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "PSI-05",
      "title": "接入project-space route与缓存/timing契约",
      "phase": "integration",
      "order": 4,
      "dependsOn": ["PSI-02", "PSI-03", "PSI-04"],
      "relation": "barrier",
      "files": [
        "app/api/projects/[projectId]/spaces/[spaceId]/sessions/route.ts",
        "lib/project-space-session-list.ts",
        "lib/session-list-timing.ts",
        "lib/types.ts",
        "components/SessionSidebar.tsx"
      ],
      "instructions": [
        "route改用专用reader，成功body严格保持sessions/legacyUnassigned/studioChildrenByParentSessionId。",
        "增加5s有界snapshot、mutation失效和forceValidate；不重复修改Sidebar已存在AbortController/generation逻辑。",
        "恢复超预算映射为503 session_index_rebuilding + Retry-After，不把内部路径/候选投影到browser。",
        "扩展content-safe timing计数：index/read/validate/rescan/recovery/studio unique tasks/response，不记录标题、正文、路径或凭据。",
        "提供单一feature flag/reader开关作为代码回滚，不删除旧listAllSessions。"
      ],
      "acceptance": [
        "API success深度等价且Sidebar无需UI改动",
        "热request inventoryGlobalCalls=0",
        "known mutation后snapshot立即失效",
        "慢日志和503均满足隐私边界"
      ],
      "validation": [
        "npm run test:project-space-session-index -- --group route",
        "浏览器main/worktree切换及生命周期smoke",
        "检查Network响应与旧contract等价"
      ],
      "risks": [
        "feature flag两路径结果漂移",
        "snapshot隐藏刚完成mutation",
        "错误将恢复诊断暴露到API"
      ],
      "parallelizable": false,
      "member": "implementer",
      "priority": 70,
      "failurePolicy": "block_dependents",
      "retry": { "maxAttempts": 2 },
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "PSI-06",
      "title": "完成正确性、安全与性能基准",
      "phase": "verification",
      "order": 5,
      "dependsOn": ["PSI-05"],
      "relation": "serial",
      "files": [
        "scripts/test-project-space-session-index.mjs",
        "scripts/bench-project-space-sessions.mjs",
        "package.json",
        ".ypi/tasks/20260724-090218-排查并优化-session-列表与相关入口的加载性能-项目-设置-模型/checks.md"
      ],
      "instructions": [
        "实现约300 sessions/180 Studio children固定fixture，覆盖目标space 1/22/100 candidates及missing/corrupt/partial/alias/lock竞态。",
        "采样cold/warm P50/P95、I/O计数、Studio unique task calls和并发single-flight。",
        "同时测/web-config、/models、/models-config隔离基线与session并发加载，区分session争用和provider/runtime独立冷启动。",
        "执行lint/typecheck/focused tests；未达到目标必须报告stage证据，不能放宽完整性门禁或伪造达标。"
      ],
      "acceptance": [
        "热route P50<=500ms、P95<=1.5s",
        "冷恢复P95<=5s且10s硬预算正确",
        "索引损坏/缺失不返回缺项partial 200",
        "设置/模型不再因session扫描新增10s级延迟，新增P95目标<=500ms",
        "所有最低验证通过"
      ],
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "npm run test:project-space-session-index",
        "npm run test:session-title",
        "npm run test:studio-child-sessions",
        "npm run bench:project-space-sessions"
      ],
      "risks": [
        "机器/外置磁盘波动影响绝对数据",
        "fixture未覆盖真实大JSONL",
        "并发模型接口有独立网络冷启动噪声"
      ],
      "parallelizable": false,
      "member": "implementer",
      "priority": 60,
      "failurePolicy": "block_dependents",
      "retry": { "maxAttempts": 1 },
      "localReview": { "required": true, "reviewer": "checker" }
    },
    {
      "id": "PSI-07",
      "title": "更新架构与模块文档",
      "phase": "docs",
      "order": 6,
      "dependsOn": ["PSI-06"],
      "relation": "serial",
      "files": [
        "docs/architecture/overview.md",
        "docs/modules/api.md",
        "docs/modules/library.md",
        "docs/modules/frontend.md",
        "docs/operations/troubleshooting.md",
        "AGENTS.md"
      ],
      "instructions": [
        "记录space-local落点、JSONL真相、热读/恢复/503、旧global migration与mutation失效不变量。",
        "更新route和新library模块说明；frontend无行为变化则只校准调用契约，不扩写AGENTS细节。",
        "记录benchmark命令、content-safe timing和索引损坏排查/回滚步骤。",
        "最终对照checks逐项留证，交由checker进行跨文件审查。"
      ],
      "acceptance": [
        "文档不再声称project-space热路径全量listAllSessions",
        "明确local index不是JSONL真相且旧global仅migration",
        "运维可安全删除/重建index并回滚代码",
        "AGENTS保持导航性而非堆积实现细节"
      ],
      "validation": [
        "rg检查旧架构描述",
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "checker文档/实现一致性审查"
      ],
      "risks": [
        "文档与最终实现常量不一致",
        "把运行时index误写成数据真相",
        "误更新用户无关改动"
      ],
      "parallelizable": false,
      "member": "implementer",
      "priority": 50,
      "failurePolicy": "block_dependents",
      "retry": { "maxAttempts": 1 },
      "localReview": { "required": true, "reviewer": "checker" }
    }
  ]
}
```

## 最低验证命令

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:project-space-session-index
npm run test:session-title
npm run test:studio-child-sessions
npm run bench:project-space-sessions
```

不直接运行 `next build`。仅release/publish验证时使用 `npm run build`。

## 检查门禁

- **完整性门禁**：任何missing/corrupt/partial fixture返回少列表的200，立即阻塞。
- **真相门禁**：index内容不能覆盖JSONL header关联或读取archive/任意路径。
- **Studio门禁**：global child不投影，run/subtask display不串。
- **Git门禁**：`.ypi/sessions` ignored、`.ypi/tasks`未ignored。
- **性能门禁**：必须保存冷/热P50/P95与I/O计数；只报平均值不通过。
- **UI门禁**：无HTML原型；任何可见状态/结构变更必须回到规划。
- **评审门禁**：实施完成后由checker按 `checks.md` 审查；实现员不得自行宣布最终通过。

## 回滚

1. 将project-space route切回原 `listAllSessions()` reader入口。
2. 停止local index mutation hook；保留被忽略的 `.ypi/sessions/` 文件，不触碰JSONL。
3. 不删除旧global sidecar；无需数据迁移或反向转换。
