# prd

## 目标与用户价值

- 降低“项目空间 Main”和 Git 分支 `main` 的认知混淆。
- 让用户在左侧顶部一眼确认当前所在空间、分支/WorkTree 状态和 WorkTree 基准来源，减少误操作。

## 需求与验收标准

1. 主空间默认名中文化
   - 未设置自定义空间显示名时，`kind: "main"` 空间展示为 `主空间`。
   - `spaceId` 仍保持 `main`，不改 session header、registry id 或 API 路由参数。

2. 顶部空间信息增强
   - Project Registry 空间选中时，侧边栏顶部副标题展示空间名 + Git 信息。
   - 普通 Git 工作区展示当前分支。
   - WorkTree 工作区展示 WorkTree 分支，并展示来源/基准信息。
   - 非 Git 或无法读取 Git 信息时展示明确兜底文案。

3. 兼容与缺失状态
   - 用户自定义 displayName 优先于默认名。
   - 来源/基准信息缺失时显示“基准未知/来源未知”，不默认写死 main。
   - 空间路径 missing 时继续保留缺失提示。

## 未决问题

- 是否需要把旧 registry 中手动/历史保存的 main 空间 `displayName: "Main"` 也强制显示为 `主空间`？建议先不迁移，只改默认 fallback；若产品要求“所有 Main 都替换”，再加窄条件兼容规则。
- WorkTree 的“来源分支”是否必须表示创建时的 `baseRef`，还是接受当前主工作树分支作为“基准分支”兜底？建议新增可选 `baseRef` 保存创建时基准，旧数据用 `mainWorktreeBranch` 兜底并标识为基准未知/推断。
