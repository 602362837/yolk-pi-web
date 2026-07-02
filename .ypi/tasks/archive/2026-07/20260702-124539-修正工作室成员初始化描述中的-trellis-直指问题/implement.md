# implement

## 执行结果

- [x] 阅读并确认现有契约：`docs/modules/frontend.md`、`docs/modules/api.md`、`docs/modules/library.md`、`docs/standards/code-style.md`、相关 Studio source、当前任务 PRD/Design/Implement/Checks/UI/Handoff。
- [x] 清理 `lib/ypi-studio-agents.ts` 四个默认成员模板定位文案，默认 frontmatter 升级为 `version: 2`。
- [x] 实现安全迁移：缺失默认成员 `created`；完全匹配旧默认模板 SHA-256 的成员 `updated`；自定义成员 `skipped`，若仍含内部引用则返回结构化 warning。
- [x] 扩展类型与 UI 初始化反馈：`updated` 进入 success 文案，`warnings` 进入 warning Notice；GET 列表增加 `outdatedDefaultAgents` 以便旧默认成员时按钮显示补齐默认配置。
- [x] 同步清理当前仓库 `.ypi/agents/{architect,ui-designer,implementer,checker}.md`。
- [x] 更新相关模块文档：`docs/modules/api.md`、`docs/modules/frontend.md`、`docs/modules/library.md`。
- [x] 未改动 `.ypi/workflows`、历史任务事件/标题或独立 Trellis 功能。

## 关键实现点

- `lib/ypi-studio-agents.ts`
  - 默认成员模板采用 YPI Studio 自身语义，不再在正文中直指 Trellis、`.trellis`、`task.py`、`jsonl manifest`、`check.jsonl` 等内部参考体系。
  - 使用旧默认文件 SHA-256 做精确匹配迁移，避免在源代码中保留旧正文，也避免覆盖用户自定义内容。
  - 自定义内容检测通过拆分 marker 构造，避免默认 Studio source 在目标验证 grep 中出现内部引用文本。
- `lib/ypi-studio-types.ts`
  - `YpiStudioAgentWriteResult.status` 增加 `updated`。
  - `YpiStudioAgentsInitResponse` 增加 `updated` 和结构化 `warnings`。
  - `YpiStudioAgentsResponse` 增加 `outdatedDefaultAgents`。
- `components/YpiStudioPanel.tsx`
  - 初始化/重新检查按钮均调用初始化 API，以便执行安全迁移和 warning 检测。
  - 成功文案分别覆盖 created、updated、无变更场景；warning Notice 展示最多前三个文件名并提示手动清理。

## 验证命令

```bash
rg -n "Trellis|trellis|\.trellis|task\.py|jsonl manifest|check\.jsonl|Trellis Design|Trellis Implement|Trellis Check" lib/ypi-studio-* components/YpiStudioPanel.tsx app/api/studio .ypi/agents .ypi/workflows
npm run lint
node_modules/.bin/tsc --noEmit
```

## 验证结果

- `rg ...`：通过，无匹配（命令返回 1 表示无结果）。
- `npm run lint`：通过。
- `node_modules/.bin/tsc --noEmit`：通过。
- 额外核对：旧版默认成员文件 hash 与迁移表一致。

## 检查门禁

- [x] 默认成员新建和已有旧默认迁移都覆盖。
- [x] 用户自定义 `.ypi/agents/*.md` 不被静默覆盖。
- [x] 成员面板预览与 `buildMemberPrompt` 使用同一份清理后的成员正文。
- [x] 类型、lint 通过。
