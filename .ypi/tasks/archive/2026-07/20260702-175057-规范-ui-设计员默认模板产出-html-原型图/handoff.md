# Handoff

## Artifacts Produced

- `prd.md` — 明确目标、范围、验收标准和未决格式问题。
- `design.md` — 设计默认模板更新、精确哈希迁移和非覆盖边界。
- `implement.md` — 给实现员的文件阅读顺序、改动步骤、推荐文案要点和验证命令。
- `checks.md` — 给检查员的需求覆盖、质量、自动验证和手工验收清单。

## Files Read

- `brief.md`
- `lib/ypi-studio-agents.ts`
- `.ypi/agents/ui-designer.md`
- `app/api/studio/agents/route.ts`
- `lib/ypi-studio-types.ts`
- `lib/ypi-studio-workflows.ts`
- `docs/modules/library.md`
- `docs/modules/api.md`
- `docs/modules/frontend.md`
- `docs/standards/code-style.md`

## Validation Run

- 仅做设计与静态阅读；未运行 `npm run lint` 或 `tsc`。
- 已计算当前 `.ypi/agents/ui-designer.md` 哈希：`e8957ea09b0b276701a70fcd243a759f9d51c8c1957dc00836bbad454637880d`。

## Key Recommendations

- 更新 `ui-designer` 默认模板，要求必须输出 HTML 格式原型图；Markdown 只能作为说明，不能替代 HTML 原型。
- 模板需明确：HTML 原型必须先上报主会话/用户审阅并获得确认，确认前不进入实现。
- 迁移逻辑建议支持每个默认成员多个旧默认哈希；为 `ui-designer.md` 保留既有 `d728c01f...`，并新增当前默认 `e8957ea...`。
- 当前仓库 `.ypi/agents/ui-designer.md` 看起来是默认模板，可由实现员同步更新；若实现时已被用户改动，则不要覆盖。

## Remaining Risks / Decisions

- 待主会话确认：HTML 原型是否必须是独立 `.html` 文件。建议本任务不强制，允许 fenced `html` 代码块或明确文件路径，避免扩大到新 artifact 类型。
- 检查员需重点确认不会通过 frontmatter/version/片段匹配误覆盖自定义成员模板。
