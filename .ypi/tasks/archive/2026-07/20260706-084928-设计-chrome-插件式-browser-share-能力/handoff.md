# handoff

## 实现状态

已实现 Browser Share MVP：

- ypi web 本地 bridge API：`app/api/browser-share/**`
- in-memory manager/types：`lib/browser-share-types.ts`、`lib/browser-share-manager.ts`
- agent 工具扩展：`lib/browser-share-extension.ts`，并接入 `lib/rpc-manager.ts`
- ChatInput 绑定 UI：`components/BrowserShareControl.tsx` + `components/ChatInput.tsx`
- 工具 preset 纳入 Browser Share 只读/操作工具：`components/ToolPanel.tsx`
- 独立 Chrome MV3 插件项目：`~/gitProjects/ypi-browser-share-extension`
- 文档：`docs/architecture/browser-share.md`、`docs/modules/api.md`、`docs/modules/frontend.md`、`docs/modules/library.md`、`AGENTS.md`

## 关键行为

- 插件点击“分享当前页”后创建 share code。
- 用户必须在目标 ypi chat/session 的 Browser Share 控件中输入 share code 才会绑定，避免多 session 误分享。
- agent 工具仅从当前 pi session 上下文推导绑定，不接收任意 shareId。
- 默认 readonly；写/导航/高风险命令进入 pending approval。
- UI 可允许一次/拒绝 pending command；插件刷新/轮询后执行 queued command 并回传结果。
- 插件快照过滤敏感字段并限制长度；不读取 cookie/localStorage。

## 验证

已执行：

```bash
cd ~/gitProjects/ypi-browser-share-extension
npm run build
```

结果：通过。

未执行：

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

原因：当前工作区缺少 `node_modules`，`eslint` 与 `tsc` 不存在。需要先 `npm install` 后再验证。
