# 计划审批书：为 xAI 增加多 API Key 管理

## 审批摘要

本计划采用最小扩展：把 provider id `xai` 纳入现有 managed-account allowlist，复用 OpenCode Go 已验证的 provider-scoped 存储、API、active mirror 和 `ApiKeyAccountsDetail`，不复制平行实现。已有 xAI 单 Key 会在首次打开账号列表时按 fingerprint 幂等导入。

## 范围

- **包含**：多 Key 新增/编辑/启停/激活/删除/reveal/copy、legacy 导入、active 镜像、测试和文档。
- **不包含**：xAI 自动 failover、额度探测、跨 provider 迁移、SDK credential schema 修改。

## 设计与执行

- 数据存储：`~/.pi/agent/auth-api-key-accounts/xai/`；metadata 不含明文，secret 保持 `0600`。
- API：沿用 `/api/auth/api-key/xai/accounts/**`，不新增 wire contract。
- UI：沿用 Settings → Models 的 managed account UI。
- 实施顺序：allowlist → 隔离测试 → API/UI 复用验证 → 文档 → lint/tsc/测试/浏览器验收。
- 回滚：移除 xAI allowlist；保留用户 account store，不自动删除数据。

## UI 原型门禁

- [HTML 原型：Settings → Models → xAI 多 API Key](ui-prototype.html)
- [UI 说明与审批问题](ui.md)

原型基于现有 `ApiKeyAccountsDetail` 与历史 OpenCode Go 多账号原型适配：展示 xAI 多账号列表、ACTIVE/Imported/DISABLED、reveal/copy、activate/edit/disable/delete、空态与 legacy 导入提示。原型中**不含** OpenCode Go auto-failover 开关或 OpenCode 专属额度文案。

> 说明：主会话已派发 UI 设计员复核；该次子会话偏离任务（误改依赖/跑 lint）已被主会话回滚 `package.json` / `package-lock.json` 并恢复 `node_modules`。当前交付以架构师产出的 HTML 原型为准，供用户审批实现基准。

## 详细材料

- [Brief](brief.md)
- [PRD](prd.md)
- [Design](design.md)
- [Implement / Implementation Plan](implement.md)
- [Checks](checks.md)

## 请用户审批

1. 是否批准“xAI 完全复用 managed accounts 通用基础设施”的方案？
2. 是否确认本轮 **不包含 xAI auto-failover**？
3. 是否批准链接 HTML 原型作为实现基准？

**请明确回复批准 / 需要修改。** 批准前不会进入 implementing，也不会改生产代码。
