# Checks：Settings 树导航与 Provider Hub

## 需求覆盖检查

- [ ] 左侧不再平铺 13 个一级项，出现四个可折叠分组。
- [ ] Studio 与分组平级，一点直达现有 Studio 成员策略页。
- [ ] Trellis 位于“工具”，与 Terminal / Editor 同级。
- [ ] “提供商策略”先打开四卡 Hub，不自动跳到 ChatGPT。
- [ ] ChatGPT / OpenCode Go / Grok / Kiro 四卡均可进入正确详情。
- [ ] OpenCode Go 的顶栏用量显示“未提供”，不伪造开关。
- [ ] 未实现方案 C；Usage 与 provider `usagePanelEnabled` 仍在原详情页。
- [ ] 账号管理仍在 Models；Hub 不新增账号编辑或 quota 请求。
- [ ] 13 个 `SettingsSection` id 与配置 API schema 未改变。

## 深链与状态检查

- [ ] Settings 普通打开默认落在 `yolk`，祖先“会话与工作区”展开。
- [ ] `initialSection="studio"` 选中 root Studio。
- [ ] `studioFocusMember` 默认成员行继续滚动居中并高亮。
- [ ] 自定义 project member 临时行仍能出现并高亮。
- [ ] `studioFocusField` 文案仍区分 model/thinking。
- [ ] 任一 provider 详情被选中时，“模型与用量 / 提供商策略”自动展开。
- [ ] 修改 provider 开关但不保存，返回 Hub 摘要显示草稿新值。
- [ ] Save、Cancel、恢复默认值、dirty 提示与 `onConfigChange` 不回归。
- [ ] Diagnostics 的本地状态不进入 dirty/save。

## 可访问性检查

- [ ] 所有节点为原生 button 或正确 treeitem，不使用不可聚焦 div 充当控制。
- [ ] 展开节点有 `aria-expanded`、关联子组有稳定 id。
- [ ] 当前叶子有 `aria-current="page"`，视觉选中不只依赖颜色。
- [ ] Tab 可进入/离开导航；Enter/Space 可激活或展开。
- [ ] ArrowUp/Down 在可见节点间移动；Right 展开/进入子项；Left 折叠/回父项；Home/End 可用。
- [ ] 焦点环在明暗主题可见。
- [ ] “开 / 关 / 未提供 / Models”均有文字，不只靠绿色/灰色。
- [ ] Escape/关闭 Settings、modal focus 行为无回归。
- [ ] `prefers-reduced-motion` 下无必要展开动画。

## 响应式与视觉检查

分别在 320、390、640、768、960、1440px 检查：

- [ ] `≤640px` Settings 全屏，树位于内容上方、纵向滚动且不会变成不可读的单行 tabs。
- [ ] 所有导航项可到达，导航不会挤掉底部 Save/Cancel。
- [ ] Provider 卡宽屏双列、窄屏单列，长文案无横向溢出。
- [ ] 三级缩进仍可辨识，Studio 的一级层级明显。
- [ ] 内容区独立滚动，页头/底部操作区稳定。
- [ ] 亮色、暗色主题均复用现有 CSS variables，无固定夜色面板。

## Provider 摘要口径

- [ ] ChatGPT：用量面板、自动 failover、后台自动刷新。
- [ ] OpenCode Go：自动 failover、顶栏用量未提供、账号管理在 Models。
- [ ] Grok：用量面板、自动 failover、Global Active/账号在 Models。
- [ ] Kiro：用量面板、自动 failover、Global Active/账号在 Models。
- [ ] Hub 不显示实时 quota、账号 id、token、路径或 secrets。

## 自动验证

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

如实现新增可独立测试的导航 helper，增加最小纯函数测试覆盖：

- section → ancestor groups 映射；
- 可见节点扁平化顺序；
- providerHub 与 provider section 的父子关系。

不为本次 IA 改造引入重型测试框架。

## 文档同步

- [ ] `docs/modules/frontend.md` 更新 `SettingsConfig`，并登记新增导航/Hub 组件。
- [ ] 若无 API/config 变化，`docs/modules/api.md` 与 `docs/modules/library.md` 不制造虚假变更；仅在实现实际改变契约时同步。
- [ ] AGENTS 顶层模块导航无需因普通组件新增而扩写；数据配置段保持 `pi-web.json` 口径。

## 重点回归风险

- [ ] Terminal / Trellis / Studio / Yolk 按 section 加载模型的 effect 仍触发。
- [ ] Trellis status 仅进入 Trellis 时加载。
- [ ] ModelPricesConfig 的独立保存行为不被 Settings Save 误覆盖。
- [ ] 关闭含当前页的分组不会清空表单或丢草稿。
- [ ] 连续切换 provider 不会重置草稿或错误触发 fetch。

## UI 门禁

- [ ] UI designer 已正式接单并产出/确认 HTML 原型。
- [ ] 用户已在 `plan-review.md` 审批 UI 原型和整体计划。
- [ ] 未满足以上两项不得进入 `implementing`。
