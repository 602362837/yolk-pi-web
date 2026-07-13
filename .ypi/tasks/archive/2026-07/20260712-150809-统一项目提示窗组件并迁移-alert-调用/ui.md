# UI

## 门禁结论

**触发 UI 原型门禁。** 本任务改变确认、取消、输入及反馈的用户可见交互，实施前必须由 `ui-designer` 产出基于当前项目视觉的 HTML 原型并取得用户审批。

## 派发状态

主会话已派发 `ui-designer`，原型已交付。用户审批原型和实施计划前，任务不得进入实现。

## UI 设计员任务书

请先阅读：

- `AGENTS.md`
- `docs/modules/frontend.md`
- `app/globals.css`
- `components/ProjectSpaceSwitchDialog.tsx`
- `components/DiffModal.tsx`
- `components/ModelsConfig.tsx` 中确认框和 toast 实现
- 本任务 `brief.md`、`prd.md`、`design.md`

请交付任务目录内的 `prompt-dialog-prototype.html`，`ui.md` 只负责说明和链接，纯 Markdown 不算原型。原型必须可独立打开并交互展示：

1. 默认确认：标题、正文、取消、确认。
2. danger 确认：删除会话或终止终端场景，危险按钮、长文案换行。
3. prompt：账户备注，预填值、提交空值、取消、校验错误。
4. notice：单按钮已读提示。
5. toast：success、error、堆叠/替换策略和手动关闭（若获批纳入范围）。
6. 状态：初始、键盘焦点、busy、disabled、校验错误、超长正文。
7. 视口：桌面和 375px 移动端；正文滚动、按钮换行、无重叠。
8. 浅色/深色主题，沿用项目 CSS variable 风格，不引入新的品牌视觉。

原型说明必须标注：初始焦点、Tab 顺序、Escape/Enter 行为、backdrop 行为、焦点恢复和 reduced-motion。

### 原型交互设计说明与标注

1. **初始焦点 (Initial Focus)**
   - **Confirm** (确认弹窗): 默认聚焦于 `取消 (Cancel)` 按钮，最大程度降低误触导致的危险或非预期操作。
   - **Prompt** (输入弹窗): 默认聚焦于输入框，并全选预填文本，方便用户直接打字或清除。
   - **Notice** (通知弹窗): 默认聚焦于唯一的确认按钮 (`知道了` / `确定`)，方便按 Enter / Space 快速确认已读。
   
2. **Tab 焦点循环 (Focus Trap)**
   - 使用 JavaScript 拦截 `keydown` 事件，当按下 `Tab` 或 `Shift+Tab` 时限制焦点在弹窗内的交互元素（input、button）中循环。
   - 处于 `busy` 状态的被禁用元素会被排除在焦点序列之外。

3. **Escape / Enter 交互契约**
   - **Escape**: 按下 ESC 时执行取消操作，返回 `false` (confirm) 或 `null` (prompt)。如果处于 `busy` 状态，ESC 按键将被拦截并失效。
   - **Enter**: 
     - **Prompt**: 按下回车键时触发表单提交。如果配置了必填或验证函数，会在前置触发校验错误并高亮输入框，阻止关闭。
     - **Notice / Confirm**: 按下回车键时触发确认操作。

4. **背景遮罩行为 (Backdrop)**
   - **Notice**: 允许点击 backdrop 关闭（等价于取消/已读）。
   - **Confirm / Prompt**: 依照 PRD 约定，不允许通过点击 backdrop 取消，防止用户在处理关键业务决策时发生误触。

5. **焦点恢复 (Focus Restoration)**
   - 在弹窗打开时记录 `document.activeElement`，在弹窗关闭（resolve / reject 结束后）仅当触发元素仍然挂载时将焦点恢复，保持流畅的键盘无障碍体验。

6. **响应式与减弱动画 (Reduced Motion)**
   - 支持 `@media (prefers-reduced-motion: reduce)`，当用户开启系统减弱动画设置时，直接跳过弹窗渐变显式与缩放动画。
   - 在 375px 移动端视口下，底部操作按钮组自动使用 flex 纵向反转排列 (`flex-direction: column-reverse`)，主行动按钮自动拉伸占满容器宽度，防止长词溢出。

7. **Toast 反包围与非阻塞通知**
   - Toast 面板采用固定定位挂载，多条触发时通过 `limit: 3` 对话队列自下向上推移堆叠，并提供定时 5 秒或手动 `×` 关闭。不干扰用户主交互焦点。

## 推荐交互基线

- confirm/prompt 不允许 backdrop 取消；Escape 可取消；busy 时禁用关闭。
- confirm 的初始焦点落在取消按钮；prompt 落在输入框；notice 落在确认按钮。
- danger 主按钮位于操作区末端，使用项目现有红色错误语义，不以颜色作为唯一提示。
- 移动端操作按钮可纵向排列并占满宽度，内容区最大高度受视口约束。
- toast 不阻塞操作、不抢焦点，错误信息保留足够停留时间并可手动关闭。

## 审批记录

- HTML 原型：[prompt-dialog-prototype.html](./prompt-dialog-prototype.html)，已由 UI 设计员于 2026-07-12 交付
- 用户审批：**未审批**
- 实施状态：**阻塞（等待原型与计划审批书确认）**
