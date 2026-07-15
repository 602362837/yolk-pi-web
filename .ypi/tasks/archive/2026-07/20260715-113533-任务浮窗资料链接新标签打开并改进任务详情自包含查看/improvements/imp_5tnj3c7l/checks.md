# Checks — IMP-001 任务资料预览滚动

## 需求覆盖

- [ ] Page 模式：打开长资料后**不点击正文**即可滚轮/触控板滚动。  
- [ ] Page 模式：头部与只读提示在滚动时保持可见；无 window+body 双滚动条。  
- [ ] Embedded 模式：详情内打开资料后**不点击正文**即可滚动。  
- [ ] Embedded：返回按钮与文档头不被滚出视口。  
- [ ] 关闭内部文档后，普通详情 Tab（计划/产物/事件等）长内容仍可滚动。  
- [ ] loading/empty/error 布局不出现「只有中部小块可滚」。  
- [ ] 窄屏返回按钮可见，正文可滚。  
- [ ] 打开策略、HTML preview、只读 GET 语义无回归。  
- [ ] 无 grant / transition / PATCH 由滚动交互触发。

## 自动验证

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

（纯布局修复；不强制新单测。若抽出 scrollMode helper 可补轻量测试。）

## 人工验收

### Page（新标签）

1. 右侧任意文件保持打开；浮窗点计划审批书/PRD。  
2. 新标签出现后，**指针移到正文但不点击**，滚动触控板/滚轮。  
3. 期望：正文立即滚动；头/只读条仍见；原工作台右侧不变。  
4. 将指针移到页眉空白再滚：不应卡死或误滚错层。

### Embedded（任务详情）

1. 打开任务详情 → 计划审批书 → 点 Design。  
2. **不点击正文**直接滚动。  
3. 确认返回按钮仍可见；点返回恢复计划审批书 Tab，该 Tab 仍可滚。  
4. Artifacts / 改进资料各验一次。

### 窄屏 / a11y

- 窄视口头部两行，返回仍首个可聚焦控件。  
- Tab 可达返回/重试；Escape 不关整个 Drawer。

### 回归

- HTML 原型仍新标签 CSP。  
- popup blocked 仍只 toast。  
- Chat Markdown 默认链接不变。

## 审批门禁

- [x] brief/prd/design/implement/checks/ui/plan-review 已写。  
- [x] HTML 原型已提供。  
- [ ] 用户明确批准计划与原型。  
- [ ] 批准后方可实现。
