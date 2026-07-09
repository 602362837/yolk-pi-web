# checks

## 需求覆盖检查

### 产品能力覆盖

- [ ] `opencode-go` 能保存多条 API Key 账号记录；
- [ ] 每条记录包含显示名、描述、脱敏 key、创建/更新时间、active 状态；
- [ ] 同一 provider 同时最多一个 active；
- [ ] 新增账号可选择立即激活；
- [ ] 激活指定账号后，运行时实际使用的 key 会切换；
- [ ] 删除 non-active 账号不影响当前 active；
- [ ] 删除 active 账号时，若仍有剩余账号会自动切换 fallback；
- [ ] 删除最后一条账号后 provider 回到未配置状态；
- [ ] 旧单 key 用户首次进入管理页时能看到导入的账号记录；
- [ ] `opencode` 不受影响，账号池与 `opencode-go` 独立。

### 回显能力覆盖

- [ ] 默认列表不显示明文，只显示脱敏预览；
- [ ] 用户必须对单条记录显式 reveal，前端才拿到明文；
- [ ] 用户必须显式点击 copy 才会触发复制；
- [ ] reveal / copy 失败时错误文本不包含 secret；
- [ ] 关闭弹窗、切换 provider、刷新页面后不会保留此前 reveal 的明文状态。

### API 覆盖

- [ ] `/api/auth/all-providers` 能告诉前端 `opencode-go` 进入 managed accounts 模式；
- [ ] `/api/auth/api-key/[provider]` summary 仍可工作；
- [ ] 新增 list/create/update/delete/activate/reveal 路由；
- [ ] 列表类接口不返回明文；
- [ ] reveal 只返回单条记录明文；
- [ ] legacy 单 key POST 兼容语义不被破坏；
- [ ] managed 模式下旧 DELETE 不会误删全部账号。

## 质量检查

### 安全边界

- [ ] 元数据文件不保存明文 key；
- [ ] per-account secret 文件权限为 `0600`，目录为 `0700`；
- [ ] 列表、summary、provider list、toast、日志、错误消息均不输出明文 key；
- [ ] reveal 响应设置 `Cache-Control: no-store`；
- [ ] 前端不会把明文写入 URL、localStorage、query 参数、analytics payload 或 console；
- [ ] `keyFingerprint` 仅用于幂等与匹配，不作为明文替代显示。

### 运行时一致性

- [ ] 激活 / 删除 / 替换 active key 后，`auth.json` 中 `opencode-go` credential 已同步；
- [ ] 同步后调用 `reloadRpcAuthState()`；
- [ ] live wrapper 与新会话后续读取的都是新 active key；
- [ ] metadata 的 `activeAccountId` 与 `auth.json` active mirror 不会分裂。

### 兼容性

- [ ] 旧单 key 升级后无需手工迁移即可继续使用；
- [ ] 回滚到旧版本后，仍可使用 `auth.json` 中当前 active key；
- [ ] 非 `opencode-go` API-key provider 仍使用原有单 key 模式；
- [ ] OAuth 账号链路不受影响。

## 回归风险

### 高风险点

1. **reveal 泄漏**
   - 把明文带入列表接口、错误 toast、开发日志，是本任务最高风险。
2. **legacy import 重复导入**
   - 若不做 `keyFingerprint` 幂等匹配，用户第一次打开管理页可能出现重复账号。
3. **active 删除语义错误**
   - 若删除 active 后既未清空也未正确切 fallback，会导致 UI 与运行时不一致。
4. **旧 DELETE 误伤**
   - 若把旧 `/api/auth/api-key/[provider] DELETE` 直接映射成“清空所有 managed 账号”，风险过高。
5. **误扩到全部 API-key providers**
   - 若前端仅靠 `provider.id === "opencode-go"` 硬编码，但后端 summary 未给出明确模式标记，后续扩展会脆弱。

### 缓解要求

- [ ] 为 managed accounts provider 明确返回 `authMode`；
- [ ] reveal 逻辑与列表逻辑使用不同接口；
- [ ] legacy import helper 做幂等；
- [ ] 删除 active 的 fallback 逻辑写成独立 helper；
- [ ] 旧 DELETE 在 managed 模式下返回受控错误而不是隐式全删。

## 手工验收

### A. 旧用户升级路径

1. 准备仅有 `auth.json -> opencode-go` 单 key 的环境；
2. 打开 `ModelsConfig`；
3. 进入 `opencode-go`；
4. 确认页面显示一条已导入账号，且为 active；
5. 不做任何保存，直接发起一次实际 `opencode-go` 请求，确认仍可工作。

验收：旧用户零手工迁移可继续使用。

### B. 多账号新增与激活

1. 新增第二条 key，命名为“备用账号”；
2. 保持主账号 active；
3. 点击激活备用账号；
4. 检查 UI active badge 切换；
5. 检查 `auth.json` 中 `opencode-go` credential 已切换；
6. 发起一次实际调用，确认使用新 active key。

验收：切换立刻生效，UI 与运行时一致。

### C. reveal 与 copy

1. 在列表默认状态确认只看到脱敏预览；
2. 点击某一条的 reveal；
3. 确认仅该条出现明文；
4. 点击 copy，确认成功复制；
5. 关闭弹窗重新打开，确认明文不再保留。

验收：默认无明文、显式动作才能拿到明文、关闭后不残留。

### D. 删除 active 的 fallback

1. 当前有至少两条账号；
2. 删除当前 active；
3. 确认系统自动激活另一条剩余账号；
4. 检查 `auth.json` 已切到 fallback；
5. 再删除最后一条，确认 provider 回到未配置状态。

验收：不会出现“仍有账号但 active 悬空”的状态。

### E. 非目标 provider 回归

1. 打开 `deepseek` / `openrouter` 等其它 API-key provider；
2. 确认仍是当前单输入框 `Save / Disconnect` 模式；
3. 原有保存、删除流程仍正常。

验收：v1 范围控制在 `opencode-go`。

## 自动验证

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

如实现补了轻量脚本，也可追加：

- legacy import 幂等检查；
- metadata / active mirror 一致性检查；
- reveal 响应 no-store 断言。

## 本阶段结论

本任务在进入实现前仍有一个硬门禁：**UI 设计员 HTML 原型 + 用户审批**。

因此检查结论应分两层：

1. **规划层通过条件**：PRD / Design / Implement / Checks 完整，且主会话批准方案方向；
2. **实现层开工条件**：UI 原型补齐并获批。