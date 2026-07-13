# Implement：轻量会话元数据扫描

## 需先阅读

1. `docs/architecture/overview.md`（Session files、Archive、Studio child）
2. `docs/modules/api.md`（Session List Performance）
3. `docs/modules/library.md`（session-reader/usage）
4. `lib/session-reader.ts`
5. 已安装 SDK `node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js` 的 `buildSessionInfo/listAll`
6. `app/api/sessions/route.ts`、project-space sessions route、`sessions/archive-all/route.ts`
7. `lib/usage-stats.ts`、`lib/session-header-metadata.ts`、`lib/session-title.ts`

## 人类可读子任务表

| ID | 阶段 | 顺序 | 内容 | 依赖 | 可并行 |
|---|---:|---:|---|---|---|
| META-001 | foundation | 1 | 增量、有界单文件 metadata parser + inventory scanner | — | 否 |
| META-002 | integration | 2 | active list/allowed roots/delete 路径替换 SDK listAll | META-001 | 否 |
| META-003 | integration | 2 | archive/archive-all 路径统一轻量 scanner | META-001 | 是（与 002） |
| META-004 | verification | 3 | 兼容差分、超大消息、内存与 API 回归测试 | 002,003 | 否 |
| META-005 | docs | 4 | 更新架构/API/library 性能契约 | 002,003,004 | 否 |

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "title": "轻量会话元数据扫描替换全量正文保留",
  "maxConcurrency": 2,
  "subtasks": [
    {
      "id": "META-001",
      "title": "实现有界流式会话元数据扫描器",
      "phase": "foundation",
      "order": 1,
      "dependsOn": [],
      "files": ["lib/session-metadata-scanner.ts", "scripts/test-session-metadata-scanner.mjs"],
      "instructions": "实现按 chunk 的 JSON token/path 扫描和固定并发 inventory；只提取 header、最新 name、计数、首条用户文本有界前缀、活动时间；不得按整行 JSON.parse、readFile 或累积正文。",
      "acceptance": ["结果类型无 allMessagesText", "超大 content 的保留内存有界", "字段顺序和 chunk 边界无关", "单文件错误隔离"],
      "validation": ["node scripts/test-session-metadata-scanner.mjs"],
      "risks": ["JSON escape/chunk boundary/tokenizer correctness"],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "META-002",
      "title": "接入 active session inventory 消费方",
      "phase": "integration",
      "order": 2,
      "dependsOn": ["META-001"],
      "files": ["lib/session-reader.ts", "lib/usage-stats.ts"],
      "instructions": "替换 listAllSessionsUncached、allowed-roots cwd 和 deleteSessionsForCwd 中 SessionManager.listAll；保留 snapshot/path cache、WorkTree prune、Studio child/project link/parent 映射语义；审计 usage inventory。",
      "acceptance": ["生产 active list 路径不再调用 SessionManager.listAll", "API wire shape 与过滤语义不变", "缓存 invalidation 不退化"],
      "validation": ["rg -n 'SessionManager\\.listAll' lib app", "npm run lint", "node_modules/.bin/tsc --noEmit"],
      "risks": ["modified/firstMessage/name 语义偏差", "WorkTree 删除回归"],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "META-003",
      "title": "收敛归档与 archive-all 的完整解析旁路",
      "phase": "integration",
      "order": 2,
      "dependsOn": ["META-001"],
      "files": ["lib/session-reader.ts", "app/api/sessions/archive-all/route.ts"],
      "instructions": "归档列表和 cwd 归档复用 lightweight scanner；移除 scanArchivedCwds 的整文件 readFile 和 archived list 的 getEntries；保留 archive 目录、计数、排序、Studio child include flags。",
      "acceptance": ["archive-all 不直接调用 SDK listAll", "归档列表不为 metadata 加载完整 entries", "archive/unarchive wire 和文件移动不变"],
      "validation": ["node scripts/test-session-metadata-scanner.mjs", "npm run lint", "node_modules/.bin/tsc --noEmit"],
      "risks": ["归档标题/消息数改变", "历史 cwd alias 匹配"],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "META-004",
      "title": "建立兼容与内存回归门禁",
      "phase": "verification",
      "order": 3,
      "dependsOn": ["META-002", "META-003"],
      "files": ["scripts/test-session-metadata-scanner.mjs", "scripts/test-session-list-performance.mjs", "package.json"],
      "instructions": "覆盖 legacy/project/Studio child/parent/name clear/content blocks/Unicode/malformed/超大单行；对小 fixture 与 SDK metadata 做差分；隔离进程 --expose-gc 验证无正文标记且 retained heap 不随正文线性增长。",
      "acceptance": ["前 50 展示标题兼容", "结构性测试证明结果不含正文", "大 fixture 内存门禁通过", "API/归档/Studio child 回归通过"],
      "validation": ["node --expose-gc scripts/test-session-list-performance.mjs", "npm run lint", "node_modules/.bin/tsc --noEmit"],
      "risks": ["数值内存测试平台抖动"],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "META-005",
      "title": "更新会话扫描性能文档",
      "phase": "docs",
      "order": 4,
      "dependsOn": ["META-004"],
      "files": ["docs/architecture/overview.md", "docs/modules/api.md", "docs/modules/library.md"],
      "instructions": "记录 lightweight scanner、正文不保留、active/archive/Studio child/Usage 边界和回滚。",
      "acceptance": ["文档与最终实现一致", "AGENTS 顶层导航无需变化"],
      "validation": ["git diff --check"],
      "risks": [],
      "parallelizable": false,
      "localReview": true
    }
  ],
  "execution": {
    "groups": [
      {"id": "g1", "mode": "serial", "subtaskIds": ["META-001"]},
      {"id": "g2", "mode": "parallel", "subtaskIds": ["META-002", "META-003"]},
      {"id": "g3", "mode": "serial", "subtaskIds": ["META-004", "META-005"]}
    ]
  }
}
```

## 全局验证命令

```bash
node scripts/test-session-metadata-scanner.mjs
node --expose-gc scripts/test-session-list-performance.mjs
npm run lint
node_modules/.bin/tsc --noEmit
git diff --check
rg -n 'SessionManager\.listAll' lib app
```

最后一条允许仅保留确有单会话/SDK 生命周期理由的调用；所有 inventory、archive-all、allowed-roots 调用都必须消失或有书面例外。

## 实现门禁与回滚

- 先评审 tokenizer 的有界内存和 JSON 正确性，再接 API。
- META-002/003 合并前各自做 local review，META-004 做最终 checker。
- 不修改 JSONL，不做数据迁移；回滚仅恢复调用点。若 tokenizer 无法证明超大字符串有界，应停止而非以 `JSON.parse(line)` 作为完成方案。
