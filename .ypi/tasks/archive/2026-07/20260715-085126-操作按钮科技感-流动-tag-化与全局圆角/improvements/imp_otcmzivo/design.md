# Design — IMP-001 最大合理替换

## 方案摘要

四层交付（相对旧「能力-only」扩大第 4 层）：

1. **SVG primitive**：`ActionFlowIcon`（已有，基本不动）。
2. **Host motion contract**：宿主无关 `[data-icon-flow]` + `.action-flow-icon__overlay`。
3. **Policy**：白名单尽量替换 / 黑名单硬拒绝；文档化。
4. **Batch migration**：按区域批量把 inline stroke SVG 换成 `ActionFlowIcon` 并挂 `data-icon-flow`。

原「0 示范 / 仅 Browser Share 可选」路径作废。

## 推荐 API

| 名称 | 职责 |
| --- | --- |
| `ActionFlowIcon` | 唯一 SVG base+overlay |
| `data-icon-flow="interactive\|ambient\|off"` | 全局 opt-in |
| `iconFlowAttrs(mode)` | 薄 helper，防拼写错误 |
| `.tech-action-tag` | **可选** chrome，不是能力前提 |
| `FlowIconButton` | **不新增**（避免第二套 button 体系） |

**禁止**

```css
button:hover .action-flow-icon__overlay { animation: … } /* 无 data-icon-flow */
button { animation: … }
```

## CSS 解耦

目标选择器（实现方向）：

```css
[data-icon-flow="interactive"]:is(:hover, :focus-visible, .is-active, [aria-pressed="true"], [aria-expanded="true"]):not(:disabled)
  .action-flow-icon__overlay { /* show + dash animate */ }

[data-icon-flow="ambient"]:not(:disabled) .action-flow-icon__overlay { /* ambient */ }

/* stagger still scoped */
.sidebar-utility-actions > [data-icon-flow="ambient"]:nth-child(n) .action-flow-icon__overlay { animation-delay: … }

[data-icon-flow="off"] .action-flow-icon__overlay,
[data-icon-flow]:disabled .action-flow-icon__overlay,
:disabled[data-icon-flow] .action-flow-icon__overlay { opacity: 0; animation: none; }

@media (prefers-reduced-motion: reduce) {
  .action-flow-icon__overlay { opacity: 0; animation: none; }
}
```

默认：无 `data-icon-flow` 时 overlay 保持 `opacity: 0`（与现网一致）。

## 替换技术手法

对每个白名单按钮：

1. 宿主增加 `data-icon-flow={disabled ? "off" : "interactive"}`（或 ambient 仅侧栏 utility）。
2. 将内联 `<svg stroke=…>…paths…</svg>` 改为：

```tsx
<ActionFlowIcon width={…} height={…} strokeWidth={…} viewBox="…">
  {/* 原 path/line/rect/circle/polyline 几何，不改语义 */}
</ActionFlowIcon>
```

3. 删除会与 CSS 争用的内联 `onMouseEnter` 颜色改写（若存在且仅服务于旧 hover 色）；**保留**业务 `onClick`。
4. 动态几何（如 sound on/off 两套 path）：两套都包进 `ActionFlowIcon`，或按状态切换 children。
5. 条件实心图标（Stop、Compacting 方块）：**不**包 flow；保持 fill。

## 模块影响

| 模块 | 改动 |
| --- | --- |
| `app/globals.css` | 解耦 motion；保留 token；ambient 容器限定 |
| `components/ActionFlowIcon.tsx` | 注释：须搭配 data-icon-flow |
| `components/iconFlow.ts` | 建议新增 `IconFlowMode` + `iconFlowAttrs` |
| `AppShell.tsx` / `BranchNavigator.tsx` | 契约迁移 + explorer 刷新 |
| `BrowserShareControl.tsx` / `ChatInput.tsx` / `MessageView.tsx` | B1 |
| `SessionSidebar.tsx` | B2 工具条 |
| `FileViewer.tsx` / `ChatGptUsagePanel.tsx` / `UsageStatsModal.tsx` / `UsageProviderModelTable.tsx` / `ModelsConfig.tsx` / `SkillsConfig.tsx` | B3 |
| `TerminalPanel.tsx` 等 | B4 尽量 |
| `docs/modules/frontend.md` | 复用与黑白名单 |

不改：`app/api/**`、`lib/**`、session/SSE。

## 数据流

无服务端变化。表现层：

```text
<button data-icon-flow="interactive" …>
  <ActionFlowIcon>{geometry}</ActionFlowIcon>
  optional label
</button>
```

## 兼容

- SSR：`useId` 稳定。
- Theme：`--icon-flow-a/b/c`。
- Safari/Chromium：gradient URL per instance；base fallback。
- 多图标同屏：每实例独立 gradient id。

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 范围大导致漏改/误改 | 分批 DAG；checks 按文件清单；黑名单静态搜索 |
| 行内按钮被误加 flow | PRD 黑名单 + checker 打开 Session 列表抽样 |
| 双动画 | Git refresh 等 spin 黑名单 |
| hover 内联 style 覆盖 | 迁移时删除冲突 mouse 改色 |
| 噪声 / 耗电 | 仅 interactive（hover 才动）；ambient 不扩散 |
| ModelsConfig 体积大 | 只改工具条/明确 aria 入口，不做账户行 Disable |
| 选择器过宽 | 双条件：attr + `.action-flow-icon__overlay` |

## 回滚

1. 恢复 globals 选择器与各组件 SVG。
2. 删除 `iconFlow.ts` 与文档段落。
3. 无数据迁移。可按批次文件独立回退。
