# review

## Checker verdict

通过。未发现阻塞问题。

## 覆盖确认

- 项目选择：`Choose project folder`/手动 path 添加已统一走添加语义；`created:false` 不再切换当前项目。
- Studio 门禁：架构师、checker、workflow/runtime prompt、本仓库 `.ypi` 配置均加入 UI designer HTML 原型与用户审批要求。
- Tab 标题：项目上下文优先按 `projectId/spaceId`，再归一化路径匹配，减少回退到 `pi-agent-web`。
- 模型搜索：`/api/models` 暴露 `providerDisplayName`，聊天与设置模型下拉均纳入 provider id/display name 搜索。

## 验证

- `npm run lint` passed
- `node_modules/.bin/tsc --noEmit` passed
- `npm run test:studio-dag` passed

## 非阻塞建议

建议在浏览器里补一轮 UI smoke test：重复添加项目提示、linked session 标题、provider display name 搜索。