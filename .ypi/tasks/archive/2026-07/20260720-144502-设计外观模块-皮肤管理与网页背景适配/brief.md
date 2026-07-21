# Brief：外观模块、皮肤管理、网页背景适配与 Studio 审批安全修复

## 任务目标

本任务包含两个并列范围：

1. 在现有 YPI Web Settings 中新增「外观」模块，把用户上传的本地图片管理为可命名、可删除、可切换的背景皮肤，并让背景真正覆盖整张网页，同时在不同主题、窗口尺寸和面板布局下保持内容可读、交互稳定、资源受控。
2. 修复 YPI Studio 用户审批文本误触发：只有短句、明确命令形式的中英文审批意图才能写入 `approvalGrant`；普通讨论、引用审批词、排查反馈和否定语句不得触发。

外观 P0 的「皮肤」定义为：**背景图片 + 背景呈现参数 + 可读性参数**。它不等于新的配色主题引擎；现有 light/dark 切换仍由 `hooks/useTheme.ts` 与浏览器 `localStorage["pi-theme"]` 管理。Studio 修复是独立基础设施安全边界，不改变外观 UI 原型与产品范围。

## 已读取的项目证据

- `app/layout.tsx`：首屏只内联恢复 `pi-theme`；根 `<body>` 固定为 `100dvh`，尚无服务端外观 bootstrap。
- `hooks/useTheme.ts`：light/dark 是客户端外部状态，切换时使用 View Transition；不读取 `pi-web.json`。
- `components/AppShell.tsx`：根 `.app-shell-root`、侧栏、顶部栏和右面板大量直接使用不透明 `var(--bg)` / `var(--bg-panel)`；根节点自身也有 `background: var(--bg)`，所以只给 `body` 加图片不会可见。
- `components/SettingsTreeNavigation.tsx`：Settings 是稳定 section id + 分组树；新增 section 必须更新 union、祖先映射、flatten/render 两套节点和键盘行为。
- `components/SettingsConfig.tsx`：`/api/web-config` 的所有普通配置采用草稿 + Save/Reset；`Links` 已提供「即时保存、退出通用 dirty/save」的先例。
- `lib/pi-web-config.ts` / `app/api/web-config/route.ts`：`pi-web.json` 负责普通 Web 设置，但当前同步 read/merge/write 不适合与二进制上传、删除事务和并发 revision 绑定。
- `app/globals.css`：全局 light/dark semantic tokens 已覆盖绝大多数 UI，是背景适配的最佳切入点；同时存在 Monaco/xterm、模态框、popover 等应保持更高不透明度的表面。
- `app/api/files/upload/route.ts`：现有通用上传允许 200 MB、保留原文件并返回绝对路径，不具备图片解码、元数据剥离、像素限制或外观资产事务，**不可直接复用为皮肤上传 API**。
- `lib/ypi-studio-tasks.ts`：`APPROVAL_TEXT_RE` 当前对“确认/批准/同意”等任意子串做正向匹配；即使状态、绑定和时间门禁仍在，像「排查浮窗批准问题」这样的讨论文本也会被 `recordYpiStudioUserApproval()` 写成 `source=user-input` 的 `approvalGrant`。同一 `isExplicitYpiStudioApprovalText()` 还被改进计划审批复用。
- `lib/ypi-studio-extension.ts`：每次用户 `input` 事件都会 best-effort 调用 `recordYpiStudioUserApproval()`，因此意图分类器是服务端落盘前的关键门禁，不能依赖模型理解或客户端约束。
- `scripts/test-ypi-studio-dag.mjs`、`scripts/test-ypi-studio-extension-sci.mjs`：已有明确审批与简单否定用例，但缺少任意子串、引用、排查反馈、长讨论及中英文命令边界回归矩阵。
- `docs/modules/frontend.md`、`docs/modules/api.md`、`docs/modules/library.md`、`docs/architecture/overview.md`、`docs/standards/code-style.md`：确认 AppShell、Settings、全局样式、Studio 服务端门禁和最低验证要求。

## 核心问题

1. 背景层现在会被 AppShell 和各 pane 的不透明背景完全遮住。
2. 任意图片比例与视口比例不同，会产生变形、裁剪或留白，需要显式模式和定位语义。
3. 上传原图若不处理，可能带来超大像素解码、EXIF/ICC 元数据、动画、SVG 外链/脚本、内存和磁盘膨胀。
4. 上传/删除/切换是即时资产操作，不适合混入 Settings 全量 Save 的陈旧草稿覆盖路径。
5. SSR/首屏若只在 AppShell mount 后 fetch，会出现无背景 → 有背景的闪烁。
6. 同一服务可被多个标签页使用，需要同标签即时、同浏览器跨标签同步，并在重新聚焦时从服务端校准。
7. Studio 审批当前把关键词出现误当成审批意图；只补更多否定词仍会漏掉引用、排查、转述和未来新表达，必须改为短输入上限 + 整句锚定的正向命令 allowlist，并保留状态、会话绑定、计划材料、revision 和时间顺序门禁。

## 推荐产品基线（待主会话 / 用户确认）

1. **P0 皮肤范围**：仅背景图片及其呈现/可读性参数，不做完整色板、字体、组件圆角主题包。
2. **持久化范围**：服务实例全局（存于 Pi agent data dir），所有项目/会话共用；light/dark 偏好仍是浏览器本地。
3. **来源**：只允许本地上传；不接受远程 URL、data URL、SVG、GIF 或视频。
4. **呈现模式**：`cover`（覆盖并非破坏性裁剪，默认）、`contain`（完整显示）、`stretch`（拉伸填满）、`original`（原始比例/尺寸）；定位使用 3×3 锚点，底层保留 0–100 的 x/y 契约。
5. **可读性**：每个皮肤保存遮罩强度与面板不透明度；遮罩颜色默认随 light/dark 自动选白/黑。P0 不做模糊滤镜和手工裁剪编辑器。
6. **删除 active 皮肤**：必须二次确认；服务端在一个事务中切回默认背景并删除，不能先切换后裸删除形成竞态。
7. **图片处理**：服务端解码、自动方向、剥离元数据、缩放并转 WebP，同时生成缩略图；建议输入 ≤20 MiB、≤40 MP、长边输出 ≤4096 px、最多 30 个皮肤、总资产 ≤100 MiB。
8. **独立存储**：`<agentDir>/appearance/index.json` + `appearance/skins/`，不把 catalog/二进制生命周期塞入 `pi-web.json`。
9. **审批意图安全基线（已确认）**：输入先做 Unicode/空白规范化；仅接受长度受限、单一短句、整句匹配的中文或英文明确审批命令。否定、等待/修改、引用/转述、问题排查、普通讨论、多段文本一律不授予；Widget 显式审批 action 及其 revision/material/binding 门禁不变。

## 范围外

- 从网络 URL 下载背景、图库市场、云同步或账号级同步。
- SVG、GIF/动画、视频背景、脚本化皮肤。
- 手工像素裁剪编辑器、滤镜编辑器、AI 生成背景。
- 为每个项目/space/session 设置不同皮肤。
- 自定义完整主题色板、字体包、组件尺寸/圆角。
- 把通用 `/api/files/upload` 改造成皮肤存储。
- 用 AI/模糊 NLP 判断审批、把所有自由文本中的审批关键词视为授权、改变 Widget 显式审批 action 的既有语义，或自动清理历史 `approvalGrant`。

## UI 门禁

外观范围改变 Settings 信息架构、上传/删除/切换交互、全局视觉层级和确认体验，**明确触发 UI 原型硬门禁**。UI 设计员已交付任务目录内的 `appearance-skins-prototype.html`；仍须由用户批准 HTML 原型和 `plan-review.md` 后才能实现。Studio 审批安全修复不新增页面或交互，不单独触发 UI 原型，但与外观实现共同受本任务审批门禁约束。
