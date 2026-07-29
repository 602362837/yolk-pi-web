# Handoff — catalog failure is non-2xx (last-good safe)

## Status

- **Subtask:** checker blocking item — soft-fail `200` empty catalog
- **Outcome:** `GET /api/models` catalog-service 异常改为固定 **500** `model_catalog_unavailable`；客户端保留 last-good；补失败/恢复与 soft-200 护栏测试
- **未** `commit` / `push` / `merge`

## Files Changed

| Path | Summary |
| --- | --- |
| `app/api/models/route.ts` | catch 不再返回 200 空 catalog；改为 500 `{ error, code: "model_catalog_unavailable" }` + `Cache-Control: no-store` |
| `scripts/test-model-catalog-client.mjs` | 500 保留 last-good；recovery 恢复 ready；soft 200 empty 会覆盖 last-good 的护栏断言 |
| `scripts/test-model-catalog-races.mjs` | 路由级：失败 500 / 恢复 200 wire / 非法 cwd 仍 400 |
| `docs/modules/api.md` | 文档对齐非 2xx 失败语义 |

## Behavior

- 成功响应 wire 不变：`models` / `modelList` / `defaultModel` / `thinkingLevels` / `thinkingLevelMaps`
- catalog build 失败：**非 2xx**，body 不含假成功 catalog 字段
- `useModelCatalog` 对 `!res.ok` 走 error 分支，**保留** `data` last-good
- 非法/不存在 `cwd` 仍 **400**（先于 catalog 构建）
- 不新增 UI；Settings 既有 `modelsError` 文案可显示 `model_catalog_unavailable`

## Verification

```text
npm run test:model-catalog-client
npm run test:model-catalog-races
node_modules/.bin/tsc --noEmit
```

## Remaining risks

1. 首次冷失败（无 last-good）时 Chat 仍静默空列表 + Settings 显示错误码字符串；P0 不新增 Retry UI
2. 真成功但模型数为 0 的合法空目录仍是 200（与失败路径区分正确）
3. 未跑 30142 真服务 / 真实凭据 UAT / UI waterfall
4. 进程级 epoch 宽失效所有 agentDir slot（既有设计）

## Decisions needed from main session

1. 是否送 checker 复检本阻塞项
2. commit/PR 由主会话负责（本成员不 commit）
