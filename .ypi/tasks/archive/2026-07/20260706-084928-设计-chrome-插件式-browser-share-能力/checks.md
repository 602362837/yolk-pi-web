# checks

## 设计验收

- 插件方案是 Chrome Extension + 本地 bridge，不依赖 CDP/debugger 启动 Chrome。
- 插件项目不进入 ypi web npm/Next build。
- 多 session 防误绑定通过分享码完成：插件生成码，目标 chat 填码。
- agent 工具只能访问当前 session 绑定的 share。
- 默认只读；高风险操作需要确认。

## 自动验证

主项目：

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

插件项目：

```bash
cd ../ypi-browser-share-extension
npm run build
```

若插件 MVP 无构建脚本，至少执行 manifest 校验和 TypeScript/ESLint 等价检查。

## 手工验收场景

1. 启动 ypi web，打开两个不同 chat/session。
2. Chrome 插件分享当前页面，得到分享码 A。
3. 在 session 1 输入分享码 A，确认绑定成功。
4. session 2 不应看到该页面，也不能通过 agent 工具读取。
5. 再次使用分享码 A 应失败。
6. 在 session 1 调用只读快照，能返回 URL/title/可见文本摘要。
7. 页面有 password 输入时，快照不得包含 password value。
8. agent 请求点击/输入时，UI 显示确认；拒绝后插件不执行。
9. 解绑后，agent 工具返回“未绑定浏览器分享”。

## 风险检查

- 分享码过期、单次使用、随机性。
- 页面快照长度限制。
- 敏感字段过滤。
- command 权限检查。
- sessionId 绑定不可由工具参数伪造。
- 插件端断连/刷新/导航后的状态恢复。
