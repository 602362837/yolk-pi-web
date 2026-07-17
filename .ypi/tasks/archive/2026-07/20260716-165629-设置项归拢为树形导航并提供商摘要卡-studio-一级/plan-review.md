# 计划审批书：Settings 树导航与 Provider Hub

本文件是进入实现前的用户审阅入口。UI 原型交付已就绪并完成交付说明，等待用户对计划与原型的审批。

- [x] UI designer 已正式审阅并交付 HTML 原型成果，满足门禁要求。

## 相关材料

- 背景、已确认决策与边界：[`brief.md`](brief.md)
- PRD 与验收标准：[`prd.md`](prd.md)
- UI 说明与门禁状态：[`ui.md`](ui.md)
- HTML 交互原型草案：[`settings-tree-provider-hub-prototype.html`](settings-tree-provider-hub-prototype.html)
- 技术设计：[`design.md`](design.md)
- 可执行 DAG：[`implement.md`](implement.md)
- 检查清单：[`checks.md`](checks.md)
- 规划交接：[`handoff.md`](handoff.md)

## 已确认产品决策

1. 采用方案 B：树形导航 + 提供商策略摘要卡。
2. Studio 是与分组平级的一级直达入口。
3. Provider Hub 固定先展示 ChatGPT / OpenCode Go / Grok / Kiro 四卡，再进入详情。
4. Trellis 位于“工具”，与 Terminal / Editor 同级。
5. 保留 13 个既有 `SettingsSection` id 和 Studio 成员深链。
6. 不实施方案 C，不移动 Models 账号管理，不改变配置 API/schema。

## PRD 摘要

### 新 IA

```text
会话与工作区（蛋黄𝝅 / WorkTree）
Studio（一级）
模型与用量（Usage / 模型价格 / 提供商策略 → 4 providers）
工具（Terminal / Editor / Trellis）
系统（诊断）
```

### 核心验收

- 分组可折叠，叶子有非纯颜色选中态。
- Provider Hub 四卡反映当前 Settings 草稿；OpenCode Go 用量明确“未提供”。
- Hub→详情→Hub 路径一致。
- `initialSection="studio"` 与 `studioFocusMember` 自动定位、高亮不回归。
- `≤640px` 使用顶部纵向可滚动树，不压成多级横向 tabs。
- 键盘支持方向键、Home/End、Enter/Space；状态有文字口径。

## UI 摘要

HTML 原型已由 UI 设计员确认交付：[`settings-tree-provider-hub-prototype.html`](settings-tree-provider-hub-prototype.html)

原型可交互查看：
- 树分组展开/折叠与 provider 子叶高亮；
- Studio 一级与模拟 Members 深链高亮，支持模拟滚动与高亮保持；
- 四 provider 摘要卡联动草稿状态与详情页返回；
- 明暗主题切换支持；
- 浏览器宽度缩小后的纵向树/单列卡响应式表现（`≤640px` 限高 `36dvh` 滚动）。
- Roving tabindex 键盘操作辅助。

UI 设计员审阅并修订了该 HTML，并将最终交付说明与结论记录于 [`ui.md`](ui.md)。

## Design 摘要

- 保持真实 `SettingsSection` 联合类型不变，新增仅前端的 `SettingsView = SettingsSection | "providerHub"`。
- 新增 `SettingsTreeNavigation`：只管理树呈现、展开回调与键盘焦点。
- 新增 `SettingsProviderHub`：只接收当前配置草稿的安全布尔值，不 fetch、不保存、不读取账号/quota。
- `SettingsConfig` 继续拥有配置草稿、dirty/save/reset、现有详情表单和 Studio focus effect。
- 外部 `initialSection` 只接受真实 section；选中/深链时由稳定 ancestor 映射自动展开祖先。
- `/api/web-config` 请求体、`pi-web.json`、`models.json` 和 provider API 均不变。

## Implement 摘要

详见 [`implement.md`](implement.md) 中 schemaVersion 2 DAG，建议 `maxConcurrency=3`：

1. 并行实现树导航组件。
2. 并行实现 Provider Hub 组件。
3. 单一集成写者接入 `SettingsConfig`、详情返回和 Studio 深链。
4. 与集成并行完成响应式/a11y 样式（不同时修改 `SettingsConfig.tsx`）。
5. 同步 `docs/modules/frontend.md`。
6. checker 执行 lint/tsc 与浏览器人工验收。

## Checks 摘要

自动验证：

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

人工重点：

- 树层级、Studio 一级、Trellis 工具归属；
- 四卡状态口径、Hub/详情/返回、未保存草稿同步；
- Members→Studio 深链和目标成员高亮；
- 320/390/640px、明暗主题、200% zoom；
- 全键盘树操作与可见焦点；
- 打开 Hub 不产生新的 quota/account/provider 请求；
- Save/Cancel/Reset/dirty 与全部旧叶子无回归。

## 风险与回滚

| 风险 | 缓解 |
| --- | --- |
| 虚拟 Hub 破坏稳定 section 契约 | 用独立 `SettingsView`；外部 `initialSection` 不扩宽。 |
| 摘要与草稿漂移 | Hub 直接接收当前 draft，不复制本地业务状态。 |
| 三级树窄屏不可用 | 小屏使用顶部纵向限高滚动，provider 卡单列。 |
| ARIA tree 半实现 | 完整实现标准键盘；否则降级到正确 nav/button，而非错误 ARIA。 |
| 深链选中项被折叠 | section→ancestor 稳定映射在每次深链时展开祖先。 |
| 需要紧急回滚 | 代码恢复旧扁平导航；无数据、API 或配置迁移。 |

## 审批前门禁状态

- [x] PRD / Design / Implement / Checks 已完整。
- [x] HTML 原型文件存在且可交互审阅。
- [x] UI designer 已完成正式审阅并交付/确认 HTML 原型。
- [ ] 用户批准原型与本计划。
- [ ] Implementation Plan 已由主会话保存到任务状态。

## 审批请求

UI designer 门禁补齐后，请用户确认：

- [ ] 批准此 IA、HTML 原型与实现计划，可进入实现。
- [ ] 要求修改原型或规划后重新提交。

在明确批准前不得进入 `implementing`。
