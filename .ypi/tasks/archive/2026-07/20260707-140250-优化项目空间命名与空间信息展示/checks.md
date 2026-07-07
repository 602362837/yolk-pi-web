# checks

## 需求覆盖检查

- [x] 主空间默认显示为 `主空间`，不再显示 fallback `Main`（代码检查：`displaySpaceName()` fallback 已改）。
- [x] 普通 Git 空间顶部显示 `空间：<name> · 分支：<branch>`（代码检查：`formatProjectSpaceSubtitle()` 使用 `/api/git/info` branch）。
- [x] WorkTree 空间顶部显示 `空间：<name> · WorkTree：<branch> · 基准：<base>` 或未知兜底（代码检查：WorkTree 分支/基准格式化已实现）。
- [x] 来源/基准缺失时不猜测为 `main`（代码检查：无 base 时显示 `基准未知`/`未知`）。
- [x] 自定义空间 displayName 仍优先（代码检查：`displaySpaceName()` 先读 `space.displayName`）。
- [x] `spaceId: "main"` 和历史 session 链接不变（代码检查：仅 UI fallback/type metadata 改动，未改 session header 或 registry id）。

## 自动验证

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

结果：

- `npm run lint` — passed
- `node_modules/.bin/tsc --noEmit` — passed

检查员复核：已重新执行上述命令并通过。

## 手工验收

未启动 dev server 做浏览器手工验收；以下场景仍建议主会话/检查员在 UI 中抽查：

1. 注册/选择普通项目：主空间行显示 `主空间`。
2. 在 Git 仓库主工作区选择不同分支：顶部副标题分支名随 `/api/git/info` 结果变化。
3. 创建 WorkTree：空间列表出现 WorkTree；顶部与 badge tooltip 展示 WorkTree 分支和基准。
4. 模拟旧 WorkTree 无 baseRef：显示 `基准未知` 或以主工作树分支兜底，不写死 `main`。
5. 空间路径 missing：原有 missing/禁用新建会话行为保持。
6. 长项目名/分支名：顶部一行省略、tooltip 可查看完整信息。

## 回归风险

- Project Registry 不能被 session 扫描替代。
- 不要迁移或重写 session JSONL header。
- WorkTree 刷新不能丢失已保存的 baseRef。
- Dropdown 不能因新增信息明显变高或影响右键 WorkTree 操作。
