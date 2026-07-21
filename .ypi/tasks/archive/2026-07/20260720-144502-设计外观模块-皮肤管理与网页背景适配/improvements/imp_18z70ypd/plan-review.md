# 计划审批书：IMP-001 支持动态壁纸与 MP4 视频背景

## 当前结论

改进规划与 HTML 原型已由改进师产出。**尚未获用户批准，不得进入 improvement implementing，不得修改生产代码。**

主任务外观静态皮肤与 Studio 审批安全保持不变；本改进为验收后的范围扩展。

## 审批材料

- [Brief](brief.md)
- [PRD](prd.md)
- [UI](ui.md)
- **HTML 原型：[appearance-video-skins-prototype.html](appearance-video-skins-prototype.html)**
- [Design](design.md)
- [Implement / VID-01…VID-09](implement.md)
- [Checks](checks.md)

## PRD 摘要

- Catalog 增加 `kind: image | video`；旧数据默认 image。
- P0 动态壁纸 = **本地 MP4**（静音、循环、playsInline、无音量 UI）。
- 上传/切换/删除/revision/跨标签与静态共用 appearance store。
- 播放策略：可见标签播放；`prefers-reduced-motion`、后台、可选「仅封面」→ poster。
- 服务端校验大小/时长/分辨率/容器；poster/thumb 为 WebP。
- 推荐 limits：视频 50MiB / 30s / 长边 1920；总资产上调；图片 limits 不变。
- 不做 GIF/WebM/远程 URL/有声播放/完整主题引擎。

## Design 摘要

- 存储：` <id>.mp4` + `<id>.thumb.webp`；image 仍 `.webp`。
- 新模块 `lib/appearance-video.ts`；渲染为 inert fixed `<video>` + `body::before` poster fallback。
- **Poster 策略待批**：A) exact-pinned ffmpeg 抽帧（推荐默认）或 B) 表单附加 poster 图片。
- SSR 只 bootstrap poster + kind；客户端再挂 video。
- Policy 纯函数 + visibility / reduced-motion / localStorage。

## Implementation 摘要

schemaVersion 2，maxConcurrency 2，子任务 VID-01…VID-09：contracts → video pipeline → API → playback∥surfaces → Settings UI → tests∥docs → validation。

完整机器计划见 [implement.md](implement.md) fenced `json ypi-implementation-plan`。需主会话正式保存，改进师不写 `task.json`。

## Checks 摘要

- 静态回归 + 视频安全矩阵 + 播放策略人工矩阵。
- `test:appearance` / lint / tsc；closeout 隔离 `npm run build`。
- Blocker：未批准、非 mp4 放行、漏音、path 泄漏、split-brain、破坏 image 路径。

## 需要确认的产品决策

1. Poster：**A ffmpeg 抽帧** vs **B 双文件 poster**？推荐 A（若发布矩阵可接受）。
2. Limits：50MiB / 30s / 1920 / 总资产 250MiB 是否可接受？
3. 「仅静态封面」：**浏览器 localStorage 全局**（推荐）还是写入 skin presentation？
4. 上传成功是否 **自动激活** 视频？（推荐是）
5. 含音轨 MP4：**接受但强制静音**（推荐）还是拒绝？
6. 小屏是否默认更保守（仅封面直到用户手势）？推荐跟随 reduced-motion/Save-Data，仍尝试 muted autoplay。

## UI 审批门禁

- [appearance-video-skins-prototype.html](appearance-video-skins-prototype.html)：混合列表、MP4 上传状态、播放/降级/autoplay 失败、fit/定位、active 删除、light/dark、窄屏、策略开关模拟。

## 风险与回滚

主要风险：ffmpeg 发布兼容、浏览器 autoplay、多标签解码、大文件无 Range、畸形 MP4 解析。  
回滚：忽略 video kind / 隐藏上传；保留资产；image 与 pi-web/sessions 不动。

## 下一步（非审批请求本身）

1. 用户审阅本审批书 + HTML，回复「批准」或「需要修改」（及决策 1–6）。
2. 主会话保存 implementation plan 并进入改进实现流。
3. 仅在明确批准后派发实现员。

**不得把任务描述或历史「批准」字样视为对本改进的批准。**
