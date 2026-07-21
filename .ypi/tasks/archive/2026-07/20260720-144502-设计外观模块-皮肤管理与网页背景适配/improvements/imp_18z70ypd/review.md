# review：IMP-001 / VID-09 验证与集成审查

**Improvement：** `imp_18z70ypd` / IMP-001 支持动态壁纸与 MP4 视频背景  
**Subtask：** VID-09 Run validation and integration review  
**Reviewer role：** 改进师（closeout 验证，不改生产代码）  
**Reviewed at：** 2026-07-20  
**Conclusion：** **Pass（实现门禁通过，带 UAT 残留风险）**

---

## 1. 范围与材料

对照：

- `brief.md` / `prd.md` / `ui.md` / `design.md` / `implement.md` / `checks.md` / `plan-review.md`
- HTML 原型：`appearance-video-skins-prototype.html`
- 生产 diff 焦点：`lib/appearance-*`、`hooks/useAppearance.ts`、`components/AppearanceConfig.tsx`、`app/api/appearance/**`、`app/layout.tsx`、`app/globals.css`、`scripts/test-appearance*.mjs`、docs 与 `ffmpeg-static@5.3.0` pin

**本会话未修改生产代码**；仅运行验证并写入本 review。

---

## 2. 自动化验证结果

| 命令 | 结果 | 备注 |
| --- | --- | --- |
| `npm run lint` | **Pass** | 0 errors；7 pre-existing warnings（archive script / ChatMinimap / test-model-prices），**与 appearance 无关** |
| `node_modules/.bin/tsc --noEmit` | **Pass** | 无输出 |
| `npm run test:appearance` | **Pass** | `test-appearance.mjs` **18/18** + `test-appearance-video.mjs` **14/14** |
| `PI_CODING_AGENT_DIR=$(mktemp -d) npm run build` | **Pass** (exit 0) | 隔离 agent dir；`/api/appearance*` 路由进入 build 清单 |
| 直接 `next build` | **未执行** | 符合项目约束 |

### 2.1 测试覆盖摘要

**静态回归 + 契约（test-appearance）：** presentation/fit、playback policy 矩阵、poster-only localStorage、image 规范化、store CAS/active delete、legacy 无 `kind` 当 image、video commit `.mp4`+thumb、畸形 fail-closed、MP4 拒绝矩阵、strategy B 双文件 poster、错误无 path。

**视频安全矩阵（test-appearance-video）：** 伪装 HTML/SVG/JPEG/unknown brand/moov-less、短 clip 验收、staging 路径剥离、mixed catalog 投影、quota/opaque id、kind/mime 不一致 fail-closed、SSR-safe policy readers、单 inert muted video host、useAppearance mute/generation、CSS object-fit + 非 playing 隐藏、Settings accept/kind/poster-only、upload/asset Content-Type、limits 分 media、失败无 orphan。

### 2.2 Build 警告（非 blocker）

- `lib/appearance-video.ts`：`module.createRequire failed parsing argument`（webpack 静态分析；与既有 `pi-provider-extensions` 同类）。运行时以 `createRequire(process.cwd()/package.json)` 解析 `ffmpeg-static`，文档已说明。
- 其他既有 sessions export / ypi-studio 警告，与本改进无关。

### 2.3 Path 泄漏抽检

隔离 `PI_CODING_AGENT_DIR` build 后对 `.next` 检索该临时路径：**未命中**。测试断言已覆盖 wire/error 无绝对路径 / probe stderr。

---

## 3. 实现对照（静态审查）

| 区域 | 证据 | 判定 |
| --- | --- | --- |
| Contracts / store | `kind` 可选默认 image；video → `.mp4` + shared `.thumb.webp`；total 250MiB；revision 含 kind/duration | 符合 VID-01 |
| Video pipeline | `lib/appearance-video.ts`：ftyp/moov 有界解析；A=`ffmpeg-static@5.3.0` 抽帧；B=可选 form poster | 符合 VID-02（A 主 + B 回退） |
| API | POST 内容分流；asset `video/mp4` + **Range**；nosniff/private/ETag | 符合 VID-03；Range 已实现（优于 P0 降级方案） |
| Playback | `shouldPlayVideo`：visible ∧ ¬reducedMotion ∧ ¬userPosterOnly ∧ ¬saveData；单 `#appearance-bg-video`；generation；muted loop playsInline | 符合 VID-04 |
| Surfaces | SSR poster only、无 SSR `src`；`data-appearance-kind` / `data-appearance-playback`；veil 不变 | 符合 VID-05 |
| Settings UI | accept 含 mp4；kind 徽章；视频 limits 文案；poster-only toggle；预览避免双解码（文档+源） | 符合 VID-06 / 原型意图 |
| Tests / docs | `test:appearance` 串联两脚本；architecture/api/frontend/library/integrations/deployment/ops 已写 video limits、stop-bleed、ffmpeg 依赖 | 符合 VID-07/08 |

### 产品决策落地（相对 plan-review 推荐默认）

实现代码与 docs **已按推荐默认冻结**（plan-review 正文仍写「待批」，属 artifact 滞后，不阻塞本 closeout 的代码审查）：

1. Poster：**A 优先 + B 回退**（ffmpeg 失败/缺失时可双文件 poster）
2. Limits：视频 **50MiB / 30s / 长边 1920**；总资产 **250MiB**；图片 20MiB 不变
3. 「仅静态封面」：**localStorage** `pi-appearance-poster-only`
4. 上传成功：**自动激活**（docs/overview 明示）
5. 含音轨 MP4：**接受 + 强制静音**（DOM muted/defaultMuted；无 controls）
6. 小屏：**跟随 reduced-motion / Save-Data**，仍尝试 muted autoplay

---

## 4. Checks 清单签核

### 0. 前置门禁

- [x] HTML 原型已交付
- [x] ui / plan-review 链接原型
- [~] 用户「批准」字样：本 closeout **无法在 artifact 中重放用户批准会话**；实现已落地且与推荐默认一致。主会话若未正式记录批准，应补记，**不作为代码返工 blocker**（见 §6）
- [x] 决策在代码/docs 中已冻结为推荐值
- [x] VID-01…08 进度 done；VID-09 本审查
- [x] 本审查会话未改生产代码

### 1–7. 需求 / 安全 / 文档

- [x] 静态回归：自动化 18+14 全绿；legacy kind 缺失路径有测
- [x] 视频上传/拒绝/投影/事务/path sentinel 有测
- [x] 播放策略纯函数 + 源码强制 mute / single host / visibility
- [x] Range + Content-Type 正确分支
- [x] docs 未宣称 GIF/远程 URL/有声背景；含 stop-bleed
- [ ] **浏览器人工矩阵**（多标签解码、真实 autoplay 拦截文案、light/dark 可读性、390–1920 视觉）— 本环境未跑交互浏览器，记 UAT

### 8. Blocker 扫描

| Blocker 条件 | 状态 |
| --- | --- |
| 接受非 MP4 / 信任扩展名 | **未发现**（sniff + 测试伪装） |
| 背景有声 / 原生 controls | **未发现**（layout muted + no controls；CSS/API 装饰层） |
| reduced-motion 仍强制动画 | **未发现**（policy + CSS media） |
| active delete split-brain | **测试覆盖** image/video active delete |
| path 泄漏 | **测试 + build 抽检通过** |
| 破坏静态皮肤 / 隔离 build 固化本机数据 | **未发现** |

**无自动化/静态 blocker。**

---

## 5. 人工 / 播放矩阵（记录状态）

| 项 | 状态 | 说明 |
| --- | --- | --- |
| Policy 表（reduced-motion / hidden / poster-only / saveData） | **自动化签核** | unit + source |
| 多标签仅前台播放 | **UAT 残留** | 源码 visibility 约束；未开双标签实机 |
| autoplay 被拒 → poster 文案 | **UAT 残留** | 源码 `play().catch` 路径；需真浏览器 |
| light/dark × image/video × panel opacity 可读 | **UAT 残留** | 需视觉走查对照 HTML 原型 |
| 听不到音轨 / 无 controls | **静态+契约签核**；真机再听一次可选 |
| 1920/1366/768/390 fit×anchor | **UAT 残留** | CSS 映射有测；像素级未跑 |

---

## 6. 剩余风险（非返工 blocker）

1. **`ffmpeg-static` 发布矩阵**：部分平台二进制缺失时依赖 strategy B 双文件 poster；ops 需知。
2. **Webpack createRequire 警告**：不影响 tsc/tests/build 成功；监控生产 upload 路径。
3. **浏览器 autoplay / 多标签 / 电池**：策略已编码，跨浏览器差异需 UAT。
4. **plan-review 仍写「待批」**：与已实现代码不一致；建议主会话补「批准 + 决策冻结」记录或刷新 plan-review 状态句。
5. **同 worktree 存在无关 Studio 文件改动**（`ypi-studio-*`、studio tasks route 等）— **不在 IMP-001 范围**；合并/发布时勿与 appearance 混为同一无审查包，除非另有任务签核。

---

## 7. 主会话决策 / 动作

1. 确认产品决策 1–6 接受「推荐默认已落地」为最终冻结（若否，开新 improvement，勿静默改）。
2. 补记用户对计划/HTML 的批准（若尚未写入 Studio 状态）。
3. 可选 UAT：Settings 上传短 MP4、切标签、开 reduced-motion、删 active 视频、静音确认。
4. **可将 IMP-001 标为检查通过 / 改进完成**（相对实现门禁）；UAT 不阻塞代码合入本改进范围。

---

## 8. Handoff 摘要

- **Files changed this session：** 仅  
  `.ypi/tasks/20260720-144502-设计外观模块-皮肤管理与网页背景适配/improvements/imp_18z70ypd/review.md`
- **Validation：** lint ✅ · tsc ✅ · test:appearance 32/32 ✅ · isolated build ✅
- **Verdict：** **Pass**
- **Remaining risks：** ffmpeg 平台、真浏览器播放矩阵、plan-review 批准文案滞后、worktree 内无关 Studio diff
- **Decisions needed：** 主会话确认决策冻结与改进关闭；无需再开实现子任务 unless UAT 发现缺陷
