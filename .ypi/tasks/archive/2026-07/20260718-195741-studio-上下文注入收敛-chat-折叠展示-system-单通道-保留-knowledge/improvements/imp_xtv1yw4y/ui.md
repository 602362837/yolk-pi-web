# UI — IMP-001 Studio tag 注入预览

> **门禁状态**：HTML 原型已写入本改进目录，**待用户批准**后实现。  
> **原型文件**：[sci-injection-preview-prototype.html](sci-injection-preview-prototype.html)

## 1. 门禁

| 项 | 结论 |
| --- | --- |
| 是否触发 | **是** — 非交互 tag → 可点击 + popover |
| 原型 | [sci-injection-preview-prototype.html](sci-injection-preview-prototype.html) |
| 批准前 | 禁止改生产 `MessageView` / 相关 CSS 交互 |

## 2. 设计目标

1. 默认阅读路径不变：干净正文优先  
2. 排查入口克制：仅 compact tag，不新增气泡内常驻大块  
3. 预览只读、可扫读、可复制  
4. 明确「历史 user 剥离块 ≠ 实时 system 注入」  
5. 明暗 / 窄屏 / 键盘可用  

## 3. 信息架构

```
[ Studio · implementing ▾ ]   ← button, 气泡上方右对齐
        │
        └─ popover
             header: Studio · implementing | ×
             note: Stripped from this user message (historical)…
             pre: <ypi-studio-state>…</…>
             actions: Copy injection | Copy full raw | Close
.message bubble (clean user text)
.message actions (Copy clean | Edit | …)
```

阅读优先级：**用户正文 > tag > 打开后的 popover > actions**。

## 4. 状态矩阵

| 场景 | UI |
| --- | --- |
| 无注入 | 无 tag（同 SCI） |
| full + status | **可点击** tag；关闭时 `aria-expanded=false` |
| full + 打开 | tag `aria-expanded=true`；popover 可见 |
| 仅 knowledge → status=context | 可点；标题 `Studio · context` |
| partial | **无**成功可点 tag（全文保守） |
| parse fail | 无 tag |
| 新 SCI 干净消息 | 无 tag；**无**本轮 system 预览入口 |

## 5. 视觉规格

### 5.1 Tag（相对 SCI 增量）

| 项 | SCI L0 | IMP-001 |
| --- | --- | --- |
| 元素 | `span` | `button.type=button` |
| cursor | default | pointer |
| data-interactive | false | true |
| 焦点 | 不进 Tab | `:focus-visible` accent 描边 |
| 可选指示 | — | 右侧小 chevron / `▾`（原型有；实现可用 CSS 或字符，不强制图标库） |

色差 `data-status` **完全复用** SCI token 映射。

### 5.2 Popover

| 项 | 规格 |
| --- | --- |
| 背景 | `var(--bg-elevated, var(--bg-subtle))` + `var(--border)` |
| 阴影 | 轻阴影，对齐 session-stats / 顶栏 popover 气质 |
| 圆角 | 10–12px |
| 标题 | 12–13px 字重 650 |
| note | 11px `var(--text-muted)` |
| pre | 11–12px mono；`white-space: pre-wrap`；`word-break: break-word`；padding 8px；bg `var(--bg)` |
| 按钮 | 现网小按钮样式；Primary=Copy injection |

### 5.3 文案

| 位置 | 文案 |
| --- | --- |
| Tag | `Studio · {status}` |
| Panel title | `Studio · {status}` |
| Note | `Stripped from this user message (historical). Not the live system prompt.` |
| 截断提示 | `Preview truncated for display. Copy still uses full injection text.` |
| Copy injection | `Copy injection` → 成功短暂 `Copied` |
| Copy full raw | `Copy full raw` |
| Close | `Close` / `×` |
| 空 blocks（不应出现若 showTag） | 不渲染面板 |

中文产品环境可将 note 用中文（推荐默认）：

> `来自此条用户消息的历史注入（已从气泡剥离）。不是当前 system 通道的实时注入。`

## 6. 交互细节

| 操作 | 行为 |
| --- | --- |
| 单击 tag | toggle popover |
| Esc | 关闭并 focus tag |
| 外侧 mousedown | 关闭 |
| 面板内点击 | 不关闭 |
| Copy injection | clipboard.writeText(injectionText) |
| Copy full raw | clipboard.writeText(rawText) |
| 气泡 Copy | 仍 displayText |
| 滚动 Chat | popover 随消息滚动（absolute 锚定）；若实现 fixed 则滚动关闭——**推荐 absolute 锚定 meta-row** |

## 7. 无障碍

- 不只靠颜色：tag 有文字；打开态可用 `aria-expanded`  
- 关闭按钮有 `aria-label="Close injection preview"`  
- 不强制 modal trap（避免打断 Chat 阅读）；若实现 focus trap 也可，但非必须  
- `prefers-reduced-motion`：无必选动画；若有 fade 则缩短/取消  

## 8. 实现映射

| 步骤 | 位置 |
| --- | --- |
| 1 | `lib/ypi-studio-message-display.ts` 扩展返回值 + preview helper |
| 2 | `UserMessageView`：button + state + popover |
| 3 | `app/globals.css`：interactive tag、popover、移除 true 路径的 pointer-events none |
| 4 | 对照本 HTML 原型 §验收 |

## 9. UI 验收点

1. 脏消息默认干净 + 可点 tag  
2. 打开后 mono 预览含完整标签文本  
3. note 说明 historical ≠ live system  
4. Copy injection / full raw / 气泡 Copy 三者数据源正确  
5. Esc / outside / close / toggle  
6. 干净消息零回归  
7. 明暗 + 窄屏不裁切主按钮  
8. partial 无成功可点 tag  
9. 与 [sci-injection-preview-prototype.html](sci-injection-preview-prototype.html) 一致  

## 10. 非目标（UI）

- 实时 system 注入面板  
- 注入块 Markdown 渲染  
- 编辑 / 删除 JSONL  
- Studio widget 视觉改版  
