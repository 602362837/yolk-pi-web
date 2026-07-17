# Design：IMP-001 组聚合 + 双独立圆环

## 1. 周期环 vs 模型组环（硬边界）

| 概念 | 语义 | UI |
| --- | --- | --- |
| **周期 N-ring** | 同一资源的不同 reset 窗口（5h / 7d…） | **同一** `ProviderUsageRingUnit` 的 outer→inner layers |
| **模型组环** | 不同模型家族额度 | **多个独立** ring（并排），每个组 0..1 个 unit（或未来组内再 N-ring） |

用户反馈已确认：把 Flash/Opus 画成内外环是错误隐喻。

```text
正确：  (Flash)   (Opus)     ← two independent single-layer rings
错误：  ◎Flash      ← concentric layers of ONE unit
         ○Opus
```

## 2. 数据流

```text
AntigravityQuotaResultV1.models[]  (flat wire, unchanged)
        │
        ▼
 groupByQuotaKey + conservative aggregate
        │
        ├─► ringSlots: RingSlot[]  // 0..N independent units for priority groups
        └─► grouped accordion rows
```

## 3. 固定 group 映射

与前版相同，优先组：

| order | groupId | 顶栏 |
| ---: | --- | --- |
| 0 | `gemini-3-flash` | 独立环 slot 0 |
| 1 | `claude-opus` | 独立环 slot 1 |
| 2+ | sonnet / pro / 2.5 / other | 仅详情 |

quotaKey→group 表（0.3.0）见实现常量；每个 key 唯一归属一组。

### 聚合

- `usedPercent = max(variants)`
- `remainingFraction = min(variants)`
- `resetsAt` = 最早可解析 ISO（display only）
- 禁止 avg/sum；禁止用 reset 当 duration

## 4. 顶栏投影 API

### 4.1 新结果形状（示意）

```ts
interface AntigravityRingSlot {
  groupId: "gemini-3-flash" | "claude-opus";
  label: string;           // "Flash" / "Opus"
  ringUnit: ProviderUsageRingUnit; // typically 1 layer
}

interface AntigravityRingProjectionResult {
  /** Independent rings for priority groups with data; order Flash then Opus. */
  ringSlots: AntigravityRingSlot[];
  /**
   * @deprecated for multi-group — do not pack Flash/Opus into one unit.
   * May hold a single slot's unit when only one priority group exists and
   * legacy callers need one unit; prefer ringSlots.
   */
  ringUnit: ProviderUsageRingUnit | null;
  mode: "dual-independent" | "single" | "detail-only" | "empty";
  detailOnlyModelIds: string[];
  detailNote: string | null;
  safeModelCount: number;
}
```

### 4.2 构造规则

对每个优先组 `present`：

```ts
createProviderUsageRingUnit({
  layers: [{
    id: `antigravity-group-${groupId}`,
    shortLabel: group.shortLabel, // Flash / Opus
    fullLabel: group.label,
    percent: group.usedPercent,
    title: `${group.label}（保守）已使用 ${pct} · 剩余 ${rem}`,
  }],
})
```

- **绝不** `layers: [flashLayer, opusLayer]`。
- 两个 present → `ringSlots.length === 2`，`mode: "dual-independent"`。
- 一个 present → `ringSlots.length === 1`。
- 零优先组 → `ringSlots=[]`，若其他组有数据则 detail-only fallback「多模型」。

### 4.3 Aggregate projection

`ProviderUsageAggregateProjection` 今日只有单个 `ringUnit`。本改进二选一（实现优先 A，若过宽则 B）：

**A（推荐）**：扩展 allowlisted projection 为可选 `ringUnits?: ProviderUsageRingUnit[]`（或 `ringSlots`），Aggregate trigger/列头 **并排**渲染多个 small rings；shell 仍不解析 schema。

**B**：Aggregate 列头只显示 **一个**「摘要环」（取两优先组中 **更紧** 的 conservative used = max(used) 作为 single layer），完整双独立环放在列内 detail；standalone Full 仍并排双环。

**默认选 A**；若布局/a11y 阻塞，plan 允许降级 B，但 standalone 必须双独立环。

### 4.4 Trigger UI

`ProviderUsageTrigger` 今日主路径是单个 `ringUnit`。

实现：

- 新增可选 `ringUnits?: ProviderUsageRingUnit[]`（或 `ringSlots`）。
- 当 `ringUnits?.length > 1`：按序并排 `ProviderUsageRingUnitView`，每环可带 mini label（Flash/Opus）。
- 兼容：仅 `ringUnit` 时行为不变。
- Compact：并排 small rings；空间不足时允许两环缩小间距，**禁止**合并为 concentric。

### 4.5 降级矩阵

| 条件 | 呈现 |
| --- | --- |
| loading | 无环 / spinner |
| no account | 登录 |
| reauth 无 models | 需登录 |
| Flash+Opus | **两独立环** |
| 仅 Flash 或仅 Opus | 一独立环 |
| 仅其他组 | 无环 + 多模型 |
| stale + 有组 | 环保留 + 警告 |
| switching | 保持上一安全投影 |

## 5. 详情 UI

- 固定组序 accordion；默认折叠。
- 组头：保守 used%；tooltip「组内变体取最紧额度」。
- 展开：变体列表；无 per-variant 刷新。
- Models `AntigravityQuotaView` 同源。

## 6. Failover

- **不改** `lib/antigravity-account-failover.ts` 候选语义。
- 测试锁死：mock 组内另一变体有额度、当前 model key 为 0 → 不激活切换。

## 7. 文件边界

| 文件 | 职责 |
| --- | --- |
| `lib/antigravity-quota-groups.ts` | 映射 + 聚合 pure |
| `lib/antigravity-usage-ring.ts` | ringSlots 投影 + aggregate |
| `components/ProviderUsagePanelContract.ts` | 可选 multi-unit projection 字段（若走 A） |
| `components/ProviderUsageTrigger.tsx` | 并排 multi ringUnits |
| `components/ProviderUsageAggregatePanel.tsx` | 列头/trigger 渲染 multi |
| `components/AntigravityUsagePanel.tsx` | 接 ringSlots + accordion |
| `components/AntigravityQuotaView.tsx` | Models 分组 |
| 测试 scripts | groups / multi-ring / 禁止 concentric 混组 |

## 8. 回滚

- 去掉 ringSlots multi 渲染；恢复 multi-model detail-only。
- 保留 group helpers 无害。
- 不删账号/cache。
