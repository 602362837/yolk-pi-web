# Checks — 验收与质量检查清单

## 需求覆盖检查

- [ ] 四个默认成员 architect / ui-designer / implementer / checker 都能独立保存 model policy 与 thinking。
- [ ] 未配置时默认兼容旧行为，不要求用户必须设置 Studio 配置。
- [ ] `ypi_studio_subagent` 工具入参 `model` / `thinking` 优先于 Settings。
- [ ] child Pi 实际启动参数与展示元数据一致。
- [ ] 主 Chat 运行中和完成后均显示实际 model / thinking。
- [ ] task.json subagent run 记录实际 model / thinking，历史记录缺字段仍可读取。
- [ ] YPI Studio child member 不再注入 Trellis workflow-state / SessionStart 规则。

## 自动验证

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

可选定点静态检查：

```bash
rg -n "studio" lib/pi-web-config.ts components/SettingsConfig.tsx app/api/web-config/route.ts
rg -n "modelSource|thinkingSource|TRELLIS_SUBAGENT_CHILD|resolveStudioMemberPolicy" lib/ypi-studio-extension.ts lib/ypi-studio-types.ts lib/ypi-studio-tasks.ts components/YpiStudioSubagentTranscript.tsx
```

## 手工验收

1. 打开 Settings，确认存在 Studio section，四成员均可选择模型和 thinking。
2. 设置 architect 为指定模型 + high，保存并重新打开 Settings，确认值保留。
3. 通过 `/studio-continue` 或当前任务派发 architect，工具入参不带 model/thinking。
4. 观察主 Chat `ypi_studio_subagent`：折叠头、展开 Meta、运行中 progress 均展示指定模型和 high。
5. 查看 `.ypi/tasks/<task>/task.json`，最新 subagent run 记录展示同样的 model/thinking。
6. 展开 child transcript，确认没有 Trellis workflow-state、`Active task: ... task.py current` 等 Trellis 强制上下文。
7. 再派发一次并显式传入不同 model/thinking，确认工具入参覆盖成员配置。
8. 将配置恢复为 followMain/inherit，确认主会话模型 / thinking 可被解析；解析不到时展示 Pi default/default，不失败。

## 回归风险

- Settings 保存 patch 漏掉 `studio` 导致保存失败或覆盖其他 section。
- `buildPiArgs` 改造影响显式 `model:thinking` shorthand；需要保留或明确转为 `--model` + `--thinking`。
- `followMain` 依赖 `ctx.model` / `pi.getThinkingLevel` 可用性；不可用时不能误显示具体模型。
- `TRELLIS_SUBAGENT_CHILD=1` 只应影响 YPI child 进程，不应设置到主 Web server 进程环境。
- `YpiStudioSubagentTranscript` 合并 input/progress/final 时，progress/final 应覆盖 input，否则运行中显示会过期。

## 检查员重点

- 对照 `lib/pi-web-config.ts` 的 normalize 与 validate 是否都覆盖 `studio`。
- 对照 `app/api/web-config/route.ts` 的 body 类型与 config patch 是否同步。
- 对照 `lib/ypi-studio-extension.ts` 确认记录、progress、final details 使用同一个 resolved policy。
- 对照 `components/SettingsConfig.tsx` 确认 dirty 判断、保存、取消关闭、模型列表加载都正常。
- 对照 `components/YpiStudioSubagentTranscript.tsx` 确认历史缺字段不崩溃。
