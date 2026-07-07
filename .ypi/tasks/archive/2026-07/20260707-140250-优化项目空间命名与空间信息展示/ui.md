# ui

## 是否需要 UI 设计员

不需要独立 UI 原型。属于现有 Sidebar 文案与信息密度调整，按现有两行标题、tooltip、badge 样式落地即可。

## 推荐展示规则

### 侧边栏顶部

现有结构保留：第一行项目名，第二行项目空间信息。

- 主空间 + 有分支：`空间：主空间 · 分支：main`
- 主空间 + 无 Git/无分支：`空间：主空间 · 未检测到 Git 分支`
- 普通非 WorkTree 空间（理论上仍是 main kind）+ 当前分支：`空间：<空间名> · 分支：<branch>`
- WorkTree + 有分支和基准：`空间：<空间名> · WorkTree：<branch> · 基准：<base>`
- WorkTree + 分支缺失：`空间：<空间名> · WorkTree：未知分支 · 基准：<base|未知>`
- WorkTree + 基准缺失：`空间：<空间名> · WorkTree：<branch|未知分支> · 基准未知`
- 路径缺失：末尾追加 ` · 路径缺失`

Tooltip / title 建议展示完整路径和更完整说明：

```text
空间：<spaceName>
路径：<absolute path>
分支：<branch or 未检测到>
WorkTree：是/否
基准：<baseRef or mainWorktreeBranch or 未知>
```

### Dropdown 空间列表

- 主空间行显示 `主空间`，不显示 `Main`。
- WorkTree 行继续用 `WT` badge，但 tooltip 增强为 `WorkTree：<branch> / 基准：<base>`。
- 列表行空间名仍保持一行省略，避免撑高侧边栏；丰富信息优先放顶部和 tooltip。

## 文案原则

- 使用 `WorkTree` 保持与现有按钮/设置一致。
- 用 `分支：` 表示当前 checkout 分支。
- 用 `基准：` 表示创建时 baseRef；没有 baseRef 时可用主工作树分支兜底，但 tooltip 中应避免暗示它一定是创建来源。
- 缺失时明确显示 `未知`，不要猜测为 `main`。
