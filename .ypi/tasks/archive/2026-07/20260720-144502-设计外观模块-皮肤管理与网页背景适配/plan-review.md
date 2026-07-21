# 计划审批书（草案）：外观模块、皮肤管理、网页背景适配与 Studio 审批安全

## 当前结论

架构规划与 UI 设计员 HTML 原型均已完成，并已加入并列的 Studio 审批安全修复范围。当前仍处于 `planning`：用户尚未批准本审批书/HTML，更新后的 APP-01…APP-09 implementation plan 也尚未由主会话正式保存到 task，因此**不得进入 implementing**。

主会话应确认或让用户在本次审批中确认下方外观产品决策，正式保存机器计划，再通过本审批入口请求「批准 / 需要修改」。Studio 修复边界已确认：只有短句/明确命令的中英文审批意图可授权；讨论、引用、排查反馈和否定不得触发。

## 审批材料

- [Brief / 现状证据、边界与推荐基线](brief.md)
- [PRD / 目标、范围、R1–R12 与验收](prd.md)
- [UI / 原型门禁与 UI 设计员委托](ui.md)
- **HTML 原型：[appearance-skins-prototype.html](appearance-skins-prototype.html)**
- [Design / store、图片安全、API、首屏、CSS 与同步](design.md)
- [Implement / APP-01…APP-09 DAG 与机器计划](implement.md)
- [Checks / 自动、安全、视觉、响应式与回归矩阵](checks.md)

## PRD 摘要

- Settings 新增 root-level `外观`，管理「背景图片 + fit/position + 可读性参数」皮肤。
- 上传、重命名、切换、删除即时保存；不进入通用 `pi-web.json` Settings 草稿。
- fit：覆盖裁剪 `cover`、完整显示 `contain`、拉伸 `stretch`、原始尺寸 `original`。
- position：UI 3×3，底层 x/y 0–100。
- 可读性：auto/light/dark veil、遮罩强度、主要面板不透明度；关键弹窗和 Monaco/xterm 保持高不透明。
- 上传只接受本地 JPEG/PNG/static WebP；拒绝 remote URL、SVG、GIF/动画、视频。
- 不做完整配色主题、项目级皮肤、图库市场、裁剪编辑器、滤镜/blur。
- 并列修复 Studio 用户输入审批：从关键词任意子串改为 NFKC/空白规范化、短句限制、否定优先、整句中英文命令 allowlist；「排查浮窗批准问题」、引用、普通讨论和否定不写 grant。
- 主计划与改进计划共用同一意图 helper；状态、session binding、plan-review/UI evidence、revision/时间门禁及 Widget 显式 action 保持不变。

## Design 摘要

- 独立数据域：`<agentDir>/appearance/index.json` + `appearance/skins/*.webp`，避免 binary lifecycle 与 Settings stale save 冲突。
- 服务端 decoder 自动方向、剥离 metadata、限制字节/像素、缩放并输出 WebP full + thumbnail；推荐 exact-pinned `sharp`，实现前验证发布平台。
- catalog/mutation 使用 opaque revision CAS；store 有进程队列、跨进程 lock、0700/0600、原子 index、上传 rollback、删除 quarantine rollback。
- API：`GET/PATCH /api/appearance`、`POST /api/appearance/skins`、`PATCH/DELETE /api/appearance/skins/[id]`、opaque asset route。
- RootLayout 读取安全 bootstrap 并 force dynamic，避免首屏闪烁与构建机配置固化；不内联绝对路径。
- fixed background + veil 位于 AppShell 下；active-only semantic tokens 让普通 pane 透明，elevated/tool surfaces 保持实色。
- `useAppearance` 负责 decode-before-switch、generation guard、same-tab notify、BroadcastChannel、focus revalidate；无轮询。
- Studio 文本门禁采用纯、fail-closed parser；不从长文本抽取关键词，不剥离引用符，不使用 AI/NLP。文本通过后仍需既有服务端授权条件。

## Implementation Plan 摘要

schemaVersion 2，最大并发 2，共 9 项：

1. `APP-01` appearance contracts、limits、transactional store。
2. `APP-09` Studio 审批短句/整句 parser、主/改进服务端门禁及扩展/Widget 回归；与 APP-01 并行。
3. `APP-02` image normalization、catalog/mutation/asset API、dependency。
4. `APP-03` dynamic first-paint bootstrap、client sync。
5. `APP-04` global background 与 surface audit；可与 APP-03 并行。
6. `APP-05` 按批准 HTML 实现 Settings UI。
7. `APP-06` appearance security/transaction/runtime/UI focused tests。
8. `APP-07` architecture/API/frontend/library/dependency/deployment/ops docs；可与 tests 并行。
9. `APP-08` lint/tsc/appearance + Studio approval tests/build packaging 与 checker closeout。

完整机器计划见 [implement.md](implement.md) 的 fenced `json ypi-implementation-plan` 块。当前未写入 `task.json`，应由主会话通过 Studio 正式保存，不由 architect 子会话直接修改任务状态文件。

## Checks 摘要

- 自动：`npm run test:appearance`、`npm run test:studio-dag`、`npm run test:studio-extension-sci`、`npm run test:studio-widget-actions`、`npm run lint`、`node_modules/.bin/tsc --noEmit`。
- release-only：隔离 `PI_CODING_AGENT_DIR` 后 `npm run build`，不得直接 `next build`。
- 图片安全：格式 spoof、SVG/外链、animation、解压像素、metadata、恶意 filename、path/error/log sentinel、revision/故障注入、permissions。
- Studio 安全：正负中英文表驱动 parser、真实根因句、引用/排查/否定/多行/超长、主计划与改进计划 grant 落盘/transition 阻断、扩展 input 与 Widget CTA 回归。
- UI：light/dark、4 种 fit、9 anchors、opacity extrema、1920/1366/768/390、sidebar/right panel/terminal、keyboard/focus/reduced motion。
- Blocker：用户审批缺失、审批仍可任意子串误触发、active delete split-brain、路径/metadata 泄漏、build 固化本机数据、关键 surface 不可读、native dependency 平台未验证。

## 需要主会话 / 用户确认的产品决策

1. **P0 皮肤范围**：只做背景皮肤，不做完整色板主题。推荐确认。
2. **上传成功**：是否自动激活。推荐自动激活；失败保持旧 active。
3. **持久化范围**：服务实例全局；light/dark 仍浏览器本地。推荐确认。
4. **fit**：是否接受 `original` 第四模式；不做 repeat/tile。推荐接受。
5. **图片依赖**：是否接受 exact-pinned `sharp`，以保证实际解码、metadata 剥离与安全输出。推荐接受，发布矩阵验证是 blocker。
6. **限制**：输入 20 MiB、40 MP、输出长边 4096、最多 30 张、总资产 100 MiB。请确认或调整。
7. **active 删除**：一次强确认后，服务端原子切默认并删除。推荐允许。
8. **Settings 树位置**：推荐 root-level「外观」置于 Studio 前，请 UI 原型确认。

## UI 审批门禁

UI 设计员 HTML 已覆盖：默认/多皮肤、上传/processing/错误、4 fit、3×3 position、veil/panel opacity、切换 decode failure、revision conflict、普通/active 删除、light/dark、≤640px、键盘、reduced motion，并模拟真实 AppShell 半透明表面。

- [appearance-skins-prototype.html](appearance-skins-prototype.html)（已由 UI 设计员交付并通过本地原型测试；待用户审批）

## 风险与回滚

主要风险是现有 opaque pane 遮住背景、透明 surface 对比不足、图片解压/metadata、asset/index split-brain、首屏/build 读取本地状态、native decoder 发布兼容，以及 Studio 审批 allowlist 过宽误授权或过窄阻断合法短句。设计通过 active-only semantic tokens、veil/opacity 下限、规范化输出、revision+事务、force-dynamic bootstrap、平台验证和中英文正负门禁矩阵缓解。

外观回滚只需忽略 active appearance attribute、恢复原 tokens 并隐藏 Settings 入口；保留 `<agentDir>/appearance/`，不删除用户资产，不修改 sessions/models/pi-web。Studio parser 出现兼容问题时只允许收缩/修正已测试整句 allowlist并引导使用 Widget CTA，不得回到任意子串匹配；历史 grant 不迁移。

## 下一步（不是审批请求）

1. 主会话确认/调整 8 项外观产品决策；Studio 审批安全边界无需再猜测。
2. 主会话正式保存 [implement.md](implement.md) 中 APP-01…APP-09 机器计划。
3. 主会话通过本审批书与已交付 HTML 向用户正式请求「批准」或「需要修改」。
4. 只有明确批准且 Studio 状态更新后才可派发实现员。

**当前不得把本草案或任务描述中的「批准」字样视为用户已批准。**
