# Checks — IMP-001

## 自动

- 标准 envelope marker=false
- 真 secret 仍 true
- implementer_error 含 allowlisted code/stage
- binding-only ≠ Agent active
- lint/tsc + focused tests

## 30142

1. 不 kill 30141
2. pause → 单次 retry
3. PASS：child run 启动，或 typed implementerCode（禁止空壳+Internal only）
4. 立即 pause；不宣称 #22 业务完成
