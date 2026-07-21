# Design：外观模块、皮肤资产、全局背景层与 Studio 审批安全

## 1. 方案摘要

本设计包含两个并列技术范围。外观范围新增独立 appearance domain：

- `lib/appearance-types.ts`：浏览器安全契约、限制和 fit/position 映射。
- `lib/appearance-store.ts`：`<agentDir>/appearance/` catalog、asset、revision、锁与事务。
- `lib/appearance-image.ts`：图片签名/decoder validation、方向修正、metadata 剥离、WebP full/thumbnail 生成。
- `app/api/appearance/**`：catalog/mutation/asset API。
- `hooks/useAppearance.ts`：客户端外部状态、预加载/切换、BroadcastChannel、focus revalidate。
- `components/AppearanceConfig.tsx`：Settings 外观即时操作 UI。
- `app/layout.tsx` + `app/globals.css`：服务端首屏 bootstrap、固定背景层、active-only translucent tokens。

Studio 审批安全范围修改 `lib/ypi-studio-tasks.ts` 的共享纯函数 `isExplicitYpiStudioApprovalText()`：从任意子串正则改为规范化、短句约束、否定优先和整句 allowlist。`recordYpiStudioUserApproval()` 与 `recordYpiStudioImprovementApproval()` 继续共用该函数；扩展 input 入口、Widget 显式 action、状态/绑定/material/revision/时间门禁保持原架构。

外观 catalog 不放入 `pi-web.json`，原因是图片上传/删除需要独立 revision、配额、二进制事务和即时操作，而现有 Settings 会持有并全量保存多个 `pi-web.json` 草稿。独立 store 可避免陈旧 Settings Save 覆盖皮肤 catalog，也避免扩大现有配置锁改造范围。

## 2. AS-IS 与 TO-BE

### AS-IS

```text
layout inline script -> localStorage pi-theme -> html.dark
AppShell fetch /api/web-config
app-shell-root(background: --bg opaque)
  Sidebar(--bg-panel opaque)
  Chat / right panel(--bg opaque)
```

仅在 body 设置 background image 会被 AppShell 根和 pane 遮挡。

### TO-BE

```text
server RootLayout (force-dynamic)
  read safe appearance bootstrap
  html[data-appearance-active][CSS variables + opaque asset URL]
  existing pi-theme script still applies html.dark

body::before / explicit inert layer
  fixed active image (cover/contain/stretch/original + x/y)
body::after
  fixed veil (auto/light/dark + opacity)

app semantic surfaces
  no active skin -> current tokens unchanged
  active skin -> theme-aware rgba/color-mix tokens using panelOpacity
  elevated/editor/terminal safety surfaces retain minimum opacity

client useAppearance
  GET catalog -> preload/decode -> atomically apply document attributes/vars
  mutation -> revision update -> same-tab notify + BroadcastChannel
  window focus/visibility -> revalidate
```

## 3. 存储契约

### 3.1 文件布局

```text
<getAgentDir()>/appearance/
  index.json                         # schema-v1 metadata only, 0600
  skins/
    <opaque-id>.webp                 # normalized full asset, 0600
    <opaque-id>.thumb.webp           # normalized thumbnail, 0600
  .tmp/                              # in-flight processing, lazy cleanup
  .trash/                            # delete quarantine, lazy cleanup/rollback
  .mutation.lock/                    # cross-process mkdir lock
```

目录 best-effort `0700`。不保留原图，不保留 EXIF/ICC/XMP，不使用原 filename 作为路径。

### 3.2 index schema（server）

```ts
interface AppearanceIndexV1 {
  schemaVersion: 1;
  activeSkinId: string | null;
  skins: AppearanceSkinRecordV1[];
  updatedAt: string;
}

interface AppearanceSkinRecordV1 {
  id: string;                 // random opaque id
  name: string;               // 1..80, cleaned
  createdAt: string;
  updatedAt: string;
  sourceName?: string;        // cleaned basename only, optional
  asset: {
    mimeType: "image/webp";
    width: number;
    height: number;
    bytes: number;
    thumbnailBytes: number;
  };
  presentation: {
    fit: "cover" | "contain" | "stretch" | "original";
    positionX: number;        // 0..100
    positionY: number;        // 0..100
    overlayTone: "auto" | "light" | "dark";
    overlayOpacity: number;   // integer 0..80
    panelOpacity: number;     // integer 70..100
  };
}
```

Revision 不依赖自增字段；使用 canonical index JSON + referenced asset metadata 的 SHA-256 opaque digest。wire 仅返回 revision，不返回 digest input、path 或内部 lock 状态。

### 3.3 默认值与兼容

- 无目录/无 index：`activeSkinId=null`, `skins=[]`，与现状完全相同。
- 默认 presentation：`cover`, x=50, y=50, `overlayTone=auto`, `overlayOpacity=18`, `panelOpacity=90`。
- 未知 schema、JSON 非 object、active 指向不存在 skin：读取 fail closed，UI 得到默认 projection + bounded warning；不得自动覆盖损坏 index。
- 后续字段采用 schema reader 明确兼容，不让 arbitrary unknown data 进入 CSS。

## 4. API 契约

所有 metadata response：`Cache-Control: no-store`。错误 `{ error, code }` 使用稳定 code 和安全文案。

### `GET /api/appearance`

返回：

```ts
{
  kind: "appearance_catalog";
  revision: string;
  activeSkinId: string | null;
  skins: Array<{
    id: string;
    name: string;
    width: number;
    height: number;
    bytes: number;
    createdAt: string;
    updatedAt: string;
    presentation: AppearancePresentation;
    assetUrl: string;
    thumbnailUrl: string;
  }>;
  limits: {
    maxUploadBytes: number;
    maxPixels: number;
    maxLongEdge: number;
    maxSkins: number;
    maxTotalBytes: number;
    acceptedMimeTypes: string[];
  };
  warnings?: string[];
}
```

URL 由 server 生成 app-local opaque-id route，无绝对路径。

### `POST /api/appearance/skins`

- `multipart/form-data`: exactly one `file`, optional `name`, required `revision`。
- 可先检查 `Content-Length`，再检查 `File.size`；form body 字段白名单。
- 成功建议默认激活：返回新 catalog（或 `{ skin, activeSkinId, revision }` 的完整安全 projection）。是否 auto-active 在 UI 批准前冻结。
- 稳定错误：`unsupported_media`, `animated_image`, `file_too_large`, `pixel_limit`, `decode_failed`, `catalog_limit`, `storage_limit`, `revision_conflict`, `processing_busy`。

### `PATCH /api/appearance/skins/[id]`

- `If-Match: <revision>`。
- body 只允许 `{ name?, presentation? }`，至少一项；presentation 要么完整对象，要么严格字段 patch（实现前冻结，推荐完整对象以简化验证）。
- 返回 updated catalog projection。

### `PATCH /api/appearance`

- `If-Match`。
- body only `{ activeSkinId: string | null }`。
- unknown id 404；revision conflict 409。
- 返回 updated catalog。

### `DELETE /api/appearance/skins/[id]`

- `If-Match`。
- body allowlist `{ deactivateActive?: boolean }`。
- active 且未显式 true -> 409 `skin_active`；true 时在一个 store transaction 中 `activeSkinId=null` 并删除。
- 非 active 删除不改变 active。

### `GET /api/appearance/skins/[id]/asset?variant=full|thumbnail`

- id 必须先从有效 index 解析；variant 固定 allowlist。
- 只打开 catalog 中计算出的固定文件名；不接受 path/filename/url。
- `Content-Type: image/webp`, `X-Content-Type-Options: nosniff`。
- immutable id 对应不可变 bytes：`Cache-Control: private, max-age=31536000, immutable` + ETag。
- name/presentation 更新不重写 asset；删除后旧 browser cache 无害且不再有 metadata 引用。

## 5. 图片处理与安全

推荐引入直接 runtime dependency `sharp`（固定版本需实现前按当前 Node 22/npm 发布矩阵验证）。流程：

1. 入口拒绝超过 request/file byte limit。
2. 读取受控 buffer；不使用原 filename 构造路径。
3. decoder metadata：format 只允许 jpeg/png/webp；`pages > 1` 或动画拒绝；宽高/像素缺失拒绝。
4. 检查 `width * height <= 40MP`，防止解压炸弹。
5. `rotate()` 按 EXIF 自动方向；resize `inside` 到长边 ≤4096，不放大。
6. 输出 WebP（建议 quality 82–86，alpha 保留），不调用 `withMetadata()`，从而剥离 metadata。
7. 生成 ≤360 px thumbnail。
8. 输出后再次检查 bytes/dimensions；写 `.tmp`，fsync/close，进入 store transaction。

安全约束：

- SVG/XML/HTML、GIF、animated WebP、AVIF（P0 不声明支持）、remote URL/data URL 均拒绝。
- decoder 原始异常只在 server 内部分类；日志不打印 buffer、path、EXIF、raw decoder message。
- 单进程 image processing semaphore 建议 1–2；超限返回/排队有界，不无限积压。
- mutation store 使用进程队列 + cross-process mkdir lock，owner metadata 不含用户 filename。

## 6. 原子事务

### 上传

1. 锁外完成 bounded decode/encode 到 private temp（避免长时间占 mutation lock）。
2. 进锁后重新读 index、校验 expected revision、数量/总量。
3. temp rename 到最终 full/thumb。
4. 原子写 index（same-dir temp + fsync + rename）。
5. index 失败则删除/隔离刚写的 assets；不返回成功。

竞争时处理结果可丢弃并返回 409；不能基于陈旧 index 覆盖。

### 删除

1. 进锁校验 id/revision/active policy。
2. full/thumb rename 到 `.trash/<tx>/`。
3. 原子写删除后的 index（active delete 同时设 null）。
4. index 失败则从 trash rename 回滚；成功后 best-effort 删除 trash。
5. 下次 mutation 懒清理过期 `.tmp/.trash`，但不得删除 index 正在引用的文件。

### 更新/切换

仅 index 原子 mutation；每次重新读并 CAS revision。所有 partial failure 返回真实 catalog/reload guidance。

## 7. CSS 与渲染契约

### 7.1 首屏 bootstrap

`app/layout.tsx` 在 server render 读取 **safe bootstrap projection**：active id、asset URL、fit、x/y、overlay/panel 数值；不读取或内联 path。必须加 `export const dynamic = "force-dynamic"` 或等效 no-store，避免 `npm run build` 时固化构建机 appearance。

建议把 data attributes/CSS custom properties写到 `<html suppressHydrationWarning>`：

```text
data-appearance="skin" | absent
--appearance-image: url('/api/appearance/skins/<id>/asset?variant=full')
--appearance-size: cover | contain | 100% 100% | auto
--appearance-position-x/y
--appearance-overlay-opacity
--appearance-panel-opacity
--appearance-overlay-tone
```

现有内联 `pi-theme` script 保持不变并先于绘制应用 `html.dark`。

### 7.2 背景层

使用 `body::before` + `body::after` 或一个 `aria-hidden`、`pointer-events:none` 的固定 layer：

- `position: fixed; inset: 0; z-index` 位于应用内容下。
- full viewport，`background-repeat: no-repeat`。
- fit 映射：
  - cover -> `background-size: cover`
  - contain -> `contain`
  - stretch -> `100% 100%`
  - original -> `auto`
- position -> `${x}% ${y}%`。
- veil 使用独立层；`auto` 按 `html.dark` 选择黑/白。
- 不使用 `background-attachment: fixed`（移动浏览器兼容问题），固定 pseudo layer 即可。

### 7.3 Semantic surface 适配

默认状态不改现有变量。仅 `html[data-appearance="skin"]` 覆盖：

- `--bg`, `--bg-panel`, `--assistant-bg`, `--user-bg`, `--tool-bg`, `--bg-subtle` 为 theme-aware translucent colors，透明度由 `panelOpacity` 有界控制。
- 新增 `--bg-elevated` / `--bg-tool-solid`，用于 Settings modal、AppPrompt、popover、Monaco/xterm/FileViewer 高密度区域，设置不低于约 94–98%。
- `.app-shell-root` 必须允许 image layer 可见；不能继续用完全不透明的根背景。
- `isolation`/stacking context 明确，background layer 不进入 portal focus/interaction。
- border/text/accent tokens 不随皮肤图片采样，避免不可预测对比。

实施时应先列出现有 `background: var(--bg*)` 表面，按「普通 pane / elevated overlay / tool solid」分类，不要用全局 `opacity`（会连文字一起变透明）。

### 7.4 主题与 motion

- light/dark 是正交轴；切主题只改变 semantic surfaces 和 auto veil，不改变 active skin。
- View Transition 捕获背景时仍允许现有 circular wipe；若切皮肤有淡入，最长约 180ms。
- `prefers-reduced-motion: reduce` 下不做 crossfade/scale；直接替换。

## 8. 客户端状态

`hooks/useAppearance.ts` 建议采用与 `useTheme`/AppShell persistent store 类似的 module-local external store：

- `getServerSnapshot` 从 server-rendered DOM data 读取稳定 bootstrap 或返回默认；避免 hydration subtree差异。
- `getSnapshot` 返回 memoized catalog/effective appearance。
- `refresh()` fetch GET。
- mutation 方法调用 API；成功先 `Image.decode()` full URL，再 apply document attrs/vars；失败不撤旧背景。
- 同标签 listeners 同步 Settings 与 AppShell。
- `BroadcastChannel("pi-web-appearance-v1")` 通知其他标签 refresh；无 BroadcastChannel 时依赖 focus/visibility revalidate。
- 不固定轮询；远端另一个浏览器修改后在 focus/reload 时校准。
- generation/AbortController 防止旧 decode/fetch 覆盖新选择。

不要把 image bytes/base64 放入 React state、localStorage、task/session 或 `pi-web.json`。

## 9. Settings 集成

- `SettingsSection` 增加 `appearance`；作为 root leaf，其 `ancestorGroupsForView()` 返回 `[]`。
- `SettingsConfig` 在 appearance view 渲染独立 `AppearanceConfig`。
- Appearance 不加入 `PiWebConfig` dirty equality 或 PUT body。
- appearance view 通用 Save/Reset 隐藏/禁用，显示即时保存说明；关闭 Settings 不回滚已经成功的 appearance mutation。
- `AppShell` 不应只靠 `loadWebConfig()` 感知；通过 `useAppearance` store 同步。

## 10. 性能与资源预算

- 一次只加载 active full；catalog 用 thumbnail。
- 不保留原图，full 长边限制 4096，thumbnail 360。
- asset immutable cache；metadata no-store。
- CSS background 不参与 layout；无 scroll handler、无 backdrop blur、无视频/GIF。
- Settings 皮肤列表可在 30 张上限内直接渲染；图片 `loading=lazy`, `decoding=async`。
- decoder concurrency/queue 有界；API body limit 和磁盘总量双重保护。

## 11. 影响文件

### 新增

- `lib/appearance-types.ts`
- `lib/appearance-store.ts`
- `lib/appearance-image.ts`
- `hooks/useAppearance.ts`
- `components/AppearanceConfig.tsx`
- `app/api/appearance/route.ts`
- `app/api/appearance/skins/route.ts`
- `app/api/appearance/skins/[id]/route.ts`
- `app/api/appearance/skins/[id]/asset/route.ts`
- focused tests / `scripts/test-appearance.mjs`

### 修改

- `app/layout.tsx`
- `app/globals.css`
- `components/AppShell.tsx`
- `components/SettingsTreeNavigation.tsx`
- `components/SettingsConfig.tsx`
- `lib/ypi-studio-tasks.ts`
- `scripts/test-ypi-studio-dag.mjs`
- `scripts/test-ypi-studio-extension-sci.mjs`
- `package.json`、lock/shrinkwrap（若批准 sharp）
- `docs/architecture/overview.md`
- `docs/modules/api.md`
- `docs/modules/frontend.md`
- `docs/modules/library.md`
- `docs/integrations/README.md`（image dependency）
- `docs/deployment/README.md` / `docs/operations/troubleshooting.md`（storage/decoder）
- `AGENTS.md` 仅在 appearance 成为主要模块入口时加导航

## 12. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 背景被现有 opaque pane 遮住 | active-only semantic token override + root surface audit |
| 透明表面导致文字不可读 | veil + panel opacity下限 + elevated/tool solid表面 |
| 首屏闪烁/构建机配置泄漏 | force-dynamic safe server bootstrap，不内联 path |
| 图片解压炸弹/metadata | decoder像素上限、规范化、剥离metadata、拒绝animation/SVG |
| native `sharp` 发布兼容 | 实现前验证 Node22与发布平台；不通过则阻塞，不降级为无解码原图直存 |
| 上传与 Settings Save 互相覆盖 | dedicated appearance store，不加入 pi-web draft |
| 并发标签覆盖 | revision CAS + BroadcastChannel + conflict refresh |
| active delete split-brain | quarantine + index atomic transaction + rollback |
| 磁盘膨胀 | 数量/总量/输出尺寸限制，不保留原图，lazy orphan cleanup |
| CSS regressions | 无 active skin 时 tokens完全不变；按 surface class focused visual matrix |
| 审批 allowlist 过宽仍误授权 | 整句锚定、短句上限、否定/引用/多段 fail-closed，测试真实误触发句 |
| 审批 allowlist 过窄阻断合法回复 | 冻结常用中英文明确命令矩阵；Widget 显式 CTA 保持可靠替代路径 |
| 只修主计划、遗漏改进计划 | 保持共享 helper，并分别做主计划/改进计划落盘与 transition 门禁测试 |

## 13. 回滚

- UI 层隐藏/移除 `appearance` Settings leaf，并让 layout 忽略 appearance bootstrap，即可恢复现有纯色界面。
- API 可改为只读或返回 503；不自动删除 `appearance/`，以便前滚恢复。
- 无 session/models/pi-web migration；回滚不改写用户已有配置。
- 若 translucent CSS 出现严重问题，运行时 stop-bleed：忽略 `data-appearance=skin` 并使用原 semantic tokens，catalog/asset 保留。
- 若审批 parser 出现合法命令兼容问题，可回退到上一版**整句 allowlist**并引导使用 Widget CTA；不得回退到任意子串匹配。该修复不迁移或删除历史 grant。

## 14. 决策边界

实现前必须由主会话/用户确认 PRD §6，并由已交付的 UI 设计员 HTML 原型冻结 Settings 布局、fit 文案、auto-activate、透明度范围与 active delete 体验。未确认时不得让实现员自行选择。Studio 审批修复的产品边界已由父任务确认：短句/明确命令才授权，中英文兼容，普通讨论、引用、排查反馈和否定语句均不触发。

## 15. Studio 审批意图安全设计

### 15.1 信任边界与数据流

```text
Pi extension input event / improvement approval API inputText
  -> isExplicitYpiStudioApprovalText(inputText)   # 纯、无 I/O、fail closed
  -> recordYpiStudioUserApproval / recordYpiStudioImprovementApproval
  -> existing task status + context binding + material/revision/time gates
  -> approvalGrant write + audit event
  -> implementing transition gate

Widget approve action
  -> typed action + expectedRevision + binding/material CAS
  -> existing user-widget grant path（不做自由文本分类）
```

审批意图 helper 是第一道文本门禁，不替代后续服务端授权条件。即使文本明确，任务不在 `awaiting_approval`、context 未绑定、计划材料缺失、revision 不匹配或 grant 早于 gate 时仍不得推进。

### 15.2 规范化与匹配契约

1. 输入必须是 string；执行 Unicode `NFKC`、首尾 trim 和水平空白折叠，但不删除引号、冒号或语义标点。
2. 只接受一个非空短句：拒绝换行/多段；规范化后采用集中常量限制（推荐最多 80 Unicode code points，实施 local review 时冻结）。长度限制是授权边界，不影响用户消息本身保存或发送。
3. 先执行否定/等待/修改 fail-closed 检查，中英文至少覆盖「不/别/不要/不能/暂缓/等等/先修改」和 `no/not/don't/do not/wait/hold/revise/change/not yet`。这不是主要正向依据，只是纵深防御。
4. 正向规则必须锚定整句并采用显式短语 allowlist；只允许有限礼貌前缀、目标词（计划/方案/plan）和动作后缀（开始实现/proceed/start implementation）。不得用 `确认|批准|approve` 在任意位置搜索。
5. 引号、转述前缀、疑问/排查语义、额外讨论尾巴、Markdown 引用、多句文本均无法满足整句 grammar，返回 false。不要为了扩大召回率而剥离引号或从长文本提取子句。
6. 中英文规则集中在同一纯 helper，以表驱动测试作为可审计契约；不使用 AI、locale 猜测或模糊分数。

推荐冻结的通过样例包括：`确认`、`批准`、`同意该方案`、`确认，开始实现`、`按方案做`、`可以开始实现`、`approve`、`I approve this plan`、`go ahead`、`please proceed`、`start implementation`。拒绝样例包括：`排查浮窗批准问题`、`为什么会误触发批准`、`用户说：批准`、`“批准”`、`不批准`、`not approved`、`wait, do not proceed`、多行引用和超过上限的讨论文本。

### 15.3 兼容性

- 保留当前常用明确回复，如测试中大量使用的「确认开始实现」「批准开始实现」「确认，开始实现」。
- `recordYpiStudioUserApproval()` 的无匹配返回 `null` 语义不变；改进计划路径继续抛出既有“需要明确审批文本”错误。
- `approvalGrant` schema、`source=user-input|user-widget`、`inputHash`、event schema 不变，不迁移历史任务。
- Widget CTA 是结构化显式审批，不受文本 parser 收紧影响；仍需原有 CAS 和材料检查。

### 15.4 测试边界

- 纯函数表：中英文明确命令、标点/空白/NFKC；否定、引用、排查、普通讨论、多行、超长。
- 主计划服务端门禁：awaiting + bound task 收到误触发句不写 `approvalGrant`，`awaiting_approval -> implementing` 继续失败；明确短句写 grant 后才可推进。
- 改进计划门禁：同样的负样例不写 instance approval，明确短句在 material/UI gate 满足时通过。
- 扩展 input 集成：真实根因句「排查浮窗批准问题」经 `pi.on("input")` 后仍无 grant；确认用户原始消息处理不变。
- Widget action 回归：显式 CTA 继续按 typed action 授权，证明没有被文本 allowlist 意外阻断。
