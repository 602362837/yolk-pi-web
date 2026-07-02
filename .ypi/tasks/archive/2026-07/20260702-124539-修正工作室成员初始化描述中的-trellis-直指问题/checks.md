# checks

## 需求覆盖检查

- [x] `lib/ypi-studio-agents.ts` 默认成员正文不含 Trellis 直指。
- [x] 当前仓库 `.ypi/agents/*.md` 不含 Trellis 直指。
- [x] 新初始化工作室时生成的成员文件为清理版本（默认模板 `version: 2`）。
- [x] 对已有旧默认成员可安全迁移；对自定义成员不覆盖。
- [x] 工作流模板、任务模板未被不必要改动。
- [x] 独立 Trellis 产品功能仍保留。

## 自动验证

```bash
rg -n "Trellis|trellis|\.trellis|task\.py|jsonl manifest|check\.jsonl|Trellis Design|Trellis Implement|Trellis Check" lib/ypi-studio-* components/YpiStudioPanel.tsx app/api/studio .ypi/agents .ypi/workflows
npm run lint
node_modules/.bin/tsc --noEmit
```

## 自动验证结果

- `rg ...`：通过，无匹配（无输出，退出码 1）。
- `npm run lint`：通过。
- `node_modules/.bin/tsc --noEmit`：通过。

## 手工验收建议

1. 打开工作室面板 Members tab，预览四个默认成员，确认没有 Trellis 名称或路径。
2. 使用初始化/补齐默认配置入口，确认 created/updated/无变更文案可理解且不暗示覆盖自定义成员。
3. 创建一个自定义成员并写入旧内部引用后点击重新检查，确认 warning Notice 显示“已跳过覆盖”。
4. 派发成员前检查构造出的成员定义来源，确认来自清理后的 `.ypi/agents/<member>.md`。
5. 检查 `.ypi/workflows/*.json` 和现有任务列表，确认状态机与任务进度未变化。

## 回归风险

- 迁移检测故意只接受旧默认完整 SHA-256 匹配；用户改过的旧内容不会自动覆盖，只会 warning。
- 历史会话、任务标题和事件中仍可能有用户输入的 Trellis 字样，按范围约束不回写清理。
