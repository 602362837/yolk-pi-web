# summary

**状态：用户验收通过（2026-07-14）**

## 交付

1. 停止 cache-write 新采集/展示（历史账本不改写）
2. Token 展示：精确整数 + 派生 M
3. 模型价格配置页：手动填写 + 智能建议（确认后写入 `models.json`）
4. IMP-001：第三方模型名识别与智能查价（已 accepted）

## 关键文件（核心）

- `lib/model-price-identity.ts` — 模型身份标准化
- `lib/model-price-sources.ts` / `model-price-config.ts` / `model-price-types.ts` / `model-price-assistant.ts`
- `app/api/model-prices/**`
- `components/ModelPricesConfig.tsx`
- `lib/token-format.ts` + Usage 相关展示去 cache-write
- `scripts/test-model-prices.mjs`（45 passed）

## 验证

- `npm run test:model-prices`：45 passed
- 第三方智能填价实测：cpa/any/AITOB 别名可匹配
- 用户最终验收：通过
