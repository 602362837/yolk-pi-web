# UI — IMP-001 任务资料预览滚动

## UI 原型门禁

本改进调整文档页与详情内文档的滚动布局，触发可交互 HTML 原型。

- HTML 原型：[studio-task-document-scroll-prototype.html](studio-task-document-scroll-prototype.html)  
- 计划审批入口：[plan-review.md](plan-review.md)

## 交互方案（目标态）

### Page 新标签

- 视口高度内：顶栏（文件名 + 只读）固定；下方正文单独滚动。  
- 用户打开后无需点击；悬停正文区域滚动即响应。  
- 不展示双滚动条；不依赖「先点中部灰区」。

### Embedded 详情

- 文档视图占满详情 shell。  
- 顶栏：`← 返回…` + 文件名 + 只读固定。  
- 仅正文滚动；shell / 任务列表外层在此模式不抢 wheel。  
- 返回后来源 Tab 恢复原滚动行为。

### Before（当前问题示意）

- Page：内容撑开整页，overflow 落在错误层，需点击 body 才「找到」滚动目标。  
- Embedded：shell 与 body 双 `overflow:auto`，焦点在返回按钮时滚轮无响应或只动外层。

## 状态

- Loading/Empty/Error 占满 body 剩余高度，居中卡片；不缩小可滚命中区到不可用。

## 响应式与 a11y

- 窄屏头两行，返回全宽置顶。  
- 颜色非唯一状态表达（保持只读徽章文案）。  
- 不新增动画；遵守 reduced-motion。

## 待用户确认

1. 接受「固定头 + 唯一正文滚动」而不是整页 window 滚动。  
2. 接受 document 打开时临时锁住详情 shell 外层滚动。  
3. 若 CSS 足够，可不做强制 focus body。
