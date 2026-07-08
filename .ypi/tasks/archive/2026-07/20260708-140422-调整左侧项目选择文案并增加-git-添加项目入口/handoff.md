# handoff

## 产物

已根据用户新需求更新规划产物：

- `brief.md`
- `prd.md`
- `ui.md`
- `design.md`
- `implement.md`
- `checks.md`
- `plan-review.md`

## 验证

- 未运行代码验证；本轮仅修改 YPI Studio 规划文档，未改生产代码。
- 已读取相关项目文档与源文件用于校准方案：`docs/modules/frontend.md`、`docs/modules/api.md`、`docs/standards/code-style.md`、`components/SessionSidebar.tsx`、`app/api/projects/select-directory/route.ts`、`app/api/projects/route.ts`。

## 当前阻塞

- 旧版 `ui-prototype.html` 只覆盖“本地基准路径”旧方案，已不满足当前需求。
- 需要主会话调度/要求 `ui-designer` 修订 HTML 原型，并取得用户审批后才能进入实现。

## 已确认决策

1. Git 入口文案固定为 `Add project from Git…`。
2. Git 表单改为两个输入：`Local parent path` 与 `Remote repository`。
3. `Local parent path` 是 clone 父目录；clone 成功后注册克隆得到的项目目录并选中返回 main space。

## 仍需主会话/用户确认

1. Clone 提交按钮是否采用建议文案 `Clone and add`。
2. clone 目标目录名是否使用 Git 默认/远程 basename 推导，本轮不增加第三个输入。
3. 是否批准新增同步 `POST /api/projects/git-clone` 接口作为 v1（无进度流/后台队列）。
4. clone 失败或注册失败后的半成品目录是否默认不自动删除；建议不自动删除非空目录，避免误删。
