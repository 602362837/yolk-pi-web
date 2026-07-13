# Summary：为 xAI 提供商参照 OpenCode Go 增加多 API Key 管理

## 结果

已完成并经用户验收通过。`xai` 与 `opencode-go` 同为 managed API-key 提供商，复用现有账号池/API/`ApiKeyAccountsDetail`，无平行实现，无 xAI auto-failover。

## 变更要点

- `lib/api-key-accounts.ts`：`MANAGED_ACCOUNT_PROVIDERS` 增加 `xai`
- 测试：`lib/api-key-accounts.test.ts` + `npm run test:api-key-accounts`（12/12）
- UI：去掉 OpenCode 专属 failover 文案；provider 切换清空 reveal/edit
- 文档：library/api/frontend/operations/deployment 同步 managed providers 列表

## 验证

- lint / tsc / focused tests PASS
- Checker Pass
- 用户在 http://localhost:30142 验收通过

## 存储

- `~/.pi/agent/auth-api-key-accounts/xai/`
- active key 镜像至 `auth.json`
