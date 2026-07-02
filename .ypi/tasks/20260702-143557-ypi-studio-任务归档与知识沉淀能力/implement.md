# Implement：实施计划

## 建议执行顺序

1. 类型与契约
   - 更新 `lib/ypi-studio-types.ts`：新增 task scope、archive body、knowledge index/entry 类型，以及 summary/detail 的归档元数据可选字段。

2. 任务存储核心
   - 更新 `lib/ypi-studio-tasks.ts`：
     - 增加 `TASKS_ARCHIVE_DIR`、`KNOWLEDGE_DIR`、`KNOWLEDGE_INDEX`。
     - 扩展 `TaskContext`，加入 archive/knowledge roots。
     - 新增 key 解析：`active:<id>`、`archived:<YYYY-MM>:<id>`。
     - `scanTaskRecords` 跳过 `archive` 子目录。
     - 新增 archived scanner 和 `listYpiStudioTasks(cwd, { scope })`。
     - `loadTaskRecord` 支持归档 key；`getCurrentYpiStudioTaskDetail` 仍只解析 active pointer。
     - 新增 `archiveYpiStudioTask`、知识 Markdown 生成、index read/write、runtime pointer cleanup。

3. API
   - `app/api/studio/tasks/route.ts`：解析 `scope` 查询参数并传入 list。
   - `app/api/studio/tasks/[taskKey]/route.ts`：扩展 taskKey validator；PATCH 分支支持 `action: "archive"`。
   - 保持旧 GET/POST/PATCH 请求兼容。

4. Pi extension / tools / prompt injection
   - `lib/ypi-studio-extension.ts`：
     - `StudioTaskToolInput.action` 加 `archive`，参数加 `scope`、`tags`。
     - tool schema enum 增加 `archive`。
     - `current` 返回列表时支持 scope。
     - `archive` 调用 `archiveYpiStudioTask`。
     - 新增知识上下文构造，在 `before_agent_start`、`input`、`buildMemberPrompt` 中注入 bounded `<ypi-studio-knowledge>`。

5. UI
   - `components/YpiStudioPanel.tsx`：
     - 增加 task scope state，loadTasks 带 `scope`。
     - Tasks tab 增加筛选 chip。
     - `TaskCard` 对 completed active task 展示“归档”按钮并调用 PATCH。
     - `taskFilePath` 改用 `task.pathLabel`，兼容 archived path。
     - 归档后 reload tasks。

6. 文档
   - 更新 `docs/modules/api.md` 的 studio tasks 路由说明。
   - 更新 `docs/modules/frontend.md` 的 `YpiStudioPanel.tsx` 描述。
   - 更新 `docs/modules/library.md` 的 `ypi-studio-tasks.ts` / `ypi-studio-extension.ts` 描述。
   - 更新 `docs/architecture/overview.md` 的 YPI Studio 段落，记录 archive/knowledge 目录和注入边界。

## 需先阅读的文件

- `.ypi/tasks/20260702-143557-ypi-studio-任务归档与知识沉淀能力/research/trellis-archive-knowledge.md`
- `lib/ypi-studio-tasks.ts`
- `lib/ypi-studio-extension.ts`
- `lib/ypi-studio-types.ts`
- `components/YpiStudioPanel.tsx`
- `app/api/studio/tasks/route.ts`
- `app/api/studio/tasks/[taskKey]/route.ts`
- `.ypi/workflows/feature-dev.json`
- `docs/modules/api.md`
- `docs/modules/frontend.md`
- `docs/modules/library.md`
- `docs/architecture/overview.md`

## 验证命令

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

## 手工验证建议

1. 创建测试 Studio 任务，补齐 artifacts，transition 到 `completed`。
2. 调用 PATCH archive：
   - 确认 `.ypi/tasks/<id>` 消失；
   - 确认 `.ypi/tasks/archive/<YYYY-MM>/<id>` 存在；
   - 确认 `.ypi/knowledge/index.json` 和知识 md 生成；
   - 确认 `events.jsonl` 记录归档事件。
3. 调用：
   - `GET /api/studio/tasks?cwd=...` 只返回 active；
   - `GET /api/studio/tasks?cwd=...&scope=archived` 返回归档任务；
   - `GET /api/studio/tasks/<encoded archived key>?cwd=...` 可读详情。
4. 在 Studio Panel 中切换 Active/Archived/All，打开归档 task.json。
5. 启动/继续一个新 Studio 任务，检查 system prompt 或成员委派 prompt 中出现 bounded `<ypi-studio-knowledge>`，且没有注入全文。
6. 将 runtime pointer 指向已归档 task 后继续输入，确认不再显示 active task。

## 检查门禁

- 不得修改生产代码以外的不相关文件。
- 不得让 `.ypi/tasks/archive` 出现在 active errors 中。
- 不得允许任意路径、`../`、带 slash 的 task id 或非法 archive month。
- 归档 UI 不应暴露 override。
- 知识注入必须有长度上限。
