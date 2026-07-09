# prd

## 目标与背景

左侧侧边栏负责选择当前 Project Registry 项目空间、创建新会话、查看历史会话与文件。当前项目选择使用嵌入侧边栏的下拉菜单；当注册项目和 WorkTree 空间较多时，列表过长、宽度不足、层级不清，导致显示错乱和难以定位。用户明确要求取消下拉，改为左侧顶部切换按钮打开弹窗，并在弹窗内先选项目、再选项目空间。

## 范围内

- 左侧顶部新增/改造“项目空间切换按钮”，展示当前项目名、空间名、路径/分支摘要，并触发弹窗。
- 用 modal/dialog 替代当前 CWD picker dropdown 作为项目/空间切换主交互。
- 弹窗内采用分层选择：先在项目列表中选择项目，再在项目详情/空间列表中选择空间。
- 弹窗支持大量项目/空间的可读展示、滚动、搜索/过滤、置顶优先和当前选择标记。
- 将现有“Use default directory / Add project folder / Add project path / Add project from Git”入口迁移到弹窗内。
- 覆盖新环境无项目注册的空状态：清晰展示添加第一个项目的主操作。
- 保持现有选择后行为：更新 selectedProjectId/selectedSpaceId/selectedCwd，重新加载对应空间 sessions、Git info、文件浏览上下文。
- 保留 WorkTree 空间徽标、missing 禁用、右键 WorkTree 操作、项目/空间 metadata/归档能力的入口一致性。

## 范围外

- 不新增项目注册后端 API。
- 不修改 Project Registry 文件结构、session JSONL 格式、session-project link 写入规则。
- 不改变 WorkTree 创建、归档、删除、Git clone 的后端语义。
- 不重做整个 sidebar、session tree、file explorer 或顶部全局导航。
- 不引入虚拟列表库；首版通过明确弹窗尺寸、滚动容器和搜索过滤解决显示问题。

## 需求与验收标准

### R1：左侧顶部切换入口

- 展示当前项目名与当前空间名；无项目时展示“选择项目空间”与“尚未添加项目”。
- 点击入口打开 modal/dialog，不再打开 sidebar 内 dropdown。
- 当前 WorkTree 空间仍显示 `WT` badge/分支摘要；路径缺失空间显示禁用/缺失提示。
- 验收：侧边栏不再出现旧 CWD picker dropdown；入口在窄 sidebar 下单行/双行稳定省略，不挤压 New/WorkTree/Refresh 按钮。

### R2：分层项目/空间选择弹窗

- 弹窗左侧为项目列表，右侧为所选项目的空间列表与项目信息。
- 选择项目只改变弹窗内 pending project，不立即切换 cwd；点击空间才切换实际工作区并关闭弹窗。
- 当前项目和当前空间有明确选中状态。
- Space 行显示空间名、类型（主空间/WorkTree）、路径摘要、分支/base/缺失信息。
- 验收：用户可从至少 50 个项目、每个多个空间中通过滚动和搜索稳定定位目标，不出现列表溢出 viewport 或被 sidebar 裁切。

### R3：大量项目显示优化

- 弹窗有固定最大宽高与内部滚动区域；项目列表和空间列表分别滚动。
- 提供搜索框，至少按项目名、rootPath、空间名、空间 path 匹配过滤。
- 保持置顶项目/空间优先，排序沿用 `sortProjectsForSidebar()` / `activeProjectSpaces()` 口径。
- 验收：长项目名/路径用 ellipsis 与 title/tooltip 展示完整信息；操作按钮不被长文本挤出。

### R4：项目添加入口迁移

- 弹窗内保留现有添加方式：默认目录、系统目录选择、手动路径、Git clone。
- 手动路径表单与 Git clone 表单互斥；取消/Escape/关闭弹窗重置临时输入与错误。
- Git clone 成功后注册返回项目并选择 main space；失败不切换当前项目。
- 验收：现有 `/api/projects`、`/api/projects/select-directory`、`/api/projects/git-clone` 行为和错误展示不回退。

### R5：新环境空状态

- `activeProjects.length === 0` 时，左侧顶部按钮可打开弹窗。
- 弹窗显示 onboarding 空状态：说明不会从历史 sessions 扫描生成项目，并提供“Add project folder…”主按钮、“Add project path…”、“Add project from Git…”和“Use default directory”。
- 未选择项目时 New/WorkTree 创建仍禁用并有明确 title。
- 验收：全新数据目录没有项目时，无空白/报错/隐藏入口，用户可通过弹窗添加第一个项目。

### R6：可访问性与关闭行为

- 弹窗使用 `role="dialog"`、`aria-modal="true"`、可见标题。
- 支持 Esc 关闭（clone/校验中不强制中断）、点击遮罩关闭、关闭按钮。
- 打开时聚焦搜索框或第一个可操作项；关闭后焦点回到切换按钮。
- 验收：键盘用户可打开、搜索、Tab 到项目/空间/添加入口并关闭。

## 未决问题

1. 搜索是否需要跨项目直接列出匹配空间，还是仅过滤项目并在右侧显示选中项目空间？推荐首版：搜索同时影响左侧项目命中和右侧空间命中，但仍保持“先项目、再空间”的层级。
2. 点击空间是否立即切换并关闭，还是需要右下角“切换”确认？推荐首版：点击非 missing 空间立即切换，减少步骤；当前空间点击仅关闭或保持高亮均可，建议保持高亮不关闭。
3. 移动窄屏是否要全屏 sheet？推荐首版：`max-width: min(920px, calc(100vw - 24px))`，小于 720px 时上下分区/单列 step。实现员可按 CSS media query 完成。
