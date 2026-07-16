# Design：模型用量组件聚合（v6 多环、流光与焦点分栏版）

## 方案摘要

采用“**AppShell 互斥挂载 + provider adapter 单状态所有者 + shared N-ring primitive + aggregate focus/hover shell + provider columns**”方案：

- 新增默认关闭的 `usage.providerPanelsAggregated`。
- aggregate=false 时继续 standalone GPT → Grok → Kiro；Full/Compact 共用 N-ring primitive，standalone 继续 click detail。
- aggregate=true 时只挂载一个 `ProviderUsageAggregatePanel`；hover/focus 打开，按 provider 分栏，不使用 accordion。
- adapter 只负责安全窗口投影和 outer→inner 排序；primitive 统一中心最内层、层身份、threshold、unknown、流光与 a11y。
- aggregate shell 不 fetch、不解释 provider schema、不计算跨 provider 指标。

## 不可变设计决策

### N-ring 与中心

```text
1 safe window  → 1 ring
N safe windows → N concentric rings, layers[0] outer/longest … layers[N-1] inner/shortest
centerLayerId  = layers[layers.length - 1].id
```

- GPT：`[周, 5h]`，中心 `5h`。
- Grok：`[月, 周]`，中心 **`周`**（替代 v5 的中心月规则）。
- Kiro：与其他 provider 相同；所有安全且可可靠排序的 bucket 都进入 `layers`，不再有“默认 primary single”产品特例。
- `percent:null` 不影响窗口存在性：若该窗口已安全投影，它仍占一层并可成为 innermost center，中心值为 `—`。
- 无法安全投影或排序的窗口不进入 trigger layers；不可把数组顺序、reset 或 remaining 当 duration 证据。

### 层身份与风险

- 每个 nesting index 绑定稳定 layer token，例如 `layer-0/outer`、`layer-1`、`layer-2`；UI v6 选择高辨识色相或 stroke pattern。层身份不能只靠 alpha。
- normal used arc 使用 layer token；warning/danger 是第二通道，例如本层 outline/glow/track marker/tone token，必须仍能区分相邻层。
- 每层独立 clamp 和 tone：`>=95 danger`、`>=80 warning`、其余 normal；无 composite percent/risk ring。
- unknown 为 muted empty track；文字明确“未知”。

### Used arc 流光

- primitive 为每层拆分 `track`、`used arc`、`sheen overlay`；sheen 被同一 percent mask 裁剪，只在 used arc 内移动。
- 流光是 CSS-only、低对比、低频、无布局变化；不得旋转整环造成“额度在增长”的错觉。
- `percent<=0` 或 `null` 不渲染 active sheen；100% 仍只在完整 used arc 上轻微流动。
- `@media (prefers-reduced-motion: reduce)` 将 sheen animation 和非必要面板 transition 设为 `none`，保留静态 used arc/tone。

## 影响模块与边界

| 模块 | 计划变更 | 边界 |
| --- | --- | --- |
| `lib/pi-web-config.ts` | aggregate boolean defaults/normalize/validate/patch | 无新存储/API |
| `components/SettingsConfig.tsx` | aggregate toggle、dirty、Compact disabled/hint | Compact 值不改写 |
| `components/ProviderUsageTrigger.tsx` | shared N-ring primitive；Full/Compact ring-first | standalone click 仍由 provider panel 控制 |
| `components/ProviderUsagePanelContract.ts`（新增） | layers/unit/projection/risk 安全契约 | 禁止账号/credential/raw payload |
| `components/ProviderUsageAggregatePanel.tsx`（新增） | focus/hover open state、columns、Escape/viewport | 不 fetch、不使用 accordion |
| GPT/Grok/Kiro panels | adapters、aggregate presentation、detail column | 保留 provider race/cache/操作语义 |
| `components/AppShell.tsx` | aggregate/standalone 互斥挂载 | host/padding/enable 不变 |
| `app/globals.css` | N-ring、layer tokens、sheen、columns、responsive/reduced-motion | 尺寸以 UI v6 为准 |

## 配置与呈现矩阵

```ts
export interface PiWebUsageConfig {
  includeArchived: boolean;
  providerPanelsCompact: boolean;
  providerPanelsAggregated: boolean; // default false
}
```

```text
aggregate=false compact=false → standalone Full, click detail
aggregate=false compact=true  → standalone Compact, click detail
aggregate=true                → one aggregate focus/hover trigger + provider columns
                                compact 配置保值但不参与呈现
```

## Shared N-ring contract

```ts
export type ProviderUsageRingTone = "normal" | "warning" | "danger" | "muted";

export interface ProviderUsageRingLayer {
  id: string;
  shortLabel: string;
  fullLabel: string;
  percent: number | null;
  title: string;            // allowlisted semantics
  orderEvidence?: string;   // normalized safe evidence; never rendered raw
}

export interface ProviderUsageRingUnit {
  layers: readonly [ProviderUsageRingLayer, ...ProviderUsageRingLayer[]]; // outer → inner
  centerLayerId: string;    // invariant: layers.at(-1).id
  unknownCenterValue?: string | null;
  shortValue?: string | null;
  ariaLabel: string;
}
```

Primitive invariants：

1. `layers` 非空、stable id 唯一；primitive 不猜 provider 周期顺序。
2. `centerLayerId !== layers.at(-1).id` 是开发错误，测试必须失败，不静默 fallback。
3. center 第一行取 innermost `shortLabel`；第二行仅取同层 percent，null 时为 `unknownCenterValue ?? "—"`。
4. 每层独立 percent/tone；layer token 按 nesting index 固定，风险作为第二通道叠加。
5. 每层 geometry 共享 bounding box，由外向内逐层缩进；所有安全 layers 都必须渲染，不能用“+N”替代或静默丢弃。UI v6 需确认至少 1/2/3 层及更多层的自适应尺寸策略；若真实层数超过获批可读边界，停止并请求产品决定，而不是自行截断。
6. arcs 与 sheen `aria-hidden`；unit 提供完整 outer→inner aria/title。
7. Full、Compact、aggregate 共用 primitive，不复制 conic/clamp/threshold/unknown/animation 算法。

## Provider adapters

### GPT

- 安全窗口按 `[week, fiveHour]` 投影；两者存在时外周内5h，中心5h。
- 5h unknown 仍保留内层和中心 `5h/—`；只有 5h 窗口不存在时中心才退至周。

### Grok

- 安全窗口按 `[month, week]` 投影；双层中心为最内层 **周**。
- month unknown/week known：中心仍周/week%；week unknown：中心周/—；只有 week 不存在时 single 月。
- stale 同账号可信值可保留并加 warning context；reauth/error 无可信 quota 时 fallback。

### Kiro

- 遍历 normalized safe buckets；每个安全 bucket 仅使用自身可信 utilization。
- 依据显式 normalized duration/order 形成 long→short layers；primary 不是决定 single/multi 的开关。
- 多个安全且可靠排序 bucket 全部进入多环；只有一个安全窗口则 single。
- 若部分 bucket 无可靠排序，不能把它们与已知 bucket 强排；只投影可证明顺序的安全集合，其余留在 detail，并在 tooltip/fallback 说明“另有窗口仅在详情展示”（安全固定文案）。
- remaining 仅可作为 `unknownCenterValue`、`shortValue` 或 title；不参与 percent/排序。

## Aggregate projection

```ts
export type ProviderUsageKey = "gpt" | "grok" | "kiro";
export type ProviderUsageRisk = "danger" | "warning" | "normal" | "muted";

export interface ProviderUsageAggregateProjection {
  key: ProviderUsageKey;
  label: "GPT" | "Grok" | "Kiro";
  order: number;
  risk: ProviderUsageRisk;
  loading: boolean;
  ringUnit: ProviderUsageRingUnit | null;
  fallback: string | null;
  title: string;
}
```

Projection 是 allowlist；不得出现 accountId、credential、profileArn、raw error/response。Provider panel 仍拥有 accounts/quota/cache/race/operation state；aggregate shell 只消费 presentation/detail slot。

## Aggregate hover/focus 状态机

建议显式 reducer/state refs，避免 `onMouseLeave` 与 `onBlur` 竞态：

```text
open reasons = pointerInsideTrigger || pointerInsidePanel || focusInsideTrigger || focusInsidePanel
close schedule = all reasons false → start 220ms grace timer
re-entry/focusin = cancel timer + open
Escape = cancel timer + close + set escapeSuppressed
escapeSuppressed clears on trigger blur or a new explicit pointerenter
```

细节：

- trigger `pointerenter`/`focus` 打开；不以 click toggle 为 primary。点击会自然 focus，但不要求第二次点击关闭。
- panel 与 trigger 可通过 wrapper 或 refs 组成逻辑 hover region；portal 时分别监听并共享 timer。
- `focusout` 在 microtask/下一帧检查 `document.activeElement` 是否仍在任一 ref，避免 portal `relatedTarget=null` 瞬断。
- pointerleave 只 schedule 220ms timer，不立即 close；pointerenter panel 取消 schedule。
- Escape：若 panel 内有焦点，聚焦 trigger但保持 suppression，避免 focus 事件重开；若 trigger 已有焦点，仅关闭并 suppression。外部 blur/leave 不强制还焦。
- 卸载时清 timer/listener；配置热切换后清 suppression/open state。

## 分栏面板

- 非 accordion；enabled provider cards 同时在 DOM 和可视结构中。
- Desktop grid 依据 provider 数量 1/2/3 列；中窄屏自动 2/1 列或单列纵向滚动，不隐藏 provider。
- 每列复用 provider detail body/操作，不创建嵌套 dialog 或自己的 outside handler。
- 面板非 modal，fixed + viewport clamp；trigger `aria-haspopup="dialog"`/`aria-controls`，panel 可用 `role="dialog"` 且不设 `aria-modal=true`。
- focus 不自动跳入 panel；用户 Tab 进入第一列。DOM/portal 必须保证逻辑 Tab 路径，必要时由 shell 在 trigger 后管理 focus target，不能制造 focus trap。
- 打开 Models 前关闭 aggregate；无刷新全部。

## AppShell 与数据流

```text
GET /api/web-config
  → enabled GPT/Grok/Kiro
  → providerPanelsAggregated ?
       ProviderUsageAggregatePanel(one provider owner per enabled key)
       : standalone panels(displayMode full|compact)
```

- aggregate/standalone JSX 互斥，不 CSS 隐藏。
- 保持单一 `.app-top-usage-panel`、`showAnyProviderUsage`、Session stats padding。
- aggregate shell 不 fetch provider API；accordion/column 切换不存在 remount provider owner 的路径。

## API、安全、兼容性

- 不新增 provider quota route/schema；web config 只增加 boolean。
- aggregate default false，无磁盘迁移。
- standalone 仍 click detail；仅 aggregate 采用 hover/focus 分栏。
- animation 纯展示，不参与 quota freshness、polling、account selection。
- 安全文案只使用 normalized allowlist fields。

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 多层色仍难区分 | 固定 layer token + stroke/geometry，风险作为第二通道；UI v6 视觉矩阵 |
| 流光被误认成进度增长 | mask 限定 used arc、低频低对比、不旋转弧长、reduced-motion 静止 |
| center 错层 | `centerLayerId === layers.at(-1).id` invariant + GPT/Grok/Kiro tests |
| Kiro 不安全排序 | 仅显式 normalized duration/order；不可证明的 bucket 留 detail |
| hover 面板闪退 | trigger/panel 共享 open reasons + 固定 220ms grace + re-entry cancel |
| Escape 关闭后 focus 重开 | escape suppression 生命周期写死并测试 |
| 分栏在 320px 过密 | 响应式单列滚动；UI v6 确认，不隐藏 provider |
| 双轮询 | AppShell 互斥 JSX + Network 验证 |

## 回滚

1. `providerPanelsAggregated=false` 关闭聚合路径。
2. N-ring renderer/flow overlay 可独立回滚到静态 single renderer，不迁移 quota 数据。
3. aggregate shell 可回滚为 standalone；Compact 配置值仍保留。
4. 不改 auth、quota cache、Reset/scheduler、models、session JSONL 或 ledger。