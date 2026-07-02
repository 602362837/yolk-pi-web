# Checks：验证结果

## 需求覆盖检查

- [x] 归档会移动目录到 `.ypi/tasks/archive/<YYYY-MM>/<task-id>/`。
- [x] 归档任务状态和事件被记录，runtime pointer 被清理。
- [x] Active 列表默认不包含归档任务，Archived/All scope 可读取归档任务。
- [x] `.ypi/knowledge/index.json` 和知识 Markdown 在归档时生成。
- [x] 后续主会话和 Studio 成员委派能读取并注入 bounded 知识摘要。
- [x] Studio Panel 能筛选 active/archived/all，并能归档 completed 任务。
- [x] `/studio-archive` command 已添加；command 路径会要求当前 session 模型整理知识摘要后再调用 archive tool。
- [x] 非 completed 任务不能归档，应走 cancelled/废弃；不实现 unarchive。

## 自动质量检查

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

结果：两项均已通过（实现员与主会话复核；检查员也复核通过）。

## 检查员结论

`checker` 已 review 当前 diff 并产出 `review.md`。

Verdict: Pass

重点确认：

- completed-only archive；
- 未完成任务不能归档且应走 cancelled；
- 无 unarchive；
- `/studio-archive` 已加；
- 知识注入有硬上限；
- UI fallback 文案明确；
- active scanner 跳过 `archive`；
- archived key/路径校验存在；
- UI 打开任务文件改为 `pathLabel`；
- docs 已同步。

## 剩余风险

- 低风险：archive 在最终 `renameSync(...)` 前已写 knowledge/index 并追加 archive event；若 rename 失败，当前实现可重试，但不是完全原子。
- 页面按钮无法直接调用当前 chat session 模型，因此会明确提示：若需要模型整理摘要，请在聊天中执行 `/studio-archive`；页面归档使用任务产物兜底摘要并返回 warning。
