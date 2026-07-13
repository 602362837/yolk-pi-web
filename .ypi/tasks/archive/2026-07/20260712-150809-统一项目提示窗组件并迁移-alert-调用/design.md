# Design

## 方案摘要

在应用 React 根部放置单一提示宿主，通过 Context 暴露命令式异步 API。调用请求进入 FIFO 队列，宿主只渲染队首提示并负责焦点、键盘、滚动锁和 Promise 结算。视觉组件与队列控制分层，避免每个业务组件复制 modal state。

建议文件边界（最终命名可按邻近代码调整）：

- `components/AppPromptProvider.tsx`：Context、队列、Provider、hook、portal 宿主。
- `components/AppPromptDialog.tsx`：纯展示和局部输入/校验状态。
- `components/AppToastViewport.tsx`：若 toast 纳入范围，负责 live region、计时和响应式堆叠。
- `components/AppShell.tsx` 或 `app/layout.tsx`：挂载唯一 Provider，需确保覆盖所有迁移调用方。

## API 契约

```ts
type PromptIntent = "default" | "danger";
type NoticeTone = "info" | "success" | "warning" | "error";

type BasePromptOptions = {
  title: string;
  message?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  intent?: PromptIntent;
};

type PromptInputOptions = BasePromptOptions & {
  initialValue?: string;
  placeholder?: string;
  required?: boolean;
  validate?: (value: string) => string | null;
};

type AppPromptApi = {
  notice(options: Omit<BasePromptOptions, "cancelLabel"> & { tone?: NoticeTone }): Promise<void>;
  confirm(options: BasePromptOptions): Promise<boolean>;
  prompt(options: PromptInputOptions): Promise<string | null>;
};
```

`message` 若允许 ReactNode，只能由本地可信调用方构造；不接受服务端 HTML。API 应由 Context 提供，Provider 外调用在开发环境抛出明确错误。

## 状态机与数据流

```text
caller -> enqueue(request + resolver + triggerElement)
       -> active request rendered
       -> user confirm/cancel/Escape
       -> settle exactly once
       -> restore trigger focus
       -> dequeue next request
```

请求状态：`queued -> active -> settled`。使用稳定 request id 和 settled guard。不要将 resolver 放入可序列化业务状态或跨服务端边界。Provider 卸载时 active 和 queued 均按取消值 resolve。

prompt 的草稿和校验错误属于 active dialog 局部状态，请求 id 变化时重置。IME composition 时 Enter 不提交。confirm resolve 后立刻关闭，原业务 handler 继续执行；业务 loading/error 仍由原组件负责。

## 焦点与页面隔离

- 打开时记录 `document.activeElement`。
- dialog 内实现可复用 focus trap；隐藏/禁用元素不得进入循环。
- 关闭后仅当触发元素仍连接且可聚焦时恢复焦点。
- portal 到 `document.body`，使用固定层级；与现有 z-index 1100/1300 协调，提示窗建议 1400、toast 1500，并验证 Settings/Studio/Terminal 上层场景。
- active 时锁定 body scroll，并对背景使用 `inert`（需兼容性回退/验证）；不要简单给整个 React 根 `aria-hidden` 导致 portal 也被隐藏。
- 嵌套业务 modal 内触发时，只让最上层提示窗响应 Escape；关闭后回到原 modal 的触发按钮。

## 迁移策略

逐调用点保持原条件与控制流：

```ts
const confirmed = await confirm({ ... });
if (!confirmed) return;
// 原逻辑不变
```

事件 handler 改为 async 时，检查 React 回调签名和未处理 rejection。账户备注使用：取消 `null`，清空 `""`，保留现有 trim/清除语义。危险场景包括删除会话、终止终端、删除凭据、刷新锁修复；额度消耗和模板覆盖至少使用 warning/danger 文案层级，由 UI 审批确认。

## Toast 边界

Toast 只表达操作结果，不替代需要用户决策的 confirm。若本次纳入：

- API：`toast({ tone, message, durationMs? }) -> id`、`dismissToast(id)`。
- 默认最多 3 条，超出按旧到新退出；相同 key 可更新而非重复。
- hover/focus 暂停计时，组件卸载清 timer。
- success/info polite，error assertive；可手动关闭。

若用户决定不纳入，本次不改 `ModelsConfig` 局部 toast，但应在后续任务迁移，且统一组件名称不要暗示已覆盖 toast。

## 兼容性

- 无服务端/API/持久化变更。
- 原生 confirm 会阻塞 JS；新提示窗异步且不阻塞。调用方必须 `await`，这是最大行为差异。
- 浏览器返回/刷新时未结算 Promise 会随页面销毁，无持久化要求。
- React Strict Mode 下 effect 清理必须幂等。

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 忘记 await 导致危险操作直接执行 | 类型返回 Promise；逐点 review；检查测试 |
| 多个确认同时触发、resolver 覆盖 | FIFO 队列、stable id、settled guard |
| 嵌套 modal 焦点/ESC 冲突 | portal 顶层、stopPropagation、焦点恢复人工验收 |
| Provider 覆盖范围不足 | 在 AppShell 上层挂载并逐调用点验证 |
| prompt 空值与取消混淆 | `string | null` 明确契约和专项测试 |
| toast timer 泄漏/重复 | timer registry + cleanup + fake timer 或组件测试 |
| z-index 被 Settings/Terminal 遮挡 | 建立层级并在所有触发容器验收 |

## 回滚

先保留原业务逻辑，只替换交互入口。若统一宿主出现严重问题，可按调用点恢复原生调用并移除 Provider；无数据迁移和服务端回滚。回滚不能只移除 Provider 而留下 hook 调用。
