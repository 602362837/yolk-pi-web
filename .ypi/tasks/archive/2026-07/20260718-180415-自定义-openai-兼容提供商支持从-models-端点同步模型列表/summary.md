# Summary

## 交付
自定义 OpenAI 兼容提供商支持从 `/models`（及 `/v1/models` fallback）预览并确认后同步模型 ID 到 `models.json`。

## 验收
- Checker：Pass（无阻断）
- 用户手工验收：**通过**（含预览 modal 按钮样式修复后复验）
- 开发服务 `PORT=30143` 已在验收后停止释放资源

## 关键要点
- 共享 `models.json` store（revision / 锁 / 原子写）
- preview + apply API（fail-closed，仅已保存 custom OpenAI-compatible）
- 只 merge 追加 `{ id }`；不删本地、不覆盖 cost/手工字段/overrides
- Models UI discovery + 预览 modal；「全部新增并写入」仍需二次确认
- 定向测试：`test:models-config-sync` 73 passed

## 收尾备注
- 未 git commit / push / merge
- 非阻断：无完整 browser E2E / focus trap；仓库既有 lint 与本功能无关