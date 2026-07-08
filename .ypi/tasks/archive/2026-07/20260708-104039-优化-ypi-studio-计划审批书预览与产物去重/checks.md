# Checks — 计划审批书预览与产物去重

## 需求覆盖检查

- [ ] 新建 Studio 任务包含 `plan-review.md` artifact。
- [ ] 架构师无法在 `plan-review.md` 空/TBD 时转入 `awaiting_approval`。
- [ ] 任务详情存在专用“审批书/计划审批”入口。
- [ ] `awaiting_approval` 任务能优先展示计划审批书。
- [ ] 计划审批书内 Markdown 相对链接可打开当前任务目录内文件。
- [ ] `.html` UI 原型链接可通过 FileViewer 或安全 preview route 查看渲染效果。
- [ ] 非法链接（URL scheme、绝对路径、`..`、跨任务目录）被拒绝。
- [ ] Artifacts Tab 中 `prd` / `prd.md` / requiredArtifacts / documents 不重复。
- [ ] 产物排序稳定：`plan-review.md` -> required -> optional -> mapping -> documents。
- [ ] `awaiting_approval -> implementing` 仍必须由当前绑定 context 的用户显式批准。

## UI 原型门禁检查

- [ ] UI 设计员已产出 HTML 原型，不只是 `ui.md` 文本说明。
- [ ] 原型覆盖审批书 Tab、缺失态、链接点击、HTML 预览、产物去重排序。
- [ ] 用户已确认 HTML 原型后才进入实现。
- [ ] Checker 在检查阶段阻塞缺失 HTML 原型或缺失用户确认记录。

## 自动验证

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

如新增测试：

```bash
npm run test:studio-artifacts
```

建议测试点：

1. `buildStudioArtifactItems()` 将 `prd`、`prd.md`、document `prd.md` 合并为一个 item。
2. `plan-review.md` 排序第一。
3. required/optional/completed refs 经过 key/fileName normalize 后结果正确。
4. task-relative path parser 接受 `./ui-prototype.html`，拒绝 `../x`、`/x`、`https://x`、`javascript:x`。
5. awaiting transition 在缺失 meaningful `plan-review.md` 时失败。

## 手工验收

1. 创建或打开 planning 任务，补齐 `plan-review.md`，确认任务详情出现“审批书”Tab。
2. 在 `plan-review.md` 中加入：
   - `[PRD](./prd.md)`
   - `[UI 原型](./ui-prototype.html)`
   - `[非法](../other/task.json)`
3. 点击 PRD 链接：应在项目 FileViewer 打开 `prd.md`。
4. 点击 UI 原型链接：应看到 HTML 渲染预览或可打开 FileViewer 预览。
5. 点击非法链接：应显示错误/提示，不发生导航或跨目录读取。
6. 打开 Artifacts Tab：同一产物只出现一次，badge 正确。
7. 在未明确批准时尝试进入 implementing：应失败。
8. 用户在绑定 Chat 明确回复确认后再进入 implementing：应成功并记录 approvalGrant。

## 回归风险

- 普通 Chat Markdown 不应启用任务相对链接解析。
- FileViewer 现有 Markdown/HTML 预览不应退化。
- 归档任务读取不应因缺失 `plan-review.md` 报错。
- 旧任务 Artifacts Tab 不应出现大量重复或排序抖动。
- Preview route 不得扩大 workspace 文件读取权限。
