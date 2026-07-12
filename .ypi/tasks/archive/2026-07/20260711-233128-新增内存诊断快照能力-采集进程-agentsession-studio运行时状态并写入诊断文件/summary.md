# Summary

## 完成内容

新增只读内存诊断快照能力：

1. **Runtime projections**：各 owner 模块有界只读投影（AgentSession / Studio / path cache / Browser Share / Terminal / file-change）。
2. **Collector + API**：`lib/memory-diagnostics.ts` + `POST /api/diagnostics/memory-snapshot`，schema v1、5s deadline、5 MiB fallback、进程内单飞、原子写 `~/.pi/agent/diagnostics/`。
3. **Settings UI**：Settings → 诊断 →「生成内存诊断快照」，五态反馈 + 隐私 callout + 路径复制。
4. **文档与测试**：API/library/frontend/architecture/operations/AGENTS 更新；`npm run test:memory-diagnostics`。

## 检查结论

Checker **Pass**。修复 2 个低风险问题：

- content-block 上限改为 per-message
- Settings 连续触发 response race

## 验证

- `npm run test:memory-diagnostics` 通过
- `npm run lint` 通过
- `tsc --noEmit` 通过

## 用户操作

请用**本 worktree** 重启 `npm run dev` 后：

1. Settings → 诊断 → 生成内存诊断快照  
2. 或 `curl -X POST http://localhost:30141/api/diagnostics/memory-snapshot`

旧 dev server 不会注册新 route（会 404）。

## 隐私

诊断文件含本机 workspace/session 路径，不自动上传；分享前请人工审阅。