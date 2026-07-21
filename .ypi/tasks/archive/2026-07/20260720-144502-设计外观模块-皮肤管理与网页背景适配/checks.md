# Checks：外观模块、背景皮肤与 Studio 审批安全

## 0. 前置门禁

- [x] `appearance-skins-prototype.html` 由 UI 设计员交付，不是纯 Markdown。
- [x] `ui.md` 已链接 HTML；用户明确批准记录仍待补充。
- [x] `plan-review.md` 汇总 PRD/Design/Implement/Checks 并链接 HTML。
- [ ] PRD §6 的 scope、auto-activate、global/local、fit、dependency、limits、active delete 决策已确认。
- [x] Studio 审批边界已确认：只接受短句/明确命令，兼容中英文；讨论、引用、排查反馈和否定不触发。
- [ ] implementationPlan（APP-01…APP-09）已由主会话保存；实现按 DAG claim。

缺任一项不得开始实现/检查生产代码。

## 1. 需求覆盖

### Settings 与 catalog

- [ ] Settings tree 新增稳定 `appearance` root leaf，所有 exhaustive mapping 已更新。
- [ ] tree 键盘 Arrow/Home/End/Enter/Space、roving tabindex、deep-link 不回归。
- [ ] Appearance 是即时保存域，不进入 `/api/web-config` 草稿/dirty/PUT。
- [ ] 默认外观、空态、单/多皮肤、active 文本状态、重命名、上传、删除齐全。
- [ ] 通用 Save/Reset 在 appearance view 不误导用户。

### 呈现

- [ ] `cover` 保持比例、铺满、按锚点视口裁剪，不改原图。
- [ ] `contain` 完整显示且留白为 theme-aware fallback。
- [ ] `stretch` 铺满并明确可能变形；position disabled。
- [ ] `original` 不放大、按锚点定位。
- [ ] 3×3 position 与底层 0–100 x/y 映射一致。
- [ ] overlay tone/opacity、panel opacity 在范围内并即时反映。

### 删除/切换

- [ ] 新 active full image `decode()` 成功后才替换；失败保留旧图。
- [ ] 普通删除与 active 删除确认文案不同。
- [ ] active 删除由单 API/store 事务回默认并删除。
- [ ] stale revision 409 会刷新/提示，不静默覆盖。

## 2. Studio 审批意图安全

### 纯函数矩阵

- [ ] 输入执行 NFKC、trim/水平空白规范化；不剥离引号或从长文本提取审批子句。
- [ ] 单一短句与 Unicode code point 上限集中为常量并由测试冻结；换行、多段、超长文本拒绝。
- [ ] 中文明确命令通过：`确认`、`批准`、`同意该方案`、`确认，开始实现`、`确认开始实现`、`批准开始实现`、`按方案做`、`可以开始实现`。
- [ ] 英文明确定命令通过：`approve`、`I approve this plan`、`go ahead`、`please proceed`、`start implementation`。
- [ ] 根因句 `排查浮窗批准问题` 及 `为什么会误触发批准`、`用户说：批准`、`“批准”`、普通讨论均拒绝。
- [ ] `不批准`、`先别实现`、`需要修改`、`not approved`、`do not proceed`、`wait`、`revise it` 均拒绝。
- [ ] 正向匹配是整句 allowlist，不是关键词 search；增加否定黑名单不能替代该约束。

### 服务端门禁与集成

- [ ] bound + awaiting 主任务收到任一负样例后不写 `meta.approvalGrant`，audit event 也不伪造 approval。
- [ ] 负样例后 `awaiting_approval -> implementing` 仍因 no grant 阻断，`override` 不绕过。
- [ ] 明确命令只在 awaiting/context/material/time 门禁满足时写 `source=user-input` grant。
- [ ] 改进计划负样例不写 instance approval；明确命令仍需 `waiting_plan_approval`、context、plan-review 和 UI evidence。
- [ ] `lib/ypi-studio-extension.ts` input 事件用真实根因句测试，用户消息不变且 grant 为空。
- [ ] Widget `approve_plan` / `approve_improvement_plan` typed action 回归通过，不依赖自由文本 parser，revision/material/binding CAS 不变。
- [ ] `approvalGrant`、`inputHash`、event/wire schema 不变；不迁移或删除历史 grant。

## 3. 自动验证

```bash
npm run test:appearance
npm run test:studio-dag
npm run test:studio-extension-sci
npm run test:studio-widget-actions
npm run lint
node_modules/.bin/tsc --noEmit
```

仅 closeout/release-style dependency 验证：

```bash
PI_CODING_AGENT_DIR="$(mktemp -d)" npm run build
```

- [ ] 未直接运行 `next build`。
- [ ] build 使用隔离 agent dir，产物 grep 无真实 home、worktree、appearance path/id。
- [ ] unrelated pre-existing failures 被单独记录，没有用忽略规则掩盖新失败。

## 4. Store / 事务检查

- [ ] 测试使用临时 `PI_CODING_AGENT_DIR`，且在动态 import 前设置。
- [ ] 无目录读取等价默认外观；无迁移写。
- [ ] schema-v1 正常读写；malformed/unknown schema fail closed 且不覆盖。
- [ ] opaque revision 对 metadata mutation 稳定，stale CAS 返回 409。
- [ ] 两个并发 upload/update/delete 不损坏 JSON、不丢 active pointer。
- [ ] 上传：asset rename 成功/index 失败时回收资产，不报告成功。
- [ ] 删除：trash rename/index 失败时回滚；成功 index 不引用已删 asset。
- [ ] active delete 同事务 `activeSkinId=null`。
- [ ] `.tmp/.trash` cleanup 不删除 index 引用文件。
- [ ] Unix 上目录/文件 best-effort 0700/0600。
- [ ] index/wire/log 无绝对 path、原图 bytes、data URL、EXIF、decoder raw error。

## 5. 图片安全矩阵

| 输入 | 预期 |
| --- | --- |
| 正常 JPEG/PNG/static WebP | auto-orient、resize、metadata-free WebP full+thumb |
| 扩展名 `.jpg` 实为 SVG/HTML/GIF | 拒绝 |
| SVG 含脚本/外链 | 拒绝，外链不请求、不落盘、不回显 |
| animated WebP/GIF | 拒绝 |
| 损坏/截断图片 | 安全 `decode_failed` |
| 空文件/多文件/额外 body key | 400 |
| >20 MiB | 413/稳定 size code，无码盘残留 |
| >40 MP | 拒绝 pixel_limit |
| 长边 >4096 但像素合规 | 缩小，不放大小图 |
| 恶意 filename/path traversal/control chars | 仅清洗 display name，不影响路径 |
| 到达 30 skins/100 MiB | mutation 前拒绝，无 orphan |

- [ ] 输出不包含 EXIF GPS/作者/相机信息、ICC/XMP sentinel。
- [ ] 输出 MIME、实际 signature、route Content-Type 一致。
- [ ] image processor concurrency 有界，无无限队列。
- [ ] `sharp`（若批准）为直接 exact pin，并更新 lock/shrinkwrap；发布平台安装 smoke 通过。

## 6. API / 隐私检查

- [ ] `GET /api/appearance` metadata `no-store`，返回 limits/revision、安全 URLs。
- [ ] POST/PATCH/DELETE 字段白名单；unknown field fail closed。
- [ ] mutation 使用 `If-Match` 或冻结后的单一 revision 机制，不混用含糊语义。
- [ ] asset route 只接受 opaque id + `full|thumbnail`。
- [ ] unknown id/variant/path/query 安全拒绝。
- [ ] asset response：`image/webp`、`nosniff`、private immutable cache、ETag。
- [ ] API 不接受 remote URL、data URL、server path 或 CSS string。
- [ ] 错误只返回固定 `code/message`，无 stack/path/decoder raw text。
- [ ] wire exact-key allowlist不含 hash、source metadata、lock、quota filesystem detail。

## 7. 首屏与客户端状态

- [ ] active skin 首屏 server HTML 已包含 safe appearance data/vars；不是 mount 后才出现。
- [ ] layout 明确 force dynamic/no-store，构建时不读入并固化用户真实外观。
- [ ] bootstrap 只含 opaque app-local asset URL，不含绝对路径。
- [ ] `pi-theme` 现有 localStorage 恢复仍工作，theme 与 active skin 正交。
- [ ] stale fetch/decode generation 无法覆盖新切换。
- [ ] same-tab subscriber、BroadcastChannel、focus/visibility revalidate 收敛。
- [ ] 无固定轮询、scroll listener、持续 animation、base64/object bytes state。
- [ ] API不可用/active asset missing/decode failure不阻塞 Chat。

## 8. 全局视觉人工矩阵

### 视口

- [ ] 1920×1080（sidebar + right panel）
- [ ] 1366×768（常见笔电）
- [ ] 768×1024（tablet portrait）
- [ ] 390×844（mobile）
- [ ] resize、sidebar 220–520、right panel 开/关/resize、terminal dock 开/关

### 图片比例与模式

- [ ] 16:9、4:3、1:1、9:16 × cover/contain/stretch/original
- [ ] cover/original × 9 anchors
- [ ] panel opacity min/max；overlay opacity 0/max
- [ ] overlay auto/light/dark × light/dark theme

### Surface inventory

- [ ] body/AppShell 根能看到背景且不拦截 pointer。
- [ ] Sidebar、session rows、topbar、Chat list/message/code、ChatInput。
- [ ] right Preview/FileExplorer/FileViewer、Studio、Trellis。
- [ ] Settings shell/tree/forms、Models/Skills/Usage modal。
- [ ] AppPrompt confirm、toast、dropdown、popover、provider usage panel、Git/System/Subagents。
- [ ] Studio/Trellis floating widget。
- [ ] Monaco/xterm/高密度 diff/preview 保持实色或足够不透明。
- [ ] 默认无 skin 时与当前 light/dark 视觉近似，不产生全局透明回归。

### 对比度与 motion

- [ ] 文本/控件状态不依赖图片本身颜色；veil/panel 下限有效。
- [ ] focus ring 在复杂背景上仍可见。
- [ ] `prefers-reduced-motion` 下无 crossfade/scale/shimmer；功能不变。
- [ ] View Transition 切 theme 不产生背景层闪白、stacking 错位。

## 9. UI / 可访问性

- [ ] 生产 UI 与用户批准 HTML 原型逐状态比对。
- [ ] skin 卡片 whole-row keyboard activation，active 有文字/图标/ARIA。
- [ ] 3×3 anchors 是 radiogroup 或等效语义，方向 label 完整。
- [ ] sliders 有 name/value/range，键盘可调。
- [ ] upload input 限制与服务端一致；drag/drop 多文件不静默取第一张。
- [ ] processing 状态不用伪精确百分比，`aria-live=polite` 不刷屏。
- [ ] delete confirm trap/restore focus；busy 时目标明确且不可重复提交。
- [ ] ≤640px 不横向溢出、不隐藏关键操作、Settings nav 可滚动。

## 10. 性能与长期运行

- [ ] 页面只请求 active full asset；catalog 使用 lazy thumbnail。
- [ ] 切换先 preload/decode，不重复请求无关 full assets。
- [ ] normalized long edge/quality/bytes 受控；不保留原图。
- [ ] 背景使用 fixed layer，不触发布局 reflow；无 blur/backdrop-filter。
- [ ] 30 张 catalog 滚动流畅，无一次性加载 full。
- [ ] 连续上传/删除后 temp/trash/thumbnail/full 数量与 index 可对账。
- [ ] 服务运行中图片 decode/processing 不阻塞普通 GET/Chat 主流程到不可用。

## 11. 回归检查

- [ ] 原有顶部 light/dark 按钮、View Transition、`pi-theme` 持久化。
- [ ] `/api/web-config` schema、Settings 普通 Save/Reset、Links immediate view。
- [ ] AppShell Sidebar/Chat/right panel/terminal resize 与 z-index。
- [ ] AppPrompt body scroll/inert、portal focus。
- [ ] published `ypi` 在无 appearance 数据、无 decoder运行错误时正常启动（若 decoder为必需依赖则安装错误有清晰诊断）。
- [ ] 现有 Studio 明确中文/英文 user-input 审批、Widget CTA、主计划和改进计划推进路径。

## 12. Blocker 条件

以下任一项阻止合入/交付：

- 缺少用户对已交付 HTML 原型和计划的审批。
- 皮肤 scope/auto-activate/global-local/limits/dependency 等关键产品决策未冻结。
- Studio 审批仍以任意子串命中，或真实根因句/引用/否定/长讨论可写入 grant。
- Studio 明确中英文短命令被全部阻断，主计划与改进计划规则不一致，或 Widget 显式审批被文本 parser 影响。
- 接受 SVG/动画/remote URL，或只信任扩展名/MIME。
- 输出保留敏感 metadata，或 wire/log 暴露绝对路径。
- active delete / 并发 mutation 可产生 split-brain 或虚假成功。
- build 可能固化构建机 appearance。
- 无 active skin 也改变现有全局视觉。
- 关键弹窗、输入、编辑器/终端在最低 panel opacity 下不可读。
- native image dependency 未验证目标发布平台且无安全替代方案。
- 实现偏离已批准 HTML 原型且未重新审批。
