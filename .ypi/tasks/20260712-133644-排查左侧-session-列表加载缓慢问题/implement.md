# Implement

## 优先阅读

- `AGENTS.md`
- `docs/architecture/overview.md`
- `docs/modules/frontend.md`
- `docs/modules/api.md`
- `docs/modules/library.md`
- `components/SessionSidebar.tsx`
- `app/api/projects/[projectId]/spaces/[spaceId]/sessions/route.ts`
- `lib/session-reader.ts`
- `lib/project-session-index.ts`
- session create/fork/archive/unarchive/delete/rename 调用方

## 人类可读子任务表

| ID | 阶段 | 顺序 | 子任务 | 依赖 | 可并行 |
| --- | --- | ---: | --- | --- | --- |
| PERF-001 | Measure | 1 | 建立 fixture、基线和服务端阶段计时 | - | 否 |
| FE-001 | Request | 2 | 消除重复 sessions 请求并 abort 过期请求 | PERF-001 | 是 |
| BE-001 | Cache | 2 | 实现 single-flight 与文件级摘要缓存 | PERF-001 | 是 |
| BE-002 | Index | 3 | 将 sidecar index 接入候选校验/backfill | BE-001 | 否 |
| BE-003 | Projection | 3 | Studio task 投影去重及 archive count 缓存 | BE-001 | 是 |
| INT-001 | Integration | 4 | 接入专用 route、失效点和兼容测试 | FE-001, BE-002, BE-003 | 否 |
| DOC-001 | Verify | 5 | 文档、基准、lint/typecheck 和人工验收 | INT-001 | 否 |

## 执行说明

1. 先落计时与可复现 fixture，记录优化前 cold/warm P50/P95/P99 和读取次数。
2. 前后端可并行：前端只处理请求身份/abort；后端先建立不依赖 index 的 snapshot/cache。
3. index 接入必须在缓存正确性测试之后，并使用“候选 + 校验 + 回退”模型。
4. 接入 route 后补齐所有 mutation 失效点，再做等价性和压力测试。
5. 不改变 UI。若实现中需要修改加载状态，停止并触发 UI HTML 原型审批。

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "title": "左侧 session 列表加载性能治理",
  "maxConcurrency": 2,
  "subtasks": [
    {
      "id": "PERF-001",
      "title": "建立性能基线与阶段计时",
      "phase": "measure",
      "order": 1,
      "dependsOn": [],
      "files": [
        "app/api/projects/[projectId]/spaces/[spaceId]/sessions/route.ts",
        "lib/session-reader.ts",
        "scripts/"
      ],
      "instructions": "增加有界、内容安全的阶段计时；创建固定 session fixture/benchmark，记录 active inventory、SessionManager、header、Studio projection、archive、filter/serialization 的耗时与计数。日志只在慢请求阈值或调试开关下输出。",
      "acceptance": [
        "能定位一次慢请求的主导阶段",
        "基线包含 cold/warm P50/P95/P99 和底层读取次数",
        "日志不包含消息正文、标题、工具内容或凭据"
      ],
      "validation": [
        "运行固定 fixture benchmark",
        "检查慢请求日志字段和隐私边界"
      ],
      "risks": [
        "计时本身增加噪声或开销",
        "CI 机器波动导致绝对阈值不稳定"
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "FE-001",
      "title": "收敛侧栏请求触发与取消竞态",
      "phase": "request",
      "order": 2,
      "dependsOn": ["PERF-001"],
      "files": ["components/SessionSidebar.tsx"],
      "instructions": "让 loadSessions 使用稳定 projectId/spaceId 请求身份；合并手动 refresh 与 projects 更新后的触发；为 sessions 请求增加 AbortController，保留 generation token 防陈旧提交，并忽略 AbortError。不得改变现有加载 UI。",
      "acceptance": [
        "单次刷新只产生一次有效 sessions 请求",
        "快速空间切换取消旧请求且旧响应不覆盖新空间",
        "现有 loading/error/refresh 视觉行为不变"
      ],
      "validation": [
        "frontend focused tests",
        "浏览器 Network 快速切换/刷新 smoke"
      ],
      "risks": ["projects 刷新后 selection fallback 使用旧闭包", "React Strict Mode 重复 effect"],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "BE-001",
      "title": "实现 session inventory single-flight 与增量摘要缓存",
      "phase": "cache",
      "order": 2,
      "dependsOn": ["PERF-001"],
      "files": ["lib/session-reader.ts", "lib/types.ts"],
      "instructions": "增加专用于列表的 process-global bounded snapshot；相同扫描共享 single-flight；按 path+mtime+size 复用摘要/header，失败 promise 不缓存，删除文件清理 cache。保持 JSONL 为真相并设置容量/TTL。",
      "acceptance": [
        "冷结果与现有 listAllSessions 等价",
        "热请求不重读未变化文件",
        "并发请求只运行一次底层扫描",
        "修改/删除/新增文件可被检测"
      ],
      "validation": ["session-reader cache/single-flight tests", "benchmark cold/warm comparison"],
      "risks": ["mtime+size 碰撞", "globalThis cache 无界", "rejected promise 污染后续请求"],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "BE-002",
      "title": "安全接入 project-session index",
      "phase": "index",
      "order": 3,
      "dependsOn": ["BE-001"],
      "files": ["lib/project-session-index.ts", "lib/session-reader.ts"],
      "instructions": "使用 index 生成目标空间候选，但通过 inventory/header reconciliation 发现未索引或不一致 session；校验文件存在和 header 关联；对陈旧/缺失项 best-effort 修复。index 读写失败必须回退。",
      "acceptance": [
        "空、部分、陈旧、损坏 index 均不漏合法 session",
        "完整 index 的热路径减少无关 header/project 解析",
        "索引错误不使 API 失败"
      ],
      "validation": ["project-session-index focused tests", "partial/corrupt index route tests"],
      "risks": ["误将 index 当排除依据", "并发 backfill 覆盖写"],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "BE-003",
      "title": "去重 Studio 投影并缓存 archive counts",
      "phase": "projection",
      "order": 3,
      "dependsOn": ["BE-001"],
      "files": ["lib/session-reader.ts", "app/api/projects/[projectId]/spaces/[spaceId]/sessions/route.ts"],
      "instructions": "按 cwd+taskId 去重 task detail 读取，再按 child run/subtask 生成独立标题；为 archive inventory/count 建独立短期 snapshot，并定义 archive/unarchive 失效。",
      "acceptance": [
        "同 task 多 child 不重复解析 task detail",
        "不同 run/subtask 标题保持正确",
        "archive count 与现有行为一致"
      ],
      "validation": ["Studio projection tests", "archive count mutation tests", "I/O counter benchmark"],
      "risks": ["错误共享 run-specific 标题", "active/archive cache 失效不对称"],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "INT-001",
      "title": "接入专用查询并补齐生命周期失效",
      "phase": "integration",
      "order": 4,
      "dependsOn": ["FE-001", "BE-002", "BE-003"],
      "files": [
        "app/api/projects/[projectId]/spaces/[spaceId]/sessions/route.ts",
        "lib/agent-session-bootstrap.ts",
        "lib/rpc-manager.ts",
        "app/api/sessions/archive/route.ts",
        "app/api/sessions/unarchive/route.ts",
        "app/api/sessions/[id]/route.ts"
      ],
      "instructions": "route 改用专用 reader 并保持响应契约；create/fork/rename/archive/unarchive/delete 后更新或失效相关 cache/index。审查所有调用方，不依赖 TTL 掩盖已知本进程 mutation。",
      "acceptance": [
        "所有生命周期操作后列表及时正确",
        "API response 深度等价",
        "外部写入在约定窗口内可见"
      ],
      "validation": ["route contract tests", "lifecycle integration tests", "manual sidebar smoke"],
      "risks": ["遗漏 mutation 调用方", "缓存 invalidation 造成刷新风暴"],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "DOC-001",
      "title": "完成文档、性能与回归门禁",
      "phase": "verify",
      "order": 5,
      "dependsOn": ["INT-001"],
      "files": [
        "docs/modules/frontend.md",
        "docs/modules/api.md",
        "docs/modules/library.md",
        "docs/architecture/overview.md",
        ".ypi/tasks/20260712-133644-排查左侧-session-列表加载缓慢问题/checks.md"
      ],
      "instructions": "更新缓存/index 真相边界和请求行为文档；运行 lint/typecheck/focused tests/benchmark/人工 smoke，记录优化前后数据与残余风险。",
      "acceptance": [
        "文档与代码契约一致",
        "最低验证全部通过",
        "性能数据达到审批后的目标或明确报告阻塞"
      ],
      "validation": ["npm run lint", "node_modules/.bin/tsc --noEmit", "focused tests", "benchmark", "manual smoke"],
      "risks": ["绝对性能阈值受机器负载影响"],
      "parallelizable": false,
      "localReview": true
    }
  ],
  "execution": {
    "groups": [
      {"id": "G1", "subtaskIds": ["PERF-001"]},
      {"id": "G2", "subtaskIds": ["FE-001", "BE-001"]},
      {"id": "G3", "subtaskIds": ["BE-002", "BE-003"]},
      {"id": "G4", "subtaskIds": ["INT-001"]},
      {"id": "G5", "subtaskIds": ["DOC-001"]}
    ]
  }
}
```

## 验证命令

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

再运行新增 focused tests、固定 fixture benchmark 和 `checks.md` 人工流程。不要直接运行 `next build`。

## 检查门禁

- JSONL header 仍是权威关联来源，index 缺失不得隐藏数据。
- 无 UI 变更；若改变加载体验，停止实现并补 HTML 原型审批。
- 未提供优化前后受控 benchmark、并发 single-flight 证据和生命周期回归前不得完成。
