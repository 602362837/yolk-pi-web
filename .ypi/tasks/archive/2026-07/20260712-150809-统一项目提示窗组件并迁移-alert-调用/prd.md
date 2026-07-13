# PRD

## 目标与用户价值

用项目内一致、非浏览器原生的提示窗替代生产前端的 `window.confirm` / `window.prompt`，让用户在桌面和移动端获得可预期的确认、取消、输入和反馈体验，并让开发者通过类型化异步 API 使用统一能力。

## 范围内

- 应用级提示窗宿主、调用 hook 与类型。
- `notice`、`confirm`、单行 `prompt` 的视觉与行为规范。
- 可选但推荐同步统一的全局 toast 能力，以及 `ModelsConfig` 现有局部 toast 迁移。
- 迁移以下 14 个原生调用：

| 文件 | 数量 | 场景 |
| --- | ---: | --- |
| `components/ChatGptUsagePanel.tsx` | 2 confirm | 消耗重置机会；删除刷新锁 |
| `components/SessionSidebar.tsx` | 3 confirm | 删除会话；两处归档项目入口 |
| `components/YpiStudioPanel.tsx` | 2 confirm | 归档 Studio 任务；覆盖默认模板 |
| `components/ModelsConfig.tsx` | 3 confirm + 1 prompt | 重置额度；删除凭据；账户备注 |
| `components/AppShell.tsx` | 1 confirm | 跨工作区打开终端前关闭 dock |
| `components/TerminalPanel.tsx` | 2 confirm | 关闭终端 dock；关闭最后 tab |
| `components/FileViewer.tsx` | 1 confirm | 放弃未保存修改并重载 |

## 范围外

- 重构复杂业务 modal，如 `DiffModal`、`ProjectSpaceSwitchDialog`、Settings、Usage、SSH 编辑器。
- 修改 API、数据模型或操作本身的业务语义。
- 全项目文案翻译或术语统一。
- 多字段表单、富文本 editor、extension UI 请求协议。

## 功能需求与验收标准

### FR-1 类型化调用

调用方可通过 React hook 发起 notice、confirm、prompt；返回 Promise，取消/关闭语义稳定：confirm 返回 `false`，prompt 返回 `null`，notice 返回 `void`。调用方不直接管理 modal state。

### FR-2 严格串行

同一时间只显示一个提示窗；并发请求按 FIFO 排队。每个 Promise 恰好 resolve 一次。Provider 卸载时所有当前/排队请求按取消语义结算，不留下悬挂 Promise。

### FR-3 确认语义

- 默认操作与破坏性操作视觉明确。
- 危险操作的确认按钮使用 danger intent，取消按钮保留中性样式。
- busy 状态防止重复提交；本次迁移的同步确认在 resolve 后由调用方执行原有异步操作。
- confirm/prompt 默认不允许 backdrop 取消；Escape 等价取消（若业务 busy 则禁用）。

### FR-4 输入语义

prompt 支持标题、正文、初值、placeholder、确认/取消文案、必填及同步校验。账户备注场景允许空字符串表示清除，必须保留“取消”和“提交空值”的区别。

### FR-5 可访问性与键盘

- confirm/prompt 使用 `role="alertdialog"`；普通 notice 根据紧迫性使用 `dialog` 或 `alertdialog`。
- 设置 `aria-modal="true"`、可访问标题和正文关联。
- 打开后焦点进入弹窗；prompt 聚焦输入框，confirm 的初始焦点默认落在取消按钮，降低误触风险。
- Tab/Shift+Tab 焦点循环；Escape 取消；Enter 在 prompt 校验通过时提交，在 textarea/组合输入期间不得误提交。
- 关闭后恢复到触发元素；背景不可交互，滚动锁定。
- toast 使用 `role="status"` / polite live region；错误提示可使用 assertive，但不得抢焦点。

### FR-6 响应式与视觉

- 使用现有 CSS variables；卡片圆角不超过 8px，按钮和文字不溢出。
- 桌面提示窗宽度约 420-520px；移动端使用 `calc(100vw - 24px)`，限制最大高度并让正文独立滚动。
- 底部操作区在窄屏可换行或纵向排列，危险主操作仍保持明确顺序。
- 支持 `prefers-reduced-motion`，动画不影响布局。

### FR-7 完整迁移

上述生产源码 14 个调用全部迁移，`rg` 在 `app components hooks lib` 的 TS/TSX 生产文件中不再发现浏览器原生 `alert/confirm/prompt`（Pi SDK 的 `session.prompt` 和 extension UI 类型不计）。原有操作的执行条件、参数和错误处理保持不变。

## 非功能需求

- 不引入新依赖，优先 React context + portal（若现有根布局可直接宿主则遵循现有结构）。
- 严格 TypeScript，不暴露 `any`。
- 支持 React Strict Mode effect 重放，不出现重复 resolve、重复 toast timer 或焦点恢复错误。

## 未决问题

- 是否将 toast 纳入同一批实现与迁移。
- 文案是否保持现有中英文。
- HTML 原型及用户审批尚未完成，实施被阻塞。
