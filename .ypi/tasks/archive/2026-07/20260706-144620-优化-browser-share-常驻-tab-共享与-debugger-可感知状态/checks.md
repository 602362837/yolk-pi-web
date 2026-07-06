# checks

## 自动验证

### 本轮结果

- `npm run lint` — passed
- `node_modules/.bin/tsc --noEmit` — passed
- `cd ~/gitProjects/ypi-browser-share-extension && npm run build` — passed
- API smoke / 真实 Chrome 手工验收 — 未执行（本轮为静态审查 + 构建验证）


ypi web：

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

Chrome 扩展：

```bash
cd ~/gitProjects/ypi-browser-share-extension
npm run build
```

可选 API smoke（开发服务运行时）：

```bash
curl -s http://localhost:30141/api/browser-share/health | jq .
```

## 手工验收

1. 创建分享
   - 点击插件“分享当前页”后 Chrome 顶部持续显示 debugger infobar。
   - 插件 badge 显示 `CODE` 或等价状态；popup 显示“当前无人可操作”。
   - share code 正常生成。

2. 绑定 ypi session
   - 在目标 chat/session 绑定后，ypi `BrowserShareControl` 显示 tab、baseUrl、session、权限、debugger attached。
   - 插件 popup 显示同一 baseUrl/session shortId。
   - 多 session 打开时，只有绑定 session 的 Browser Share tools 可读取/操作。

3. 命令执行
   - readonly：click/type/scroll/navigate 均在 ypi 侧出现一次性确认。
   - interactive：click/scroll 可直接执行；type/navigate 仍需确认。
   - 命令期间 Chrome debugger 不 detach，命令后仍 attached。
   - 命令 result 返回 fresh snapshot/debugger metadata。

4. Detach 路径
   - popup 停止分享：debugger infobar 消失，ypi 状态断开/停止。
   - ypi 解绑：extension 下次 heartbeat/poll 收到 detach 请求并释放 debugger。
   - 绑定新 share 替换旧 share：旧 tab debugger 释放，新 tab attached。
   - tab 关闭：extension 清 activeShare，server 状态 tab_closed/terminal。

5. 失败路径
   - 打开 DevTools 或另一个 debugger 冲突时，创建分享失败或运行中转为 debugger_unavailable；action command 不执行并返回清晰错误。
   - 停止 ypi web：popup 显示 service offline，ypi 恢复后可继续或要求重新分享；不发生静默 detach/attach 循环。
   - 重启 ypi web：extension 识别 server state lost，detach 并提示重新分享。
   - share code 过期未绑定：extension 释放 debugger 并提示重新生成。

## 需求覆盖检查

- [x] 创建分享即常驻 debugger（代码路径已改为 create 时 attach，静态审查通过；待真实 Chrome 回归）
- [x] 不再按需临时 attach/detach（未见 snapshot/action 后 finally detach）
- [x] 用户明确看到 baseUrl、session、权限模式
- [x] ypi 解绑/替换能通知 extension detach
- [x] debugger 不可用时 action fail-safe
- [x] 旧扩展/旧 ypi web 有清晰提示
- [x] 文档同步：architecture/API/frontend/library + extension README

## 重点回归风险

- `BrowserShareManager` 仍为内存态，server restart 是预期断开，不要设计成自动恢复旧 share。
- 不要把 `shareId` 暴露给 agent tools 输入。
- 不要让 content-script fallback 在 debugger detached 时继续执行 action。
- 不要让 baseUrl 设置变更影响已有 activeShare。
- 不要在页面 DOM 中默认注入持久 overlay。
