# Implement

## 先阅读

1. `docs/architecture/overview.md` Studio session binding / approval gate
2. `docs/modules/library.md`、`docs/modules/api.md`
3. `lib/ypi-studio-tasks.ts` runtime pointer、bind、approval、所有 `contextIds.push`
4. `lib/ypi-studio-session-link.ts`
5. `lib/ypi-studio-extension.ts` context key 与 continue/tool action
6. `app/api/studio/tasks/[taskKey]/route.ts`
7. `components/YpiStudioPanel.tsx` bind 入口、`components/AppShell.tsx` session-task 拉取

## 人类可读 DAG

| ID | 阶段 | 依赖 | 工作 | 主要文件 |
|---|---|---|---|---|
| OWN-1 | foundation | — | 提取 session context 分类、exclusive replace、owner guard、compare-before-delete runtime pointer helper；纳入 task lock。 | `lib/ypi-studio-tasks.ts` |
| OWN-2 | mutation | OWN-1 | 将 bind 改为 exclusive transfer；清旧 pointer、跨 session approval grant，记录审计；所有其他 push 点改为 owner guard。 | `lib/ypi-studio-tasks.ts` |
| OWN-3 | tests | OWN-2 | 新增 create→transfer→resolver、pointer、approval、mutation guard、legacy lazy repair、concurrency 回归测试和 npm script。 | `scripts/test-ypi-studio-session-ownership.mjs`, `package.json` |
| OWN-4 | docs | OWN-2 | 更新 task 单 session owner、session 多 task、bind API exclusive 语义与惰性兼容。 | `docs/architecture/overview.md`, `docs/modules/library.md`, `docs/modules/api.md` |
| OWN-5 | validation | OWN-3, OWN-4 | 跑 focused tests、Studio DAG、lint、tsc；人工验证两个 session 浮窗和审批交接。 | 无生产文件 |

## 关键实现要求

- 不能在 session-link 读取层猜 owner；修复写入语义。
- 只有显式 bind 可 transfer；普通 mutation 不得隐式抢占。
- compare-before-unlink runtime pointer。
- transfer 后新 session 必须重新获得 session-bound approval；不能复用旧 grant。
- 保留 multi-task-per-session API/UI，不新增 unbind 或 UI。

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "title": "YPI Studio task exclusive session ownership",
  "strategy": "serial foundation and mutation refactor, then tests/docs in parallel, final validation",
  "execution": {
    "maxConcurrency": 2,
    "groups": [
      { "id": "g1", "label": "ownership core", "subtaskIds": ["OWN-1", "OWN-2"] },
      { "id": "g2", "label": "coverage", "subtaskIds": ["OWN-3", "OWN-4"] },
      { "id": "g3", "label": "gate", "subtaskIds": ["OWN-5"] }
    ]
  },
  "subtasks": [
    {
      "id": "OWN-1",
      "title": "建立 session ownership 与 runtime pointer 原语",
      "phase": "foundation",
      "order": 1,
      "dependsOn": [],
      "files": ["lib/ypi-studio-tasks.ts"],
      "instructions": "实现精确 session context 分类（pi_/pi_transcript_/pi_process_）、保留非 session context 的 replace helper、bound guard、compare-before-unlink pointer helper，并确保供 mutation lock 内调用。",
      "acceptance": ["分类不误删未知 context", "旧 pointer 仅在仍指向目标 task 时删除", "helper 可表达唯一 owner"],
      "validation": ["focused unit assertions", "node_modules/.bin/tsc --noEmit"],
      "risks": ["context 前缀误分类", "runtime pointer 误删"],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "OWN-2",
      "title": "统一 exclusive bind 与 mutation owner guard",
      "phase": "mutation",
      "order": 2,
      "dependsOn": ["OWN-1"],
      "files": ["lib/ypi-studio-tasks.ts", "app/api/studio/tasks/[taskKey]/route.ts"],
      "instructions": "bind 在 task lock 内转移唯一 session owner、清旧 pointer/跨 session grant、写新 pointer及审计；审计所有 contextIds.push 调用点，create 仅初始化，普通 main/improvement/implementation mutations 改为验证 owner而非 append。保持 API shape。",
      "acceptance": ["bind 后只有新 session owner", "非 owner mutation 被拒绝", "approval gate 不弱化", "archived bind 仍拒绝"],
      "validation": ["rg contextIds\\.push lib/ypi-studio-tasks.ts", "node_modules/.bin/tsc --noEmit"],
      "risks": ["内部无 context 维护路径被误阻断", "并发校验不在 lock 内"],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "OWN-3",
      "title": "增加 ownership 与 session-link 回归测试",
      "phase": "tests",
      "order": 3,
      "dependsOn": ["OWN-2"],
      "files": ["scripts/test-ypi-studio-session-ownership.mjs", "package.json"],
      "instructions": "覆盖 create@s1→bind@s2、resolver/widget candidate、pointer cleanup、idempotency、旧数据惰性修正、approval transfer、所有 mutation guard 和并发 bind。",
      "acceptance": ["s1 transfer 后 tasks[] 无 A", "s2 tasks[] 有 A", "旧 grant 不可复用", "同 session 多 task 保持"],
      "validation": ["npm run test:studio-session-ownership", "npm run test:studio-dag"],
      "risks": ["测试依赖真实用户目录", "并发测试不稳定"],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "OWN-4",
      "title": "同步 Studio session ownership 文档",
      "phase": "docs",
      "order": 4,
      "dependsOn": ["OWN-2"],
      "files": ["docs/architecture/overview.md", "docs/modules/library.md", "docs/modules/api.md"],
      "instructions": "明确 task 单 session owner、session 可多 task、bind 为 exclusive transfer、普通 mutation 不抢占、旧数据下一次 bind 惰性归一化及 archived 边界。",
      "acceptance": ["API、library、architecture 描述一致", "不误写成 session 单 task"],
      "validation": ["人工交叉审阅文档与代码契约"],
      "risks": ["混淆两个不同方向的基数约束"],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "OWN-5",
      "title": "执行完整验证与双 session 人工验收",
      "phase": "validation",
      "order": 5,
      "dependsOn": ["OWN-3", "OWN-4"],
      "files": [],
      "instructions": "执行 focused tests、Studio DAG、lint、tsc；在两个真实 session 验证浮窗交接、旧 session 失去审批/调度权、新 session 重新批准。",
      "acceptance": ["所有自动命令通过", "人工 create→continue 场景通过", "无 UI 改动"],
      "validation": ["npm run test:studio-session-ownership", "npm run test:studio-dag", "npm run lint", "node_modules/.bin/tsc --noEmit"],
      "risks": ["人工刷新时序掩盖 stale cache", "存量任务未再次 bind 的已知窗口"],
      "parallelizable": false,
      "localReview": true
    }
  ]
}
```

## 检查门禁与回滚

- OWN-2 完成后先本地审查所有 push 点，再允许测试/文档并行。
- OWN-5 全通过且 checker 确认 approval/session-link 边界后才可交付。
- 回滚为恢复旧 mutation 逻辑；不需要 schema/data rollback。已归一化任务不会恢复错误的历史多 owner。
