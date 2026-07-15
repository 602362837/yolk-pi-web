# Checks — IMP-001 最大合理替换

## 需求覆盖

- [ ] CSS 宿主无关：`[data-icon-flow]` 不依赖必须是 `.tech-action-tag`。
- [ ] 未设置 `data-icon-flow` 的控件无持续图标流动。
- [ ] 无 `button` 全局强制 animation / 无边框扫光回潮。
- [ ] B0 顶栏/侧栏/Branches 行为等价。
- [ ] B1 Chat 底栏 + Browser Share + Message actions 白名单已替换。
- [ ] B2 侧栏工作区工具条已替换；会话行黑名单未接入。
- [ ] B3 文件/Usage/Models/Skills 工具条已替换；Close/Delete/Disable 行未接入。
- [ ] B4 尽量完成或 handoff 记录偏差。
- [ ] 黑名单抽样静止：Delete、Close、Stop、Git spin refresh、解绑/拒绝。
- [ ] `off` / `:disabled` / `prefers-reduced-motion` 无 overlay 动画；base 可读。
- [ ] 文档含接入步骤与黑白名单。
- [ ] 无 API/session/SSE 改动。

## 自动验证

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

```bash
rg -n "data-icon-flow|ActionFlowIcon|iconFlowAttrs|action-flow-icon__overlay" components app/globals.css docs/modules/frontend.md
rg -n "action-icon-flow" app/globals.css
rg -n "button[^{]*\{[^}]*action-icon-flow|button:hover[^{]*\{[^}]*animation" app/globals.css
rg -n "data-icon-flow" components --glob "*.tsx"
```

判读：

- 含 `data-icon-flow` 的文件应覆盖 B0–B3 目标组件（至少：`AppShell`、`BranchNavigator`、`BrowserShareControl`、`ChatInput`、`MessageView`、`SessionSidebar`、`FileViewer`、Usage/Models/Skills 相关）。
- `action-icon-flow` 只绑在 `[data-icon-flow=…] … .action-flow-icon__overlay`。
- 第三组不得命中全 button 强制规则。

## 浏览器人工

### 白名单（应流动）

1. 顶栏 interactive；侧栏 ambient 错峰；Skills disabled 静。
2. Chat：Attach image/file、Browser Share pill、Send/Steer/Follow-up、Compact（idle）、吸底/提示音 — hover/focus 线条流动。
   - **硬门禁（用户）：** Send（及同类主操作图标钮）在 `:focus-visible` / hover / active 时 **不得整钮漂白**；图标 base stroke 与背景保持可读对比；focus 用 outline/ring，禁止白底 + 浅色/白图标导致“啥也看不到”。
3. Message：Copy / Edit — hover 流动。
4. SessionSidebar 工具条：新建/工作树/刷新/Workspace — hover 流动。
5. Usage/Models/Skills/FileViewer 工具条 Refresh/Add/Add to chat — hover 流动。

### 黑名单（必须静止）

1. 会话行 Delete/Archive/Rename、Expand forks。
2. Tab/Modal Close、附件 remove X、Terminal Close / 结束进程。
3. Stop Agent 实心钮、Browser Share 解绑/拒绝。
4. GitPanel Refresh（spin）不叠加 stroke-flow。
5. 随机普通 Settings 主按钮若未 opt-in 则静止。

### 系统态

1. reduced-motion：全部 overlay 停。
2. disabled Export/Skills 等静。
3. 深/浅主题 1440；可选 640 底栏不裁切 SVG。
4. Branches dropdown 锚点无回归。

## 风险判定

### Blocker

- 未 opt-in 区域大面积流动。
- 黑名单危险/关闭/行内被接入 flow。
- 顶栏/侧栏/发送等业务回归。
- Send/主操作图标钮 focus 后整钮漂白、图标不可见。
- reduced-motion/disabled 仍持续动画。
- base 图标消失。
- B1–B3 白名单大面积未做却声称完成。

### High

- ambient 扩散到顶栏/表单默认态。
- ModelsConfig 行内 Disable 被接入。
- 文档引导无黑名单的“全部 icon button 都加”。
- 双动画（spin+flow）。

## 证据要求

handoff 必须写：各批文件列表、B4 跳过项、lint/tsc、静态搜索、实际浏览器范围、已知偏差。
