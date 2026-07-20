# Design — IMP-001 Studio tag 注入预览

## 1. 方案摘要

在 **不改 L1** 的前提下，把 SCI L0 的「只剥不存」升级为「剥 + 保留注入块元数据 + 可点击 popover 只读预览」：

```
raw user text
  → parseYpiStudioUserMessage
      → displayText (unchanged use)
      → injectionBlocks[] / injectionText (NEW)
      → status / confidence (unchanged)
  → UserMessageView
      → clean bubble + Copy/Edit = displayText
      → if showTag: <button> tag → popover(injectionText)
```

## 2. AS-IS → TO-BE

### AS-IS（SCI 已交付）

- parse 丢弃块正文，只留 display  
- tag：`span[data-interactive=false]`，`pointer-events: none`  
- 排查只能靠打开 JSONL / 关 strip（无产品路径）

### TO-BE

- parse **同时**产出 display 与 injection 列表  
- tag：可聚焦 button，`aria-expanded`，`data-interactive="true"`  
- popover：只读 mono pre + Copy  
- L1 extension：**零改动**

## 3. 数据契约

### 3.1 扩展类型

```ts
export interface YpiStudioInjectionBlock {
  /** Tag name without brackets, e.g. ypi-studio-state */
  tag: YpiStudioInjectionTag;
  /** Inner body only (between open/close) */
  body: string;
  /** Full matched substring including tags */
  raw: string;
  /** 0-based start index in original rawText */
  start: number;
  /** 0-based end index (exclusive) in original rawText */
  end: number;
}

export interface YpiStudioUserDisplayContent {
  displayText: string;
  rawText: string;
  hadInjection: boolean;
  studioStatus: YpiStudioInjectionStatus | null;
  stripConfidence: YpiStudioStripConfidence;
  /** NEW: complete blocks in document order; empty when none */
  injectionBlocks: YpiStudioInjectionBlock[];
  /** NEW: blocks.map(b => b.raw).join("\n\n"); empty string when none */
  injectionText: string;
}
```

### 3.2 算法（与现网兼容）

1. 对 `COMPLETE_BLOCK_RE` 做 `matchAll` / 带 index 的 replace 回调：  
   - push `{ tag, body, raw: full, start, end }`  
   - 同步 status 提取逻辑保持不变  
   - display 路径仍替换为 `""` 再 `tidyDisplayText`  
2. `injectionText = blocks.map(b => b.raw).join("\n\n")`  
3. residual / partial 规则不变；**partial 时若已剥完整块**，blocks 仍可包含已剥完整块，但 **UI 仍不显示成功态 tag**（与 SCI：`showTag` 要求 `full`）。  
   - 设计选择：**UI 门闩不放宽**；partial 用户继续看全文（含半截），避免「半清理成功」误导。  
   - 可选后续：partial + 有 blocks 时显示 muted `Studio · partial`——**本改进不做**。  
4. 无注入：`injectionBlocks=[]`，`injectionText=""`  
5. fail-open catch（MessageView）：无 blocks、无 tag  

### 3.3 展示截断

```ts
export const YPI_STUDIO_INJECTION_PREVIEW_MAX_CHARS = 64 * 1024;

export function formatYpiStudioInjectionPreview(injectionText: string): {
  text: string;
  truncated: boolean;
} {
  if (injectionText.length <= YPI_STUDIO_INJECTION_PREVIEW_MAX_CHARS) {
    return { text: injectionText, truncated: false };
  }
  return {
    text: injectionText.slice(0, YPI_STUDIO_INJECTION_PREVIEW_MAX_CHARS) + "\n…",
    truncated: true,
  };
}
```

- **预览**用截断文本  
- **Copy injection** 优先完整 `injectionText`（若 `navigator.clipboard` 失败再降级）

## 4. UI 架构

### 4.1 组件边界

| 单元 | 职责 |
| --- | --- |
| `parseYpiStudioUserMessage` | 数据 |
| `UserMessageView` | 拥有 `previewOpen` 本地 state；渲染 tag button |
| `StudioInjectionPreviewPopover`（建议同文件或小组件） | 面板 DOM、Copy、Esc/outside |
| `app/globals.css` | tag interactive + popover 样式 |

不新建路由；不进 Studio 浮窗业务。

### 4.2 结构（对齐原型）

```
.message-user-meta-row
  .message-studio-tag-wrap   (position: relative)
    button.message-studio-tag[data-interactive=true][aria-expanded]
    [role=dialog or aria-labelledby].message-studio-injection-popover
      header (title + close)
      note (historical stripped, not live system)
      pre.injection-body
      footer actions: Copy injection | Copy full raw | Close
```

### 4.3 交互状态机

```
closed --click tag / Enter/Space--> open
open   --click tag / Esc / outside / Close--> closed
open A --open B (another message)--> close A, open B
```

实现建议：

- 每条 `UserMessageView` 本地 `useState(false)`  
- outside click：`mousedown` on `document` + ref contains  
- Esc：`keydown` when open  
- 互斥：可选 `document` 自定义事件 `ypi-studio-injection-preview:open` 广播，其它实例关闭——轻量、无全局 store  

### 4.4 定位

- Desktop：`position: absolute; right: 0; top: calc(100% + 6px); z-index` 高于 bubble actions  
- 宽度：`min(420px, 92vw)`  
- max-height：`min(320px, 50vh)` 给 pre 区域  
- 窄屏：若下方空间不足，可用 `bottom: calc(100% + 6px)` 向上翻（原型示意两种）；**允许**实现 v1 只做下方 + 视口内 `fixed` 简化，但须在 UAT 不裁切关键按钮  

### 4.5 a11y

| 项 | 规格 |
| --- | --- |
| tag | `button type="button"`，可见文字仍为 `Studio · {status}` |
| aria | `aria-expanded={open}`，`aria-controls={panelId}`，`aria-haspopup="dialog"` |
| panel | `role="dialog"` + `aria-labelledby`；**不**强制 focus trap（轻量 popover；Esc 关闭后焦点回 button） |
| title | 打开时：`Studio · {status} — view stripped injection`；关闭时保持 SCI 文案 |
| 勿 | 把整段 injection 塞进 aria-label |

### 4.6 与现网 Copy 分离

| 动作 | 数据 |
| --- | --- |
| 气泡 Copy | `displayText` |
| Edit from here | `displayText` |
| Popover Copy injection | `injectionText` |
| Popover Copy full raw | `rawText` |

## 5. 影响模块

| 模块 | 改动 |
| --- | --- |
| `lib/ypi-studio-message-display.ts` | blocks + helpers |
| `scripts/test-ypi-studio-message-display.mjs` | 新用例 |
| `components/MessageView.tsx` | interactive tag + popover |
| `app/globals.css` | interactive tag、popover；删除/收窄 `pointer-events: none` 对 true 的影响 |
| `docs/modules/frontend.md` / `library.md` | 一句更新 |
| `lib/ypi-studio-extension.ts` | **不改** |
| session-title | **不改**（仍只用 strip） |

## 6. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 用户以为预览 = 本轮 system 注入 | 面板固定说明文案；PRD 边界；plan-review 强调 |
| 大块注入卡 UI | 展示截断 64KiB |
| outside click 与 Chat hover actions 冲突 | mousedown + stopPropagation on panel；不关在 button 自身 |
| z-index 被侧栏/widget 盖住 | 使用与 session-stats popover 同级或更高的 token（实现时对照 `--z-*` / 现网 popover） |
| 安全：注入块含用户敏感 knowledge | 只读本地已有消息内容，不新增网络；Copy 由用户主动 |
| 回归 SCI strip | 单测保留 U1–U14；新增 blocks 断言 |

## 7. 回滚

- 回滚 MessageView + CSS 即可回到非交互 tag  
- parse 新增字段向后兼容；若需硬回滚可保留字段但不渲染 button  

## 8. 与 L2 原规划关系

SCI design §10 L2 含「点击 tag 展开原始注入」。本改进 = 将该 L2 项中的 **历史脏消息只读预览** 单独交付；**不含** display:false 注入通道、no_task 轻量、system 清洗历史。
