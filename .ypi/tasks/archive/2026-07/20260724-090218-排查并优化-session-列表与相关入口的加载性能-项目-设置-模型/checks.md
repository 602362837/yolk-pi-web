# Checks：session space-index 性能与完整性

## 1. 需求覆盖检查

- [ ] 精确落点为 main/worktree **各自** `<space-root>/.ypi/sessions/index.v1.json`。
- [ ] JSONL 仍在 `getAgentDir()/sessions/**`，没有物理移动或历史重写。
- [ ] 热 route 不调用全量 `scanSessionInventory()` / `listAllSessions()`。
- [ ] 索引只作候选/摘要层；每个返回项都经过文件存在、active root、header id/project/space 校验。
- [ ] missing/corrupt/partial/identity-mismatch index 不会返回静默缺项的 200。
- [ ] main/worktree 候选不会互串；path/displayPath/realPath 使用 registry `pathKey` 比较。
- [ ] legacy unassigned 仅在 `includeLegacy=1` 返回，且不自动写 header。
- [ ] Studio child root/parent/project-link 语义与现有响应一致。
- [ ] 旧全局 sidecar仅 migration seed/fallback；新路径停止双写但不删除旧文件。
- [ ] `.gitignore` 只忽略 `.ypi/sessions/`，`.ypi/tasks`、agents、workflows仍可被 Git 看到。

## 2. 索引 schema 与安全测试

### 正常与损坏矩阵

- [ ] valid complete index：读取目标 space entries。
- [ ] missing index：header-only完整恢复并原子创建。
- [ ] malformed JSON / future schema / wrong kind：fail closed + rebuild。
- [ ] projectId/spaceId/pathKey身份不匹配：不使用旧候选。
- [ ] partial coverage：不得当 complete 使用。
- [ ] duplicate id/path：稳定去重，以已验证 header为准。
- [ ] stale missing file：从 index移除。
- [ ] file改绑到其他 space：当前列表移除，对方 best-effort upsert。
- [ ] index写失败/锁超时：JSONL读取结果仍可返回；last-good不损坏。

### 路径与隐私

- [ ] 拒绝 absolute `sessionFile`、`..`、URL、archive path、sessions root外路径。
- [ ] 拒绝 symlink index目录/文件和非-regular JSONL候选。
- [ ] header id与entry id不一致时拒绝。
- [ ] size/entry/string上限生效，恶意大 index不会拖垮进程。
- [ ] API和日志不返回 index path、sessionFile、task内容、消息正文、tool output或凭据。

## 3. space 独立性测试

准备 main、两个 worktree、symlink alias：

- [ ] 每个 space只创建/读取自己的 index和锁。
- [ ] 同 sessionId异常重复时以 header/file校验隔离，不跨 space泄露。
- [ ] main操作不失效无关worktree snapshot；worktree操作反之亦然。
- [ ] worktree目录删除/registry missing后不导致 JSONL被索引层误删。
- [ ] worktree重新出现时身份验证后可重建，不盲信旧 index。

## 4. 读路径与恢复测试

- [ ] complete index + unchanged files：摘要 cache命中，不流式扫描文件正文。
- [ ] 单文件mtime/size变化：只重扫该文件。
- [ ] 同cwd外部CLI新文件：定向目录核对发现；未linked时只进legacy。
- [ ] local index漏一条同cwd linked session：定向核对补回。
- [ ] local/global index均缺失，但其他 encoded-cwd目录有显式当前space link：首次header-only recovery补回。
- [ ] 冷恢复超10s且无last-good：503 + Retry-After，不返回空/partial sessions。
- [ ] 有last-good时恢复超时：逐项重新验证后可用，后台single-flight继续；已删除/改绑项不返回。
- [ ] 两个并发恢复请求只执行一次底层rebuild；失败后下一次可重试。

## 5. 生命周期测试

| Mutation | 预期 |
| --- | --- |
| draft/new/bootstrap | header成功后本地upsert，Sidebar立即可见 |
| fork | link继承，parent关系正确，新index entry可见 |
| Studio child create/status end | pointer可见；parent折叠与display更新 |
| rename | name摘要更新，不等待TTL |
| archive | active index移除；不写archive路径 |
| unarchive | 从header恢复目标space entry |
| delete | entry移除，changes sidecar行为不变 |
| cascade reparent | sibling parent字段刷新 |
| delete-by-cwd/WorkTree cleanup | 所有删除id从对应index移除 |
| relink | old remove + new upsert；中途失败可由header恢复 |

## 6. Studio child 回归

- [ ] 普通 roots排序/标题/firstMessage不变。
- [ ] child只在高置信 `studioChild.kind + parentSessionId` 且parent可见时返回。
- [ ] 普通 fork不被识别为Studio child。
- [ ] 同task 100个children：task detail读取1次，不是100次。
- [ ] 不同run/subtask仍得到各自标题/summary，不串缓存。
- [ ] task detail失败时使用header subtaskId安全降级，列表不失败。
- [ ] `studioProjectionCalls <= uniqueLinkedTasks`。

## 7. gitignore 验证

在临时Git仓库与真实项目fixture中：

```bash
git status --short --ignored
```

- [ ] `.ypi/sessions/index.v1.json`、tmp、lock均 ignored。
- [ ] `.ypi/sessions/.gitignore`自身不出现在待提交列表。
- [ ] `.ypi/tasks/example/task.json`仍显示为可跟踪文件。
- [ ] 已有用户 `.gitignore` 不被覆盖；fallback local exclude带固定marker且幂等。
- [ ] non-Git space可工作，不强行初始化Git。

## 8. API 等价与人工验收

- [ ] success body字段仍为 `sessions/legacyUnassigned/studioChildrenByParentSessionId`。
- [ ] Sidebar切换 main/worktree、刷新、新建、fork、rename、archive、delete均正常。
- [ ] child嵌套行、tooltip、标题、打开read-only audit行为不变。
- [ ] 快速切换space仍由现有AbortController/generation防旧响应覆盖。
- [ ] 不出现新banner、文案、loading态或信息结构。

## 9. 性能门禁

固定fixture：约300 active sessions、180 Studio children；目标space分别取1、22和100 entries。至少预热1轮、采样30轮并记录机器/磁盘状态。

### 必须达到

- [ ] 热index route P50 ≤ 500ms。
- [ ] 热index route P95 ≤ 1.5s。
- [ ] 冷恢复 P95 ≤ 5s；硬预算10s生效。
- [ ] 热路径 `inventoryGlobalCalls=0`。
- [ ] 全局180 children不会产生180次Studio projection；次数≤目标space unique task数。
- [ ] 并发相同space请求共享single-flight。

### 相关入口

分别测隔离与“session route并发加载”两组：

- [ ] `GET /api/web-config`
- [ ] `GET /api/models`
- [ ] `GET /api/models-config`

验收：不再增加10s级等待；并发P95相对隔离基线新增目标≤500ms。若失败，必须用stage/CPU/event-loop证据说明是否需要Phase 2，不能宣称session修复已解决所有模型冷启动。

## 10. 自动验证

```bash
npm run lint
node_modules/.bin/tsc --noEmit
npm run test:session-title
npm run test:studio-child-sessions
# 新增
npm run test:project-space-session-index
npm run bench:project-space-sessions
```

不得直接运行 `next build`。如需release验证，只能运行 `npm run build`。

## 11. 文档与评审门禁

- [ ] 更新 `docs/architecture/overview.md` 的真相/索引/降级不变量。
- [ ] 更新 `docs/modules/api.md` 的专用route行为和503。
- [ ] 更新 `docs/modules/library.md` 的新store/query/migration边界。
- [ ] 若 mutation/前端行为实际变化，更新相应模块文档。
- [ ] checker重点审查“索引漏项不静默隐藏”“跨进程写不丢更新”“Studio child不串投影”“不忽略整个.ypi”。
