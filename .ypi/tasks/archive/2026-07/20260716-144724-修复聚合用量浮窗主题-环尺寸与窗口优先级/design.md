# Design：聚合用量浮窗主题、环尺寸与动态窗口优先级

## 方案摘要

引入共享的 safe window candidate → ring projection 纯函数契约。GPT/Grok/Kiro 只从当前账号实际返回的数据生成候选，不再 push 固定 layer 顺序；公共 projector 负责过滤、duration 解析/校验、短→长排序、unknown/tie 降级、layer identity 和 center。主题与尺寸修复保持原方案：全局 light/dark semantic tokens，trigger 30px，panel header 目标 40px（最低 38px）。

## 影响模块与边界

| 模块 | 变更 | 不变边界 |
| --- | --- | --- |
| `components/ProviderUsagePanelContract.ts` | 增加候选/投影结果、共享 duration resolver 与 projector；重申 outer/center invariant | percent clamp、tone、projection allowlist、220ms grace |
| `components/ProviderUsageTrigger.tsx` | 通过 `centerLayerId` 找中心；支持 ring null/fallback 与高对比中心 | 无 fetch/owner；SVG mask/流光和 ring geometry |
| GPT adapter | 遍历实际 tiers 生成候选，不合成固定 5h+7d，不排序 | quota/cache/reset/scheduler/race |
| Grok adapter | 仅把实际存在的 typed windows 归一成候选，不决定周/月径向位置 | reauth/cache/activate/race |
| Kiro adapter | 复用共享 duration resolver/projector，删除 `Limits=90d` | remaining 仍非 percent；安全 bucket 过滤 |
| `components/ProviderUsageAggregatePanel.tsx` | 主题 token、detail-only/fallback 布局、panel 大环 | hover/focus、220ms、Escape、无 fetch/总环 |
| `app/globals.css` | light/dark usage surface/text/status tokens 与响应式 | 主题真源仍为 `:root` / `html.dark` |
| tests/docs | 动态、乱序、单窗、unknown/tie、主题/尺寸契约 | 既有安全与单实例断言 |

## 数据与接口契约

### 候选数据

```ts
interface ProviderUsageWindowCandidate {
  id: string;
  shortLabel: string;
  fullLabel: string;
  percent: number | null;
  title: string;
  present: boolean;       // 实际数据存在；不允许合成窗口
  trusted: boolean;       // allowlist/数值边界已通过
  durationMs: number | null;
  durationEvidence?: string; // 安全规范 token，永不直接渲染
  unknownCenterValue?: string | null; // 仅同 bucket
}
```

字段名可按现有风格微调，但语义不可弱化。provider adapter 可以从 typed upstream 字段识别实际窗口并提供规范 token；不得传预排序 layer index。共享 resolver 将显式数值或规范 token/label转换为排序 rank。月/年 rank 仅用于顺序，不作为账单精确时长展示。

### 公共 projector

```text
actual allowlisted quota windows
  → provider adapter: unordered candidates
  → shared projector:
      filter present/trusted/valid display fields
      normalize explicit duration evidence
      single safe candidate → one ring (duration may be unknown)
      multi candidate → remove unknown/tied ranks from radial layout
      sort remaining unique ranks ascending
      0 projected → ring null + detail-only fallback
      1 projected → one ring
      N projected → outer shortest ... inner longest
  → centerLayerId = layers[0].id
  → aggregate shell/detail slot
```

返回值建议包含：

- `ringUnit: ProviderUsageRingUnit | null`
- `detailOnlyCandidateIds: string[]`
- `detailNote: string | null`
- `mode: empty | single | ordered-multi | degraded-single | detail-only`

### duration 信任规则

允许：

- upstream 显式正 duration；
- 共享 resolver 可识别的规范 token/label，如 `90m`、`2h`、`seven_day`、`weekly`、`monthly`。

禁止：

- provider 名或“GPT 通常有 5h”；
- adapter push 顺序、字段声明顺序、数组 index、id lexical order；
- percent、remaining、resetAt 距现在的差值、resourceType；
- `Limits`、`quota envelope`、`subscription limit` 等无周期词文案。

同 rank 多窗口视为径向顺序冲突：冲突组留在详情，不以 id 决胜。这样 projector 对输入 permutation 稳定。

### 单窗与 unknown 降级

- **only-7d / only-week：** 实际只有一个候选，直接单圈，中心为该候选。
- **single unknown-duration：** 仍可单圈，因为没有顺序比较。
- **known + unknown：** known unique ranks 排圈；unknown 详情。若只剩一个 known，则 degraded-single。
- **all unknown multi：** ring null + 安全 fallback，所有候选在详情；不指定中心。
- **outer percent unknown：** 保持外圈与 label，中心 `—` 或同 bucket fallback，不跨层借值。

## Provider 适配边界

- GPT：从当前 display/source tiers 数组逐项生成候选；只有实际返回的 tier 才存在。已有 canonical tier 名可作为 duration evidence，但 builder 不再拥有 `[5h,7d]` 分支或固定顺序。
- Grok：weekly/monthly 等 optional typed 字段只在对象存在时变成候选；字段名可转成共享规范 period token，但 adapter 不排序、不设 center。
- Kiro：安全 bucket 逐项生成候选；label 中明确数值+单位或周期词交给共享 resolver。删除 `Limits=90d`，remaining/reset/resourceType 不用于 duration。

## Theme 与响应式

- `:root` / `html.dark` 定义 usage panel surface/elevated/subtle、border、shadow、center text/value、success/warning/danger text/background/border。
- 状态弧色与正文/小字语义色分离，避免浅色 warning/danger 低对比。
- aggregate trigger 30px；column header 40px target / ≥38px。
- Desktop 1–3 列；`≤640px` 两列；`≤420px` 单列；panel `calc(100vw - 16px)` clamp、内部 scroll、ring `flex-shrink:0`。

## 兼容性、迁移与回滚

- 无 API/config/storage/JSONL 迁移。
- `ProviderUsageRingUnit` 为项目内契约；构造器、renderer、所有 adapter、测试和 docs 必须原子更新，避免 provider 预排序与公共排序并存。
- standalone 与 aggregate 共用 primitive；center 新口径同步生效，standalone click 不变。
- 回滚代码即可；运行时止血仍可设置 `usage.providerPanelsAggregated=false`，不删除账号或 quota cache。

## 风险与缓解

1. **“动态”仅换成另一组硬编码**：测试直接向共享 projector 注入跨 provider、乱序、only-one、future period 候选。
2. **duration parser 误命中泛化文本**：使用边界严格的 token/单位解析，负例覆盖 `Limits/quota/reset/remaining`。
3. **同 duration 通过 id 偷排**：冲突组详情化并做 permutation 测试。
4. **unknown 多窗口任意挑中心**：all-unknown multi 必须 ring null；只有单候选才允许 unknown 单圈。
5. **中心跨层借值**：renderer 按 id；outer unknown 用例禁止读取内圈。
6. **主题/大环回归**：light/dark + Desktop/640/375/320 + fallback/detail-only/长账号人工矩阵。
7. **破坏 owner 交互**：公共 projector 保持纯函数，aggregate shell 无 fetch，既有 race/security 测试不删。
