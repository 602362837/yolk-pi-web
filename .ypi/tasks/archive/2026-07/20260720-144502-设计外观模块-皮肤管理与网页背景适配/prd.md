# PRD：外观背景皮肤与 Studio 审批意图安全

## 1. 目标与背景

本任务并列交付两个范围：

- YPI Web 当前只有 light/dark 切换，页面主体由不透明 semantic surface 填充，用户无法设置全局网页背景。新增 Settings → 外观，使用户可安全上传背景图片、保存为皮肤、切换/调整/删除，并让页面在桌面、窄屏、左右面板和不同图片比例下保持可读。
- YPI Studio 当前以任意子串识别用户审批，导致「排查浮窗批准问题」等普通讨论在任务处于 `awaiting_approval` 时误写 `approvalGrant`。收紧服务端审批意图门禁，只让短句、明确命令形式的中文或英文审批通过。

### 用户价值

- 不改项目文件即可个性化本地 YPI 工作台。
- 同一皮肤在 Chat、Sidebar、Preview、Studio/Trellis drawer、Settings/弹窗中有一致背景语义。
- 用户可明确选择「覆盖裁剪、完整显示、拉伸、原始尺寸」而非接受不可控变形。
- 大图与不安全图片在服务端被限制、规范化，不拖垮长期运行的工作台。

### 成功标准

- active 皮肤首屏稳定呈现，不出现明显的默认白底闪烁。
- 背景不影响文字、输入、弹窗和编辑器可读性。
- 上传、切换、改参数、删除均有清晰状态和错误恢复；不会泄漏绝对路径。
- 图片资源与 metadata 有上限、原子性和并发保护。
- Studio 普通讨论、引用「批准」、排查反馈、否定/等待/修改语句不再创建授权；明确中英文审批短句仍可正常推进主计划和改进计划。

## 2. 用户与场景

1. 用户从 Settings → 外观上传一张桌面壁纸并立即预览。
2. 用户保存多张皮肤，在缩略图列表中一键切换。
3. 竖图在宽屏用 `cover + top`，不希望主体被居中裁掉。
4. Logo/插画用 `contain`，接受留白但不接受变形。
5. 用户需要 `stretch` 以强制铺满，UI 必须说明可能改变宽高比。
6. 用户在小屏、侧栏开关、右 Preview/Studio/Trellis 面板变化时，背景自动重新布局，不修改原图。
7. 用户删除当前皮肤，明确确认后回到默认纯色外观。
8. 用户说「排查浮窗批准问题」或引用「批准」进行讨论，Studio 保持 awaiting 状态且不写 grant。
9. 用户明确回复「确认，开始实现」或 `I approve this plan`，既有服务端状态/绑定/material/revision 门禁满足时才记录 grant。

## 3. 范围

### 3.1 范围内（P0）

- Settings 树新增稳定 root leaf `appearance`（推荐置于 Studio 之前）。
- 皮肤 catalog：上传、重命名、切换、删除。
- 全局默认背景（`activeSkinId = null`）与当前 active 皮肤。
- 每个皮肤的呈现参数：
  - `fit`: `cover | contain | stretch | original`
  - `position`: x/y 0–100；UI P0 提供 3×3 锚点
  - `overlayTone`: `auto | light | dark`
  - `overlayOpacity`: 0–80（默认建议 18）
  - `panelOpacity`: 70–100（默认建议 90）
- 设置区 live preview；已持久化操作即时作用当前网页。
- 背景层适配 AppShell、Sidebar、Chat、右面板、Settings、popover/modal；Monaco/xterm 等高密度工具保持不透明或接近不透明。
- 图片服务端验证、规范化、缩略图、磁盘配额和并发 revision。
- 首屏 server bootstrap、同标签即时更新、同浏览器跨标签同步、window focus/visibility revalidate。
- light/dark 联动遮罩，但不迁移现有主题偏好。
- 收紧 `isExplicitYpiStudioApprovalText()`：Unicode/空白规范化、短句长度与单段限制、整句锚定的中英文命令 allowlist、否定/等待/修改 fail-closed。
- 主计划与改进计划的 `user-input` grant 共用同一审批意图判定；现有 awaiting 状态、session binding、plan-review/UI evidence、revision/时间顺序门禁继续生效。
- 回归测试覆盖纯判定、扩展 input 入口、主计划/改进计划服务端落盘与 transition 阻断；Widget 显式 action 行为保持不变。

### 3.2 范围外

- 完整配色主题、字体/图标/圆角皮肤。
- 项目/space/session 级皮肤。
- 远程 URL、在线图库、SVG、GIF/动画、视频。
- 手工裁剪画布、滤镜、模糊、视差或持续动画。
- 原图下载、原 EXIF 保留、图片编辑历史。
- 跨服务实例实时推送；P0 只保证同浏览器跨标签和聚焦校准。
- AI/NLP 审批分类、模糊关键词评分、从普通长文本推断授权、客户端单独拦截、历史 grant 自动迁移或清理。
- 改变 Widget `approve_plan` / `approve_improvement_plan` 的显式 action、revision CAS 或材料门禁。

## 4. 需求与验收标准

### R1. 外观入口与信息架构

- Settings 新增稳定 section id `appearance`，可键盘访问与 deep-link。
- 进入外观视图时显示当前 active 状态、皮肤列表、上传入口和预览编辑区。
- 外观操作即时保存；通用 Settings Save/Reset 在该 view 隐藏或禁用，并显示「外观操作即时保存」。

**验收**：Settings tree Arrow/Home/End/Enter/Space 行为不退化；窄屏仍可访问列表、预览和操作。

### R2. 上传

- 只接受一个本地图片文件。
- UI 在选择前说明格式与限制；上传显示 processing 状态，可取消客户端请求。
- 服务端只接受 JPEG/PNG/WebP，依据内容签名与实际解码结果，不信任扩展名或 `Content-Type`。
- 上传成功生成新皮肤但是否自动 active 由产品决策；本计划推荐「成功后自动选中并激活」，失败保留当前 active。

**验收**：非法格式、SVG、动画、多文件、空文件、过大字节、过大像素、损坏图片、配额满都有稳定错误；错误不含绝对路径或底层 decoder 原文。

### R3. Catalog 与命名

- 卡片展示缩略图、名称、尺寸、创建时间、active 状态。
- 默认名来自经过清洗/截断的原文件 basename；允许重命名。
- catalog 稳定排序：active 优先，其余 `updatedAt` 降序。

**验收**：名称 1–80 字，去控制字符；wire/DOM 不出现服务器文件路径、hash 原文或原图 metadata。

### R4. 切换与默认背景

- 点击皮肤或「默认外观」可切换 active。
- 新图片必须在浏览器 decode 成功后再替换背景；decode 失败时保持旧背景并提示。
- active 状态以服务端 revision 为准；冲突时刷新 catalog，不做 last-write-wins 静默覆盖。

**验收**：切换不造成空白闪烁；刷新页面/重启服务后保留；并发标签冲突可恢复。

### R5. 尺寸模式

- `cover`：保持比例、铺满视口、超出部分按 position 非破坏性裁剪。
- `contain`：保持比例、完整可见，剩余区域使用 theme-aware fallback/overlay。
- `stretch`：宽高均铺满，允许变形；UI 明确风险。
- `original`：保持像素比例/尺寸、不放大，按 position 定位。

**验收**：16:9、4:3、1:1、9:16 图片在 1920×1080、1366×768、768×1024、390×844 中结果符合定义；窗口 resize 不写回图片或配置。

### R6. 定位

- UI P0 使用 3×3 锚点：左/中/右 × 上/中/下。
- API/store 保存数值 x/y（0–100），CSS 映射 `background-position: x% y%`。
- `stretch` 下定位控件禁用并说明「拉伸已占满整个视口」。

**验收**：cover/original 模式定位可观察；键盘可选择锚点且状态不只靠颜色。

### R7. 可读性与网页适配

- 背景固定覆盖整个 visual viewport；滚动内容不重复移动。
- `overlayTone=auto`：light 使用白色 veil，dark 使用黑色 veil；用户可固定 light/dark。
- `overlayOpacity` 控制背景 veil；`panelOpacity` 控制主要 semantic surfaces 的不透明度。
- prompt/confirm、Settings、popover、编辑器、终端等关键表面必须有更高的最小不透明度，不能因全局 slider 变得不可读。
- active image 时才启用 translucent token overrides；默认背景必须与现状像素级接近。

**验收**：Chat 文本、代码块、输入栏、SessionSidebar、topbar、右面板、Settings、AppPrompt、provider panels、Studio widget 在 light/dark 均可读；背景不拦截 pointer/focus。

### R8. 删除

- 非 active 皮肤可确认后删除。
- active 皮肤必须显示更强确认，明确「删除后切回默认背景」。
- active 删除由服务端单事务执行 deactivation + catalog mutation + 资产隔离/删除。
- 删除失败时卡片与 active 状态保持服务端真实状态。

**验收**：不存在 index 指向已删文件；部分失败不伪造成功；重复 DELETE 返回稳定 not_found/幂等策略（实现前冻结）。

### R9. 存储与配额

推荐硬限制：输入 ≤20 MiB、≤40 MP、长边输出 ≤4096 px、最多 30 个皮肤、规范化资产总量 ≤100 MiB；常量集中在 shared library 并在 UI/API 同源投影。

**验收**：到达数量/总量上限前拒绝且不留下临时文件；孤儿 temp/trash 可在下次 mutation 懒清理。

### R10. 安全与隐私

- 不接受 remote URL、path、data URL、SVG/XML、HTML、GIF/animation。
- 服务端自动方向、剥离 EXIF/ICC/XMP 等 metadata，输出自有 WebP 与 thumbnail。
- API 只按 opaque skin id 取 asset；不得从请求拼接任意路径。
- 错误、响应和日志不包含绝对路径或 decoder raw details。
- 目录/registry/asset 使用 best-effort 0700/0600，写入原子化。

**验收**：伪扩展名、路径穿越、未知 id、恶意 filename、SVG 外链、animated WebP、并发 mutation、故障注入测试通过。

### R11. 性能

- 仅 active full asset 在页面背景中加载；catalog 只加载 thumbnail。
- 输出尺寸与质量受控；asset URL immutable + ETag/private cache。
- 切换前 `Image.decode()`；无持续 JS animation、blur/backdrop-filter 或 scroll listener。
- `prefers-reduced-motion` 下禁用背景切换淡入（若 UI 原型保留淡入）。

**验收**：空闲时无新增轮询；切换后旧 object URL/预加载对象可回收；背景层不触发 layout reflow。

### R12. 启动、失败与兼容

- 旧安装无 `appearance/` 时等价于默认外观，无迁移。
- index 不可解析或 active asset 缺失时 fail closed 到默认背景，并返回安全 warning；不得覆盖损坏文件。
- server-rendered layout 必须 force dynamic 或等效，避免构建时把开发机 appearance 固化进发布产物。
- no-JS/客户端加载失败时仍可显示 server bootstrap 背景；API 失败不影响 Chat 主流程。

**验收**：升级无行为变化；损坏 index、缺 asset、image decode failure 均不阻塞应用使用。

### R13. Studio 审批意图门禁

- `user-input` 审批必须是单一短句或明确命令；规范化后超过冻结上限、多行/多段、带引用/转述语义或不满足整句 allowlist 的文本 fail closed。
- 中文至少兼容「确认」「批准」「同意该方案」「确认，开始实现」「按方案做」「可以开始实现」等明确命令；英文至少兼容 `approve`、`I approve this plan`、`go ahead`、`please proceed`、`start implementation` 等明确命令。最终 allowlist 以测试矩阵冻结，不做任意子串匹配。
- 「排查浮窗批准问题」「为什么会误触发批准」「用户说：批准」「不要批准」「not approved」「wait, do not proceed」及普通长篇讨论不得创建 grant。
- 纯意图 helper 必须同时约束主计划和改进计划 `user-input` 路径；Widget 显式 action 不经过自由文本猜测，行为保持不变。
- 文本通过后仍必须满足任务/改进状态、绑定 context、plan-review/HTML evidence、revision 和 grant 时间顺序等既有服务端门禁；`override` 仍不能绕过。

**验收**：正负中英文表驱动测试通过；扩展 `input` 事件收到排查文本后 `approvalGrant` 仍为空，随后 implementing transition 仍被拒绝；明确命令只在正确状态/绑定/材料条件下授予，主计划和改进计划均覆盖。

## 5. 状态矩阵

- loading / empty-default
- upload idle / selecting / uploading / processing / failed / quota-full / success
- catalog loading / stale / conflict / unavailable
- selected non-active / active / switching / decode-failed
- editing clean / saving / conflict / failed
- delete confirm / active-delete confirm / busy / partial failure
- light / dark
- desktop wide / tablet / ≤640 mobile
- reduced motion
- Studio approval: explicit zh/en command / discussion / quoted term / investigation feedback / negation / wait-or-revise / overlong-or-multiline / wrong status-or-context

## 6. 未决产品决策

主会话应在请求用户审批前确认或采用推荐值：

1. P0「皮肤」是否确认只包含背景，不包含完整色板主题？**推荐：确认。**
2. 上传成功是否自动激活？**推荐：自动激活，失败不改变旧 active。**
3. 外观是服务实例全局，还是浏览器本地？**推荐：服务实例全局；theme mode 保持浏览器本地。**
4. 是否接受 `original` 第四模式？**推荐：接受；不做 repeat/tile。**
5. 是否接受 `sharp` 作为直接 runtime dependency，用于规范化与 metadata 剥离？**推荐：接受，但实现前验证 npm 发布平台。**
6. 推荐 limits（20 MiB/40 MP/4096 px/30 skins/100 MiB）是否可接受？
7. active delete 是否允许一次确认后原子切默认并删除？**推荐：允许。**
8. Settings 是否采用 root-level「外观」并置于 Studio 前？**推荐：采用已交付原型布局。**

## 7. UI 原型门禁

UI 设计员已交付 [appearance-skins-prototype.html](appearance-skins-prototype.html)，覆盖 Settings 树位置、默认/列表/编辑双栏、上传 processing、四种 fit、3×3 position、可读性 sliders、active 删除确认、冲突/错误、light/dark、窄屏、键盘与 reduced motion。用户尚未批准 HTML 与本计划，因此当前 PRD 不授权实现。Studio 审批意图修复没有新增用户可见 UI，不需要单独原型。
