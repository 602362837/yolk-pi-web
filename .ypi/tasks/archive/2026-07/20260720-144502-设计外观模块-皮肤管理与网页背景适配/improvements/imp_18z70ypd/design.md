# Design：IMP-001 动态壁纸与 MP4 视频背景

## 1. 方案摘要

在现有 appearance domain 上做 **additive schema + dual media pipeline + dual render layer**，不拆第二配置系统：

| 层 | 变更 |
| --- | --- |
| Contract | `kind: image\|video`；video asset mime `video/mp4`；可选 `durationMs`；limits 分 media 投影 |
| Store | 文件：image 仍 `<id>.webp`；video `<id>.mp4` + 共用 `<id>.thumb.webp` poster；revision 纳入 kind/duration |
| Image pipeline | 保持 `lib/appearance-image.ts` |
| Video pipeline | 新增 `lib/appearance-video.ts`：签名/容器/时长/分辨率校验 + poster 产出 |
| API | 同一 POST 按内容分流；asset route 按 catalog kind 返回正确 Content-Type |
| Runtime | `useAppearance`：image 仍 `Image.decode`；video 挂载/预热 inert `<video>`；策略引擎控制 play/pause |
| CSS/DOM | 保留 `body::before` 作 image 或 poster fallback；新增固定 `#appearance-video-layer`（或 React portal 根下 inert video）仅 video active 时存在 |
| UI | `AppearanceConfig` accept/列表/预览/策略状态 |

**不**把 catalog 并入 `pi-web.json`。**不**回退 Studio 审批 parser。

## 2. AS-IS → TO-BE

### AS-IS

```text
html[data-appearance=skin]
  --appearance-image: url(full.webp)
body::before { background-image }
body::after  { veil }
```

### TO-BE

```text
html[data-appearance=skin][data-appearance-kind=image|video]
  image:
    body::before background-image full
  video:
    body::before background-image poster (always as fallback)
    #appearance-bg-video (fixed, inert) src=full.mp4 when policy allows play
    data-appearance-playback=playing|poster|paused-hidden|error
body::after veil (unchanged)
semantic translucent tokens (unchanged, active-only)
```

首屏 SSR：video active 时 bootstrap **只写 poster URL + kind=video**，不在 server HTML 嵌入 `<video src>` 自动播放；客户端 hydrate 后按策略挂载。

## 3. 存储契约

### 3.1 布局

```text
<agentDir>/appearance/
  index.json
  skins/
    <id>.webp              # image full only
    <id>.mp4               # video full only
    <id>.thumb.webp        # image thumb OR video poster
  .tmp/ .trash/ .mutation.lock/
```

同 id 不会同时存在 `.webp` full 与 `.mp4`（kind 互斥）。

### 3.2 schema（向后兼容读取）

推荐 **schemaVersion 保持 1**，用字段扩展 + 严格 reader：

```ts
type AppearanceSkinKind = "image" | "video";

interface AppearanceSkinRecordV1 {
  id: string;
  name: string;
  kind?: AppearanceSkinKind; // missing => "image"
  createdAt: string;
  updatedAt: string;
  sourceName?: string;
  asset: {
    mimeType: "image/webp" | "video/mp4";
    width: number;
    height: number;
    bytes: number;
    thumbnailBytes: number;
    durationMs?: number; // video only, integer > 0
  };
  presentation: AppearancePresentation; // unchanged
}
```

Reader 规则：

- 缺 `kind` → `image`，且 `mimeType` 必须 `image/webp`。
- `kind=video` → `mimeType=video/mp4`，`durationMs` 在 1…max；full 路径 `.mp4`。
- 未知 kind / mime 组合 → fail closed 整表默认（与现 malformed 策略一致），**不覆写**损坏 index。

Revision digest 输入包含 kind、mime、bytes、durationMs、presentation。

### 3.3 推荐 limits（集中常量）

| 常量 | 推荐值 | 说明 |
| --- | --- | --- |
| 图片 upload | 20 MiB | 不变 |
| 视频 upload | 50 MiB | 独立常量 |
| 视频时长 | 30_000 ms | 含边界 |
| 视频长边 | 1920 | 不放大；P0 不重编码则超限 **拒绝** |
| 视频像素 | 1920×1080 量级上限可与长边联合 | 防极端 |
| max skins | 30 | 不变 |
| max total bytes | 250 MiB | 上调以容纳少量视频；或 image 100MiB + video 单独 200MiB（实现前冻结一种） |

Wire `limits` 扩展：

```ts
limits: {
  // existing image fields...
  maxUploadBytes: number;          // 对 UI 可表示「默认/图片」或 max(image,video) 需冻结
  maxVideoUploadBytes: number;
  maxVideoDurationMs: number;
  maxVideoLongEdge: number;
  acceptedMimeTypes: [...image, "video/mp4"];
}
```

**推荐冻结**：`maxUploadBytes` 保持图片 20MiB；另增 `maxVideoUploadBytes`；UI 按所选/拖入类型提示。

## 4. 视频校验与 poster（`lib/appearance-video.ts`）

### 4.1 P0 推荐：无 ffmpeg 重编码

1. 字节上限预检。
2. 魔数：ISO BMFF `ftyp` + 兼容 brand 含 `isom|mp41|mp42|avc1|iso2|iso5|iso6|dash|mscf` 等 allowlist（表驱动）；拒绝明显非 mp4。
3. 轻量 box 扫描（有界 buffer，不整文件解析无限 box）：定位 `moov`/`mvhd` 取 timescale + duration → `durationMs`；定位 `tkhd`/`stsd` 尝试宽高；失败 → `decode_failed` / `invalid_media`。
4. 时长/分辨率超限 → 稳定 code。
5. **不**执行任意 atom 回调、不请求外部、不保留源 filename 路径。

**Poster 生成选项（实现前二选一，推荐 A）**：

- **A（推荐）**：依赖已有 `sharp` **不**能解 mp4。P0 使用 **客户端不上传第二文件**；服务端用 **Node 可选 `ffmpeg-static` / 系统 ffmpeg** 抽 1 帧 → WebP thumb。若发布矩阵不能接受 ffmpeg，则：
- **B**：上传 API 接受可选第二字段 `poster`（image）仅当 file 为 video；服务端按 image pipeline 规范化 poster；无 poster 则拒绝 video（`poster_required`）。UX 较差。
- **C**：P0 列表用主题色占位 + 客户端 `video` seek 捕获 canvas 生成 blob **仅用于预览不持久**——刷新后无服务端 poster，**不满足** SSR 首屏与跨设备，**不推荐**。

**计划默认写 A，并把「是否引入 exact-pinned ffmpeg（或 ffmpeg-static）抽帧」列为审批决策。** 若拒绝 ffmpeg，则回退 B 并在 UI 要求「视频 + 封面图」双文件（仍单次 form，字段 `file`+`poster`）。

### 4.2 安全

- 拒绝：非 mp4、超限、无 moov、时长 0、加密 track（若可探测）、path traversal filename。
- 日志：只记 code + id 前缀，不记 path/buffer。
- 处理并发：与 image 共享或独立 semaphore（1–2）。

### 4.3 事务

与 image 相同：锁外完成校验/poster 到 `.tmp` → 锁内 revision/quota → rename mp4+thumb → 原子 index → 失败 rollback。

## 5. API

保持路径，扩展语义：

### POST `/api/appearance/skins`

- form allowlist：`file`, `name`, `revision`, 可选 `poster`（仅当采用策略 B）。
- 读取 file 头部分流：image → `normalizeAppearanceImage`；mp4 → `normalizeAppearanceVideo`。
- 成功 auto-activate 继承主任务。

错误 code 增量：`unsupported_media`, `video_too_long`, `video_resolution_limit`, `invalid_media`, `poster_required`, 以及既有 size/quota/revision。

### GET asset

- catalog 决定文件与 Content-Type：
  - image full → `image/webp`
  - video full → `video/mp4`
  - thumbnail always → `image/webp`
- cache：private immutable + ETag + nosniff 不变。
- Range requests：P0 **推荐支持** `Accept-Ranges`/`Content-Range` 以便 video seek（实现员评估 Node 流式）；若工期紧可 P0 整文件，记为风险（大文件首帧慢）。

### PATCH/DELETE / GET catalog

- projection 增加：`kind`, `durationMs?`, `mimeType`（或仅 kind+duration，mime 可省略若 UI 不需要）。
- `assetUrl`/`thumbnailUrl` 形状不变。

## 6. 客户端播放架构

### 6.1 DOM

在 `AppShell` 或 layout client bootstrap 挂载：

```html
<video
  id="appearance-bg-video"
  aria-hidden="true"
  muted defaultMuted playsinline loop
  disablePictureInPicture
  disableRemotePlayback
  tabindex="-1"
  style="position:fixed;inset:0;z-index:-2;pointer-events:none;object-fit:...;object-position:..."
/>
```

- 仅 `kind=video` 且 policy 允许播放时设置 `src` 并 `play()`。
- poster 始终可通过 `body::before` 或 `video.poster` 显示。
- z-index：video 与 image 层同级（-2），veil -1，内容以上。

### 6.2 Policy 引擎（纯函数 + 订阅）

```ts
type PlaybackPolicy = {
  reducedMotion: boolean;
  documentVisible: boolean;
  saveData?: boolean;
  userPosterOnly: boolean; // localStorage e.g. pi-appearance-poster-only
};

function shouldPlayVideo(p: PlaybackPolicy): boolean {
  return p.documentVisible && !p.reducedMotion && !p.userPosterOnly && !p.saveData;
}
```

监听：`visibilitychange`、`focus`、`matchMedia('(prefers-reduced-motion: reduce)')`、`change` on Save-Data（若 `navigator.connection` 可用则 best-effort）。

### 6.3 `publishAppearanceCatalog` 变更

```text
if next kind image:
  detach video src
  Image.decode(full) then apply CSS image vars
if next kind video:
  set poster on ::before
  if shouldPlay: set video src, wait canplay/loadeddata (generation), play().catch → poster mode
  else: poster-only attrs
```

Generation/Abort 防止旧 video 事件覆盖新选择。

### 6.4 安全 URL

扩展 `isSafeAssetUrl`：允许 full 与 thumbnail 既有路径；video 同源 path 不变。

## 7. CSS

- `html[data-appearance-kind="video"] body::before` 使用 poster URL（`--appearance-image` 指向 thumbnail 或专用 poster variant——**推荐 thumbnail 即 poster**，避免第三 variant）。
- video 元素 object-fit 映射：

| fit | object-fit |
| --- | --- |
| cover | cover |
| contain | contain |
| stretch | fill |
| original | none |

- `object-position: x% y%`
- reduced-motion：强制 `data-appearance-playback=poster`，video 不挂 src 或 pause+移除 src。
- 不使用 `background-attachment: fixed`；不用全局 element opacity。

## 8. Settings UI

- accept：`image/jpeg,image/png,image/webp,video/mp4` + 拖放 MIME 检查放宽到服务端。
- 卡片 kind 徽章与时长。
- 预览：选中 video 时用 `<video muted loop>` 小预览 **或** poster + 状态；避免与全局背景双解码——**推荐预览用 poster + CSS 标注「实际背景将播放视频」**，仅全局一层 video（省资源）。若产品坚持预览播放，则预览 `preload=metadata` 且仅 selected 时加载，离开卸载。
- 本地「仅静态封面」toggle：读写 `localStorage`，立即 pause 全局 video。

## 9. 影响文件（实现时）

### 新增

- `lib/appearance-video.ts`
- （可选）`lib/appearance-playback-policy.ts`
- 测试 fixture：短 mp4 / 伪装 / 超长 metadata
- 扩展 `scripts/test-appearance.mjs` 或 `test-appearance-video.mjs`

### 修改

- `lib/appearance-types.ts` / `appearance-store.ts`
- `app/api/appearance/skins/**`
- `hooks/useAppearance.ts`
- `components/AppearanceConfig.tsx` / `AppShell.tsx` / `app/layout.tsx` / `app/globals.css`
- `package.json`（若批准 ffmpeg 相关 pin）
- docs：architecture/api/frontend/library/integrations/deployment/ops

## 10. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| ffmpeg 发布矩阵 | 审批二选一 A/B；A 失败则 B |
| 无 Range 时大视频卡顿 | P0 限 50MiB/30s；后续加 Range |
| 多标签多路解码 | 仅 visible play；Broadcast 只同步 catalog |
| autoplay 策略差异 | catch play() → poster + 提示 |
| schema 破坏旧 index | kind 可选；缺省 image |
| 电池/发热 | reduced-motion、hidden pause、user poster-only |
| 安全：畸形 mp4 | 有界解析、拒绝未知、不执行 codec 转码回调 |
| 静态回归 | 保留 image 路径与 test:appearance |

## 11. 回滚

- 运行时：忽略 `kind=video` 当 image 缺失处理 → 默认外观或仅 poster；隐藏视频上传。
- 保留磁盘 mp4；不删用户资产。
- 不改 sessions/models/pi-web。

## 12. 决策边界

实现前必须确认 PRD §6（处理深度、limits、仅封面存储位置、auto-activate、移动端、有音轨策略）并批准 HTML 原型。未确认不得引入 ffmpeg 或双文件上传。
