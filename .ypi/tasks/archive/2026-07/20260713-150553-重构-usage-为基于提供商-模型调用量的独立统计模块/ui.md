# UI：Usage Provider / Model 调用统计

## UI 原型门禁

**已触发，且当前未满足。** 本任务重构 `UsageStatsModal` 的信息架构、过滤方式、主列表与异常状态。按照 Studio 规则，主会话必须指派 **UI Designer**，由其基于现有项目交付 HTML 原型；本文件的 Markdown 说明不能替代原型，也不能据此进入实现。

## UI Designer 委托要求

### 必须先读

- `components/UsageStatsModal.tsx`
- `components/SessionStatsChips.tsx`（只理解边界，首期不改顶栏）
- `components/AppShell.tsx` 中 Usage modal 入口
- `app/globals.css` 的 modal/usage 样式与项目 CSS variables
- [`prd.md`](prd.md) 与 [`design.md`](design.md)

### HTML 交付

- 建议路径：`usage-provider-model-prototype.html`
- `ui.md` 更新为链接该 HTML，并记录原型 revision。
- 原型必须是可独立打开的 HTML，使用现有浅/深色 token 风格；不得以纯 Markdown 或静态截图替代。

### 原型必须覆盖

1. **主视图**：顶部总览 + Provider 分组 / Model 行；列至少含 calls、success/error、input、output、cache read/write、reasoning（可用时）、cost、占比。
2. **过滤**：日期范围、All/Current workspace、source（Chat/Studio/Assist/System）、status；清除过滤。
3. **展开/下钻**：Provider 展开 models；可选 source/session drill-down，但不能让 session 成为主维度。
4. **Coverage banner**：live ledger、historical backfill、历史不可恢复、SDK 内部 retry 不可观测、corrupt/skipped 记录。
5. **状态**：loading、empty、error+retry、partial coverage、backfilling、零费用但有 calls、本地模型 cost=0、unknown provider/model。
6. **响应式**：980px modal/desktop 与 ≤640px；窄屏应选择横向表格、列折叠或详情抽屉之一，并明确交互。
7. **可访问性**：dialog、焦点管理、Esc、键盘筛选/展开、非纯颜色状态、数值表头语义。
8. **兼容提示**：页面可标明“Chat 顶栏继续显示 session rollup，和全局调用账本口径不同”。

## 推荐信息层级

- L1：Cost / Calls / Tokens / Error rate / Coverage since。
- L2：趋势（按 calls 或 cost 切换）。
- L3：Provider → Model 主表。
- L4：Source 与 status 细分、coverage diagnostics。
- Session/Parent rollup 作为次级详情或 legacy link，不占主视图。

## 用户审批记录

- HTML prototype：[usage-provider-model-prototype.html](usage-provider-model-prototype.html) (Revision 1)
- 用户审批：**未取得 (等待主会话反馈)**
- 当前结论：**不得进入 implementing；主会话需引导用户审查 HTML 原型并获取审批确认后再推进。**
