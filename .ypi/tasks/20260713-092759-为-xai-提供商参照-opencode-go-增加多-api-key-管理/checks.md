# Checks：xAI 多 API Key 管理

## 需求覆盖

- [ ] `xai` 与 `opencode-go` 均为 managed provider，其他 provider 不变。
- [ ] all-providers 与 provider GET 对 xAI 返回 managed summary，且 summary 不触发 legacy import。
- [ ] 首次 accounts GET 导入 legacy xAI Key；重复调用不重复。
- [ ] create/edit/activate/enable/disable/delete/reveal 均使用通用路由并保持 provider 隔离。
- [ ] active update/activate 写回 `auth.json` 并 reload；active 删除正确回退，最后一项删除清除认证。
- [ ] Settings → Models → xAI 与已审批 HTML 原型一致，无残留 OpenCode-specific 文案。
- [ ] 本轮未增加 xAI auto-failover。

## 自动验证

```bash
npm run lint
node_modules/.bin/tsc --noEmit
# 执行实现新增的 focused api-key-accounts 测试命令
rg -n 'v1: only opencode-go|v1 only opencode-go|only `opencode-go`' lib app components docs
```

测试环境必须将 `PI_CODING_AGENT_DIR` 指向临时目录或使用等价隔离；检查结束后不得留下明文 fixture。

## 安全检查

- [ ] `accounts.json` 仅含 masked preview/fingerprint，不含 Key。
- [ ] secret 目录/文件权限保持 `0700/0600`。
- [ ] list/summary/error/toast/log 不泄露明文。
- [ ] reveal 为单账号、`Cache-Control: no-store`；前端切 provider/关闭时销毁明文状态。
- [ ] xAI 与 opencode-go 相同 fingerprint 也不得跨 provider 去重。

## 手工验收

1. 仅在 `auth.json` 配置一个 xAI Key，打开 Models → xAI，看到单个 Imported active 项。
2. 刷新/重开，账号数仍为 1。
3. 新增第二项且不激活，再激活它；新会话/后续请求使用新 active Key。
4. reveal/copy 一项，关闭并重开后默认恢复脱敏。
5. 禁用非 active 项；active 项禁用必须 replacement 或明确 clear。
6. 删除 active 项验证 fallback；删除最后一项验证 disconnected。
7. 打开 opencode-go 和一个普通 API-key provider，确认无回归。

## 重点风险

- `getAgentDir()`/AuthStorage 缓存导致测试误用真实目录。
- provider displayName 与 id 混用导致 xAI 未命中 allowlist。
- 旧注释和 UI 文案造成错误产品承诺。
- 现有 metadata 写并发与多进程 race 为既有风险，不在本轮解决。
