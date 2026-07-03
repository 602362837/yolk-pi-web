# Checks

## 需求覆盖检查

- [ ] Studio 策略优先级实现并在代码中集中：`toolInput > memberConfig > defaultPolicy > followMain > piDefault`。
- [ ] `member` id canonicalize，`Architect` 不会绕过 `architect` 配置。
- [ ] 非法 `toolInput.model/thinking` 不再 silent fallback，有 warning。
- [ ] `followMain` 解析失败时显示 warning 并最终 fallback 到 Pi default。
- [ ] final result、progress update、task subagent run 均包含 policy diagnostics。
- [ ] `YpiStudioSubagentTranscript` 默认折叠，展开默认 compact，不直接展示全部 transcript。
- [ ] Debug/raw 二级开关可显示 prompt/status/stderr/raw JSON。
- [ ] runChildPi progress 能区分 starting、waiting_model、streaming、running_tool、waiting_for_user、finished。
- [ ] Header / widget 显示 tokens 与 t/s；无 token 时优雅隐藏。

## 自动质量检查

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

当前仓库没有专门自动测试套件；如实现新增 test script，需同步 `docs/standards/code-style.md` 与 `package.json`。

## 手工验收重点

- Settings 中分别配置 default/member specific/followMain/piDefault/unset，执行真实 `ypi_studio_subagent` 验证 child CLI 行为与 UI source 一致。
- 主会话模型存在时 `followMain` 使用主模型；不存在时 warning + Pi default。
- 工具输入显式 model/thinking 覆盖 Settings，并且 UI 一眼可见。
- 长 transcript 不刷屏：默认 header + compact summary；debug/raw 才显示完整细节。
- running 中 phase/tps 实时更新且不会造成 Chat 抖动或高频重渲染。
- waiting_for_user 的 child UI request 高亮并能在 final output 中看到用户需要处理的信息。

## 回归风险

- `tool_execution_update` payload shape 变化可能影响 `ChatWindow` live overlay 和 `YpiStudioSessionWidget`，新增字段必须 optional。
- transcript compact 去重可能误隐藏重要 assistant 内容；错误和 warning 不得被隐藏。
- token/tps 估算基于字符数，不能作为 billing usage；UI title 应标注 estimated。
- policy diagnostics 不应包含完整 prompt 或敏感 config 内容。
- 旧 task/transcript 缺少新字段时必须 fallback 到现有 status/summary 渲染。

## 评审问题

- 是否接受新增 `lib/ypi-studio-policy.ts` 作为 pure resolver。
- 是否本次引入轻量 test script；若不引入，按现有项目规范使用 lint/tsc + 手工场景。
- defaultPolicy 的 `unset` 是否继续保留；推荐保留并明确 fallback 文案。
