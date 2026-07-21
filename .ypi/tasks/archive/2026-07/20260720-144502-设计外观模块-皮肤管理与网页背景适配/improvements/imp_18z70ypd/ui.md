# UI：IMP-001 动态壁纸（MP4）

## 门禁结论

**需要 HTML 原型（硬门禁）。** 改进改变外观上传类型、列表 kind、全局背景层（image CSS vs video 元素）与降级状态展示。

原型交付：

- 文件：[`appearance-video-skins-prototype.html`](appearance-video-skins-prototype.html)
- 形式：单文件自包含 HTML/CSS/JS，无外网依赖；可用 task-local CSP sandbox 打开。

## 设计原则

1. **延续主任务布局**：Settings 两栏（左库 / 右预览参数）；root「外观」位置不变。
2. **kind 可感知但不分裂 IA**：同一列表；视频卡片角标「视频」+ 时长；不新建「动态壁纸」二级树节点。
3. **预览真实化**：右侧预览模拟 AppShell 半透明表面；视频预览可播放（原型可用 CSS 渐变/假动画模拟，并提供状态切换器）。
4. **策略可见**：当系统/用户导致仅封面时，预览与状态条明确文案，不只靠图标颜色。
5. **危险操作不变**：active 视频删除仍强确认「删除后切回默认背景」。

## 页面增量结构

### 上传区

- `accept` 文案：`JPEG / PNG / 静态 WebP / MP4`
- 辅助说明两行：
  - 图片：沿用现网 limits
  - 视频：时长/体积/分辨率推荐 limits +「将静音循环播放」
- processing：图片「安全处理…」；视频「校验视频并生成封面…」（无伪精确百分比）

### 皮肤卡片

- 缩略图：image 用 thumb；video 用 poster
- 角标：`图片` / `视频`
- meta：`WxH`；video 附加 `· 12s`（未知则省略）
- active / selected 语义同主任务（文字「当前使用」+ aria-pressed）

### 右侧参数（选中 video 时）

- 保留 fit / 3×3 / veil / panel
- 新增只读或本地策略区：
  - 「动态背景播放」：跟随系统 / 仅静态封面（原型展示；产品确认后实现）
  - 状态：播放中 / 已暂停（减少动态效果） / 已暂停（标签页不可见） / 自动播放被拦截 / 解码失败
- stretch 时 position 禁用说明不变

### 全局背景（原型模拟）

- image active：`#bg-layer` 背景图（同主任务）
- video active：`#bg-video` 全屏 video（或模拟动画层）+ 同源 veil
- reduced-motion：隐藏/暂停 video，只显示 poster

## 状态控制器（原型必须覆盖）

- 混合 catalog：默认 / 1 image / 1 video / 多混合
- 上传 MP4：hover、processing、过大、过长、非 mp4、成功自动激活
- 播放：playing、paused reduced-motion、paused hidden、autoplay blocked、error→poster
- fit 四态 + 9 anchors（video object-position 文案）
- active 视频删除确认
- light/dark、≤640px、键盘 focus、reduced motion 工具条开关

## 可访问性

- 视频背景装饰性：`aria-hidden="true"`，无 controls
- 状态 `aria-live="polite"`，不刷屏
- 卡片键盘可激活；角标不只靠颜色（含文字）
- 删除确认沿用 AppPrompt 语义

## 审批时请用户确认的 UI 点

- 列表 mixed kind 与角标样式
- 视频限制与静音循环文案
- 降级/仅封面的可见状态
- 是否在外观页提供「仅静态封面」开关（推荐有）
- 自动激活与 active 删除文案
