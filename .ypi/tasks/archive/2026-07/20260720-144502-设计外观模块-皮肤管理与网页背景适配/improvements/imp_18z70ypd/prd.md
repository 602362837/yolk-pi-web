# PRD：IMP-001 动态壁纸与 MP4 视频背景

## 1. 目标与背景

在已交付的「背景皮肤」模块上扩展 **MP4 动态壁纸**：用户可上传本地短视频作为全局网页背景，与现有 JPEG/PNG/static WebP 皮肤共存；播放默认静音循环，并在可读性、安全、资源与跨标签同步约束下保持 Chat 主流程可用。

### 用户价值

- 工作台可使用短循环动态背景，而不仅是静态图。
- 上传/切换/删除体验与静态皮肤一致（即时保存、revision CAS）。
- 弱网、省电、reduced-motion、后台标签时自动降级，不拖垮长期运行的本地服务。

### 成功标准

- 静态皮肤零回归：现有 image 上传、fit/position、veil/panel、首屏 bootstrap、删除事务仍通过既有 `test:appearance` 语义。
- MP4 可上传、列表展示封面、激活后全视口静音循环播放；非法/过大/过长视频被稳定拒绝。
- 切换/删除/跨标签与 focus revalidate 行为与静态路径一致；隐藏标签页不持续解码占用。
- 错误与 wire 不泄漏绝对路径、源文件名路径穿越、decoder/probe 原文。

## 2. 用户与场景

1. 用户在 Settings → 外观拖入一段桌面循环 MP4，上传成功后自动激活，背景开始静音播放。
2. 用户在静态图与视频皮肤间切换；切换时旧媒体释放，新视频 `canplay` 后再替换，避免黑闪。
3. 用户开启系统「减少动态效果」：背景停在封面图，UI 标明「已按系统设置暂停动态背景」。
4. 笔记本合盖/切到其他标签：视频暂停；回到前台且策略允许时恢复播放。
5. 用户删除当前视频皮肤：确认后原子切默认并删除 mp4+poster。
6. 用户上传伪装成 `.mp4` 的非视频或超长/超大文件：收到安全错误，catalog 不变。

## 3. 范围

### 3.1 范围内（P0）

- Catalog 增加 `kind: "image" | "video"`（旧数据默认 `image`）。
- 上传 accept 扩展：在既有图片基础上增加本地 `video/mp4`（单文件）。
- 服务端：MP4 签名/容器校验、大小/时长/分辨率上限、安全错误码；生成或持久化 **poster/thumbnail WebP**；事务写入与 revision CAS。
- 客户端：inert 全视口 video 层；`object-fit` / `object-position` 映射现有 fit/position；veil/panel 逻辑复用。
- 播放策略：muted、loop、playsInline、autoplay（策略允许时）；无音量 UI。
- 降级策略：reduced-motion、document hidden、可选 Save-Data / 明确「仅封面」控制（见决策）；失败时保留旧背景或封面。
- 跨标签：沿用 `BroadcastChannel("pi-web-appearance-v1")` + focus revalidate；**仅可见标签尝试播放**。
- Settings UI：kind 标识、视频限制说明、预览区播放/封面、processing 状态、与静态共用 rename/delete/switch。
- 文档与 focused tests 扩展（图片矩阵 + 视频矩阵）。
- 保持 Studio 审批安全修复不受影响。

### 3.2 范围外

- WebM/MOV/MKV/AV1-only 包、GIF/动画 WebP 动态壁纸。
- 远程 URL、流式 HLS/DASH、YouTube 嵌入。
- 音频播放、字幕、交互式视频控件（进度条/音量）。
- 服务端强制重编码为统一 codec（可作为 P1 若审批引入 ffmpeg）。
- 多视频并行、视差、blur、滤镜编辑器。
- 项目/session 级动态壁纸。

## 4. 需求与验收

### V1. 兼容与信息架构

- Settings 仍为 root `appearance`；不新增二级 Settings section。
- 列表同时展示 image/video；video 卡片显示「视频」徽章、时长（若可知）、分辨率、封面。
- 通用 Save/Reset 仍不适用于外观。

**验收**：仅 image 的旧 catalog 无需迁移文件即可加载；缺 `kind` 当 image。

### V2. 上传

- 单文件；UI 说明图片与 MP4 限制差异。
- 图片路径行为不变（sharp 规范化）。
- MP4：校验内容，不信任扩展名/Content-Type；拒绝空文件、非 ftyp/mp4、超限字节、超限时长、超限像素/分辨率、加密/无法解析 moov（稳定 code）。
- 成功：写入 video asset + poster/thumb；推荐 **自动激活**（继承主任务决策）；失败保留旧 active。

**验收**：错误无 path；失败无 orphan 正式文件（tmp 可懒清理）。

### V3. 播放与呈现

- fit：`cover|contain|stretch|original` 映射到 video `object-fit`（cover/contain/fill/none）+ object-position。
- position 3×3 与 0–100 契约不变；stretch 禁用定位说明不变。
- overlayTone / overlayOpacity / panelOpacity 对 video 同样生效。
- 背景层 `pointer-events: none`，不抢焦点。

**验收**：四种 fit × 常见竖/横视频在 1920/1366/768/390 符合定义。

### V4. 自动播放与静音

- 激活视频皮肤时：`muted=true`、`defaultMuted=true`、`playsInline`、`loop`、无 `controls`。
- 不读取/播放音轨；即使源有音频也保持静音。
- autoplay 被浏览器拒绝时：显示封面 + 非阻断提示「浏览器阻止了自动播放，已显示封面」，不崩溃。

**验收**：用户听不到背景声音；无原生 controls 露出。

### V5. 暂停 / 降级静态封面

至少在以下条件 **暂停 video 并显示 poster**：

1. `prefers-reduced-motion: reduce`
2. `document.visibilityState !== "visible"`（隐藏/后台）
3. 用户在外观设置中开启「仅使用静态封面」（若产品确认提供；推荐 P0 提供简单 toggle，存 **浏览器本地** 或 per-skin presentation 二选一，见决策）
4. video `error` / 解码失败

恢复条件满足且 active 仍为该 video 时，可见标签可重新 `play()`。

**验收**：reduced-motion 下无持续解码；切后台后 CPU/解码明显下降（人工或 performance 观察）。

### V6. 切换 / 删除 / 同步

- 切换前对 video 等待 `loadeddata`/`canplay`（generation guard）；失败保留旧层。
- active 删除：`deactivateActive` 事务同时移除 mp4 + thumb 并 `activeSkinId=null`。
- 同标签 publish + BroadcastChannel + focus revalidate 与静态一致。
- 同一浏览器多标签：非可见标签不播放。

**验收**：无 index 指向缺失文件；跨标签 active 收敛。

### V7. 安全与配额

- 仅本地上传；拒绝 remote URL/data URL/SVG/HTML。
- asset 路由仅 opaque id + allowlisted variant（`full|thumbnail`；video full 的 Content-Type `video/mp4`）。
- 目录权限、原子 index、revision 409 语义保持。
- 集中 limits 常量；UI 与 API 同源投影（可按 kind 展示不同 maxUpload）。

**验收**：路径/probe sentinel 不出现在 wire/log fixture；quota 满拒绝且无正式 orphan。

### V8. 首屏

- server bootstrap 对 video active：可先输出 poster 作为首屏静态层 + `data-appearance-kind=video`；客户端 hydrate 后再挂 video（避免 SSR 播视频）。
- force-dynamic 不变；不内联绝对路径或 file://。

**验收**：首屏至少显示封面/veil，不先闪默认白底再跳；build 隔离 agent dir 无本机 path。

### V9. 性能

- 同时最多一个 background video 元素。
- catalog 列表只加载 thumbnail/poster，不预载全部 full mp4。
- 切换后释放旧 `src`（`removeAttribute('src'); load()`）防泄漏。
- 无轮询；无 blur/backdrop-filter 依赖视频。

**验收**：30 皮肤列表不请求 30 个 full mp4；idle 无新增 interval。

## 5. 状态矩阵（增量）

- media kind: image | video
- video upload: validating | processing poster | success | rejected_* 
- playback: loading | playing | paused-policy | paused-hidden | poster-fallback | error
- policy: reduced-motion | save-data | user-poster-only | multi-tab-visible
- light/dark × fit × anchors（同主任务）

## 6. 未决产品决策（需主会话/用户确认）

1. **视频处理深度**：P0 仅容器校验+原样存储，还是引入 exact-pinned ffmpeg 重封装/压码？**推荐：P0 校验+原样存储；poster 用可审计方案生成；ffmpeg 列为可选 P1。**
2. **时长/体积上限**：是否接受 ≤30s、≤50MiB、长边 ≤1920、总资产 ≤250MiB？
3. **「仅封面」开关**：浏览器本地全局偏好，还是写入每个 skin presentation？**推荐：浏览器本地全局（与 light/dark 类似），不污染服务端 catalog。**
4. **上传成功是否自动激活视频**：是否与图片一致自动激活？**推荐：是。**
5. **移动端**：是否默认更激进（小屏默认仅封面，直到用户点击「播放动态背景」）？**推荐：跟随 reduced-motion/Save-Data；小屏仍尝试 muted autoplay，失败则封面。**
6. **有音轨的 MP4**：拒绝，还是接受但强制静音？**推荐：接受但强制静音（降低误杀）。**

## 7. UI 原型门禁

必须交付并批准 `appearance-video-skins-prototype.html`，覆盖：image+video 混合列表、MP4 上传/限制文案、播放中预览、reduced-motion 封面、后台暂停说明、autoplay 失败、删除 active 视频、fit/position、light/dark、≤640px。

未批准前不得实现生产代码。
