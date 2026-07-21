# Brief：IMP-001 动态壁纸与 MP4 视频背景

## 反馈摘要

用户验收反馈（主任务 `review` 阶段创建 IMP-001）：

> 当前皮肤模块仅支持 JPEG/PNG/静态 WebP。请新增动态壁纸支持，重点覆盖 MP4：上传、格式/编码/大小/时长限制、视频背景播放策略、静音自动播放、循环、暂停/降级静态封面、移动端与低性能设备策略、删除/切换/跨标签同步，以及安全和资源占用控制。保持现有静态皮肤兼容。

Improvement id：`imp_18z70ypd` / display `IMP-001`。  
本改进**只做规划与 UI 原型**，不修改生产代码。

## 已读取的现状证据

| 区域 | 现状 | 与反馈的冲突 |
| --- | --- | --- |
| `lib/appearance-types.ts` | `APPEARANCE_ACCEPTED_MIME_TYPES = jpeg/png/webp`；asset `mimeType` 固定 `image/webp`；limits 20MiB / 40MP / 30 skins / 100MiB | 无 video kind、无 duration/poster 契约 |
| `lib/appearance-image.ts` | `sharp` 解码 JPEG/PNG/static WebP → metadata-free WebP full+thumb；拒绝 animation | 无法处理 MP4 |
| `lib/appearance-store.ts` | schema-v1 index；路径 `<id>.webp` + `<id>.thumb.webp`；revision CAS、upload/delete 事务 | 文件命名与 mime 校验绑定图片 |
| `app/api/appearance/**` | 上传只走 image normalize；asset variant `full\|thumbnail` | 无 video/poster 变体语义 |
| `hooks/useAppearance.ts` | `Image.decode()` 后写 `html` CSS vars；`body::before` 使用 `background-image` | CSS 背景**不能播放视频** |
| `app/globals.css` | fixed pseudo image + veil + active-only translucent tokens | 无 video layer / object-fit 映射 |
| `components/AppearanceConfig.tsx` | `accept="image/jpeg,image/png,image/webp"`；预览用 thumbnail 背景图 | 无视频上传、播放策略、降级 UI |
| 主任务 PRD §3.2 / Checks | P0 **明确排除** GIF/动画/视频背景 | 本改进是用户验收后的**范围扩展**，需重新审批 |

## 核心问题

1. **渲染模型**：当前背景是 CSS `background-image`；MP4 需要独立的 inert `<video>`（或等效）层，并与 veil / surface tokens 协同。
2. **媒体管线**：图片靠 `sharp`；视频不能复用同一 decoder。是否引入 `ffmpeg`/native probe，还是「容器校验 + 原样存储 + 客户端/辅助 poster」必须在计划中冻结。
3. **资源与安全**：视频体积、时长、分辨率、解码内存、自动播放策略、隐藏标签页占用、恶意容器，都比静态图更重。
4. **兼容**：已有静态皮肤、schema-v1 index、asset URL、首屏 bootstrap、跨标签 BroadcastChannel 必须继续可用；默认无 skin 视觉不变。
5. **可访问性 / 性能策略**：`prefers-reduced-motion`、Save-Data、后台 tab、移动端应能降级到静态封面，且不拦截指针/焦点。

## 推荐产品基线（待审批确认）

1. **动态壁纸 = MP4 视频皮肤**（P0 只做 MP4；不做 GIF 动画、WebM、AV1 全矩阵、远程 URL、流媒体）。
2. **皮肤统一 catalog**：image 与 video 共用列表/切换/删除/revision；UI 用 kind 徽章区分。
3. **播放策略默认**：静音 + `playsInline` + 循环 + 自动播放；**永不**开启声音；用户 P0 不提供音量控件。
4. **降级**：`prefers-reduced-motion: reduce`、文档隐藏、可选「省电/仅封面」偏好 → 暂停视频并显示 poster。
5. **处理策略（推荐）**：服务端做 **MP4 容器/签名/大小/时长/分辨率校验**，P0 **不重编码**（避免强制引入 ffmpeg 发布矩阵）；poster 由服务端在可验证路径生成（见 Design；若无安全帧提取能力则上传时要求/生成 WebP poster 的冻结方案）。
6. **限制（推荐起点，可调）**：视频上传 ≤50 MiB、时长 ≤30s、长边 ≤1920、catalog 仍 ≤30、**总资产**提高到 ≤250 MiB 或对 video 单独累计；图片 limits 保持不变。
7. **存储**：仍在 `<agentDir>/appearance/`；video full 为 opaque `.mp4`，poster/thumb 为 `.thumb.webp`；不进 `pi-web.json`。
8. **兼容**：无 appearance / 仅 image skins 行为与现网一致；旧 index 缺 `kind` 时按 `image` 读取。

## 范围外（本改进不承诺）

- 完整主题色板、项目级皮肤、图库市场、远程 URL/HLS。
- GIF/APNG/动画 WebP 作为动态壁纸（主任务已拒绝 animation 图片路径，本改进不重新打开）。
- WebM/MOV/MKV 多格式、HDR、透明视频、带音轨播放、用户裁剪/滤镜编辑器。
- 云同步、跨浏览器实时推送、多视频同时播放。
- 把通用 `/api/files/upload` 改造成视频存储。

## UI 门禁

本改进改变 Settings 外观上传 accept、列表 kind、预览播放/封面、全局背景层类型与降级状态，**触发 HTML 原型硬门禁**。  
原型文件：`appearance-video-skins-prototype.html`（任务 improvements 目录内）。

## 与主任务关系

- 主任务外观 P0（静态皮肤 + Studio 审批安全）已实现并通过自动检查；本改进是验收后的**增量**。
- 不回退 Studio 审批 parser 变更。
- 实现前必须经改进计划 `plan-review.md` + HTML 用户批准。
