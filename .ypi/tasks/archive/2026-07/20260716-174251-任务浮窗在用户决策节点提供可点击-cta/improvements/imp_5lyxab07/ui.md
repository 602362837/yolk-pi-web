# UI：IMP-002 review「开始用户验收」

## UI 影响判断

**需要 UI 证据：是（最小）。**

原因：新增用户可见写按钮与确认文案，触达 Studio 交互门禁；但**不**改变信息架构主骨架——只在既有「需要你的决定」决策区内增加一种固定 primary CTA 与确认模板。

## 是否需要完整独立 HTML 原型

| 选项 | 说明 | 建议 |
| --- | --- | --- |
| A. 完整自包含 HTML（多场景切换器） | 与主任务 Phase 1 同级 | **过重**（仅 1 kind + 1 场景主交付） |
| B. **最小原型 / 场景补丁** | 复用决策区样式，新增 `review` 场景卡：主 CTA「开始用户验收」+ 确认框文案；并保留旁路静态：user_acceptance 主验收、改进结果验收、非决策、归档 | **推荐且已交付** |
| C. 仅 Markdown 文案契约、无 HTML | 风险：确认框与决策区视觉歧义 | 仅当用户明确豁免原型门禁 |

**已按 B 执行并交付。** 本地交付原型路径：

- [studio-widget-start-user-acceptance-prototype.html](studio-widget-start-user-acceptance-prototype.html)（可直接打开并交互）

本文件与原型复用原 IMP-001 已交付视觉契约，语义不变。

## 信息层级（不变）

```text
顶栏/标题/完整 8 站 rail/元信息
→ 改进摘要 + 结果验收
→ 主任务结果验收（仅 user_acceptance）
→ 归档徽章
→ 只读资料 quickPreviews
→ 【决策区】userActions（本期 review 时：开始用户验收）
→ runtime / 子任务 / runs
```

**禁止**把「开始用户验收」放进：

- quick preview 按钮  
- 主验收绿色块（那是结果验收）  
- 改进橙块  
- plan-review modal / 文档页

## 场景矩阵

| 场景 | 决策区 | 验收区 | 备注 |
| --- | --- | --- | --- |
| `review`，无 unresolved | 主「开始用户验收」 | 无主验收按钮 | 可有 review_ready 提示（若有历史改进） |
| `review`，仍有 unresolved | 无本 CTA | 改进结果验收（若有 waiting_user_acceptance） | 不得用本 CTA 绕过改进 |
| 点 CTA → 确认中 | 按钮可 disabled | — | 说明进入 user_acceptance，不 completed |
| 成功后 `user_acceptance` | 决策区空 | 「确认主任务已验收完成」+ 可归档 | 复用现有 |
| `awaiting_approval` | 仍是批准/需要修改 | 无 | 不与本 CTA 共存 |
| 改进计划等待批准 | 仍是改进计划批准 | — | 不与本 CTA 共存（status 不同） |
| 执行中 / 归档 | 无决策 CTA | 归档无写 | 保全 |

## 确认框文案（固定模板）

- **标题**：开始用户验收？  
- **正文要点**：
  - 对象：主任务「{title}」
  - 将从 `review` 进入 `user_acceptance`
  - **这不是**结果验收，**不会** completed / 归档
  - 进入后请再点「确认主任务已验收完成」
- **按钮**：取消 / 开始用户验收  
- 取消：零请求

## 视觉与 a11y

- 复用 `.ypi-studio-decision-section` / `.ypi-decision-btn.is-primary`
- busy：「进入中…」+ `aria-busy`；全卡写锁
- `aria-label` 含任务标题与「开始用户验收，进入 user_acceptance，不是结果验收」
- 移动 sheet 按钮 ≥44px；focus-visible；reduced-motion 沿用决策区规则
- 不依赖颜色区分「进入验收」与「完成验收」——文案必须不同

## UI 设计员交付清单

1. 最小 HTML（场景 B）可本地打开交互确认/取消。  
2. 更新本文件 Review Request 勾选。  
3. 不得调用真实 API。  

## Review Request

- [x] 决策区 vs 主验收区分区清晰  
- [x] 确认文案不会被理解成一键完成  
- [x] review_ready 提示与新 CTA 可并存、不互相替换  
- [x] 移动宽度与键盘可用  
- [x] 完整 8 站 rail / quick preview / 改进结果验收 / 主验收静态场景仍可见  
