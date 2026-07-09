# checks

## 需求覆盖检查

- [ ] API 归档 WorkTree 后 registry space 软归档并隐藏。
- [ ] API 删除 WorkTree 后 registry space 软归档并隐藏。
- [ ] Sidebar 当前选中 WorkTree 被归档/删除后切到 main/fallback 或清空。
- [ ] CLI `git worktree remove` 后下一次项目加载/刷新能被动归档旧 space。
- [ ] 直接删除 WorkTree 目录后 missing-only 同步能归档旧 space。
- [ ] `git worktree move` 后 full refresh 能归档旧路径并 upsert 新路径。
- [ ] symlink/display path/realpath 场景不会重复或漏清理。

## 质量检查

- [ ] 使用 `canonicalizeProjectPath()` / pathKey 比较，不手写不一致路径逻辑。
- [ ] 不扫描 sessions 合成项目列表。
- [ ] 不迁移或回写历史 session header。
- [ ] API 响应保持向后兼容，只新增字段。
- [ ] Registry 写入保持原子；并发风险有说明或锁保护。
- [ ] allowed roots 缓存不会长期保留 archived/missing space。

## 自动验证

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

## 手工验收

1. UI 创建 WorkTree，确认 space 出现。
2. UI 归档 WorkTree，确认旧 space 立即消失，选中空间 fallback 正确。
3. UI 删除 WorkTree，确认同上。
4. 终端删除 WorkTree 后刷新项目列表，确认旧 space 被隐藏。
5. 直接删除 WorkTree 目录后刷新项目列表，确认旧 space 被隐藏。
6. 移动 WorkTree 后执行 refresh，确认旧/新 space 状态正确。

## 回归风险

- Sidebar 选择状态竞态导致选中 cwd 与 project/space 不一致。
- GET projects 被动写入导致意外 registry 更新时间变化。
- 自定义 WorkTree 路径不符合 `.worktrees` 命名时 session prune 与 registry cleanup 表现不同。
