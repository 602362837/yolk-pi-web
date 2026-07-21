# Checks：IMP-001 动态壁纸与 MP4

## 0. 前置门禁

- [ ] `appearance-video-skins-prototype.html` 已交付（非纯 Markdown）
- [ ] `ui.md` / `plan-review.md` 已链接原型
- [ ] 用户明确批准改进计划 + HTML
- [ ] PRD §6 决策已冻结（处理深度 A/B、limits、仅封面偏好、auto-activate、音轨、移动端）
- [ ] implementation plan VID-01…09 已由主会话保存并可 claim
- [ ] 生产代码改动仅在批准后由实现员进行

## 1. 静态皮肤回归

- [ ] JPEG/PNG/static WebP 上传/切换/删除/fit/position/veil/panel 行为与主任务一致
- [ ] 旧 index 无 `kind` 仍可加载为 image
- [ ] 无 video 时 DOM 不常驻解码中的 background `<video src>`
- [ ] `npm run test:appearance` 原有用例通过

## 2. 视频需求覆盖

- [ ] 可上传本地 MP4；列表 kind 徽章 + poster + 可选时长
- [ ] 非法格式/伪装扩展名/空文件/过大/过长/超分辨率拒绝且无正式 orphan
- [ ] 激活后全视口静音循环；无 controls；听不到音轨
- [ ] fit 四态 + 9 anchors 映射 object-fit/position
- [ ] reduced-motion → poster only
- [ ] document hidden → pause（回到前台可恢复若策略允许）
- [ ] user poster-only（若批准）立即暂停
- [ ] autoplay 被拒 → poster + 安全提示
- [ ] 切换 generation guard；失败保留旧背景
- [ ] active 删除原子 deactive + 删 mp4/thumb
- [ ] BroadcastChannel + focus revalidate；非可见标签不播放
- [ ] SSR bootstrap 使用 poster，force-dynamic，无绝对路径

## 3. 安全矩阵

| 输入 | 预期 |
| --- | --- |
| 合法短 MP4 | 入库 kind=video + thumb |
| `.mp4` 实为 JPEG/HTML/SVG | 拒绝 |
| 超 50MiB（或冻结值） | 稳定 size code |
| 时长 > 上限 | `video_too_long` |
| 长边 > 上限且 P0 不重编码 | 拒绝 resolution |
| 恶意 filename | 仅影响 display name |
| path query / 任意 variant | 404/400 |
| 并发 upload/delete | 无 split-brain |

- [ ] wire/log 无 path、无 probe raw
- [ ] asset：正确 Content-Type、nosniff、private cache、ETag

## 4. 自动验证

```bash
npm run test:appearance
npm run lint
node_modules/.bin/tsc --noEmit
PI_CODING_AGENT_DIR="$(mktemp -d)" npm run build   # closeout
```

- [ ] 未直接 `next build`
- [ ] 构建产物无真实 appearance path/id（隔离 dir）

## 5. 视觉 / 播放人工矩阵

- [ ] 1920 / 1366 / 768 / 390
- [ ] light/dark × image skin × video skin
- [ ] panel opacity min/max 下 Chat/Sidebar/Settings/prompt/terminal 可读
- [ ] 多标签：仅前台播放
- [ ] reduced-motion 工具/系统设置
- [ ] 与批准 HTML 状态对照

## 6. 性能

- [ ] 同时 ≤1 background video
- [ ] catalog 不预载全部 full mp4
- [ ] 切换后旧 src 释放
- [ ] 无新增轮询

## 7. 文档

- [ ] api/frontend/library/integrations/ops 描述 video limits 与 stop-bleed
- [ ] 不宣称 GIF/远程 URL/有声背景

## 8. Blocker

- 无用户批准计划/HTML
- 关键决策未冻结却引入 ffmpeg 或双文件
- 接受非 MP4 / 信任扩展名
- 背景有声音或原生 controls
- reduced-motion 仍强制动画视频
- active delete split-brain / path 泄漏
- 破坏静态皮肤或 build 固化本机数据
- 实现偏离批准 HTML 未再审批
