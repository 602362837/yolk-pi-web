# Checks：侧栏归档热路径剥离

## 需求覆盖检查

- [ ] project-space sessions route 不 import/call `scanArchivedCwds()`。
- [ ] project-space 响应不含 `archivedCounts`。
- [ ] global `/api/sessions` 不扫描 archive，且只保留当前消费者需要的 `sessions`。
- [ ] Sidebar 无“已归档”区块、归档计数、归档列表或恢复按钮。
- [ ] Sidebar 无 `loadArchivedSessions`、展开 effect 或 `/api/sessions/archived` 请求。
- [ ] 单个、批量、全部归档入口仍存在，成功后只刷新 active sessions。
- [ ] archive-all 确认数只等于本次 active sessions 数量。
- [ ] active 空态不依赖 archive count。
- [ ] archive/unarchive/archive-all/archived route、归档存储、详情读取和 Usage includeArchived 未删除。
- [ ] 未引入 active 定向读取、index 或缓存重构。

## 自动验证

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

目标检索：

```bash
rg -n "archivedCounts|archivedCwds|archivedSessions|archivedExpanded|loadArchivedSessions|ArchivedSessionItem" \
  components/SessionSidebar.tsx \
  app/api/projects/[projectId]/spaces/[spaceId]/sessions/route.ts \
  app/api/sessions/route.ts

rg -n "/api/sessions/archived" components hooks

rg -n "scanArchivedCwds" app/api/projects/[projectId]/spaces/[spaceId]/sessions/route.ts app/api/sessions/route.ts
```

以上目标热路径检索预期无命中。再检查保留能力：

```bash
rg -n "listArchivedSessionsForCwd|listAllArchivedSessions|includeArchived" app lib components
```

## API smoke

启动 `npm run dev` 后：

1. 请求有效 project/space route，确认 200、active sessions 正常，body 无 `archivedCounts`。
2. 请求 `/api/sessions`，确认 200、`sessions` 为数组，无 `archivedCwds`/`archivedCounts`。
3. 在归档目录规模较大的环境开启既有 session-list timing debug，确认 project-space timing 不再出现 `archive` stage/`archiveCwds` count。
4. 显式请求 `/api/sessions/archived?cwd=<cwd>`，确认 route 仍可工作（不要求侧栏调用）。
5. 已知 archived session id 请求 `/api/sessions/<id>`，确认 `archived: true` 和只读详情行为保持。
6. Usage `includeArchived` 开/关各请求一次，确认归档统计能力未受 list response 变更影响。

## 浏览器手工验收

### 基础与空间切换

- [ ] 打开应用，正常显示 project/space 与 active session 树。
- [ ] 切换两个空间，列表和 loading/skeleton 行为保持。
- [ ] 手动刷新，active 列表刷新。
- [ ] Network 过滤 `archived`：首次加载、切空间、刷新均无 `/api/sessions/archived`；project-space 请求本身不触发服务端 archive scan。
- [ ] 侧栏任何位置均无“已归档 (N)”区块。

### 归档动作

- [ ] hover 一个 active session 并归档；成功后该 active row 消失，只有 project-space active list 请求。
- [ ] 勾选多个 active sessions 并批量归档；操作栏和成功刷新保持。
- [ ] 打开“归档所有会话”确认框；N 等于当前 active row 数，不包含事先已归档数。
- [ ] 完成 archive-all 后显示 active 空态，无归档区块，也不拉 archive list。

### 回归

- [ ] active session 选择、树层级、重命名、删除正常。
- [ ] Studio child audit rows仍嵌套在可见 parent 下。
- [ ] 窄侧栏无横向溢出，active 标题省略保持。
- [ ] 文件浏览区和 session/explorer resize 不受影响。
- [ ] 已知归档详情链接仍可打开且输入保持禁用。

## 重点风险判定

以下任一项为 blocker：

- active 列表请求仍调用 `scanArchivedCwds()` 或读取 archive 目录。
- Sidebar 仍自动/展开请求 `/api/sessions/archived`。
- 单个/批量/全部归档不可用，或归档文件丢失。
- Usage includeArchived 被关闭或归档详情不可读。
- 未审批 HTML 原型即开始实现。

以下需记录但不阻塞本任务目标：active `listAllSessions()` 仍全局扫描导致的剩余长尾；应回到既有性能任务处理，不在此扩 scope。
