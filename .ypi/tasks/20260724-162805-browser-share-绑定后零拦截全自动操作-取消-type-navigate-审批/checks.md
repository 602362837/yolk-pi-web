# Checks — Browser Share 全自动权限

## 需求覆盖检查

- [ ] 默认新分享为全自动。
- [ ] 全自动下 click/type/scroll/navigate 均直接 queued。
- [ ] 全自动 operator：auto 四类、approval 空。
- [ ] ypi 面板与 extension popup 不再声称 type/navigate 需要逐次确认。
- [ ] 严格模式仍支持 pending approval、允许、拒绝。
- [ ] approval API/status union 未删除。
- [ ] 当前 session/tab 隔离保持。
- [ ] debugger unavailable 明确失败。
- [ ] 解绑/替换/停止/tab close/not_found 生命周期保持。
- [ ] 跨版本 capability 不会造成“宣传全自动，实际待审批”。

## 自动验证

### ypi web focused test

建议新增：

```bash
npm run test:browser-share-policy
```

覆盖：

1. `createShare()` 缺省模式为 interactive。
2. interactive bind 后四类 enqueue 均 queued。
3. interactive operator arrays 精确为 auto 四类、approval 空。
4. readonly 四类均 pending approval。
5. readonly approve → queued；reject → rejected；terminal 不被重复覆盖。
6. cross-session approval 失败。
7. unbound session enqueue 失败。
8. unbind/replace/stop 将活动命令置 failed。
9. wait timeout → timeout，晚到 result 不覆盖。
10. navigate 非 http(s)、缺失 elementId/文本、非法 scroll 数值在 manager 边界失败。
11. completed command retention/diagnostic projection不因策略调整泄漏 payload。

### Web 全量最小验证

```bash
npm run test:browser-share-policy
npm run lint
node_modules/.bin/tsc --noEmit
git diff --check
```

不得直接运行 `next build`；仅发布验证使用 `npm run build`。

### Chrome extension

```bash
cd /Users/zyj/gitProjects/ypi-browser-share-extension
npm run build
git diff --check
```

扩展 `scripts/validate.mjs` 应检查：

- manifest 边界仍无 `<all_urls>` 默认权限。
- mode selector 存在且默认全自动。
- full-auto capability 检查存在。
- strict/full-auto 本地 operator 初始投影与 Web 一致。
- popup/README 不包含过期的“interactive 下 type/navigate 仍需确认”主路径文案。

## API / 契约检查

- [ ] health version/capability 只做 additive 变更。
- [ ] 旧客户端未知新 capability 时不会崩溃。
- [ ] `BrowserSharePermissionMode` 仍为 `readonly | interactive`。
- [ ] `BrowserShareCommandStatus` 仍含 pending_approval/queued/running/succeeded/failed/rejected/timeout。
- [ ] command approval route 请求/响应不变。
- [ ] extension poll 仍不领取 pending approval。
- [ ] operator 由 manager 单一策略生成，UI 只展示返回值。
- [ ] tombstone/unbound operator 不宣称可操作。

## 安全检查

- [ ] agent tools 不接受 shareId，仍从当前 ExtensionContext session 取 id。
- [ ] session A 的 command 不可由 session B approval。
- [ ] extension 只操作 `activeShare.tabId`，无多 tab query/广播执行。
- [ ] `navigate` manager 边界只允许 http/https。
- [ ] sensitive element click/type 仍由 extension 拒绝。
- [ ] debugger detach/blocked/failed 不回退 content-script action。
- [ ] snapshot/password/payment/token-like 脱敏不变。
- [ ] 非 loopback base URL host permission 与风险提示不变。
- [ ] stop/unbind/replaced/expired/tab_closed 都释放 debugger 或返回 detach projection。

## UI 原型与实现检查

> 前置：必须先由 UI 设计员交付并由用户批准 `browser-share-full-auto-prototype.html`。

- [ ] Extension 默认 mode card 为「全自动（推荐）」。
- [ ] 严格模式是显式次要选项。
- [ ] ypi 面板显示产品文案而非 raw `interactive/readonly`。
- [ ] 全自动显示四类自动、需确认无，且没有空 pending 区块。
- [ ] 严格模式 pending card/允许/拒绝可用。
- [ ] debugger/error 信息优先，不被绿色全自动状态掩盖。
- [ ] 长 title/url/session id ellipsis，不破坏布局。
- [ ] keyboard radio、focus-visible、按钮 busy/disabled 可访问。
- [ ] 明暗主题与 375px 窄屏通过。

## 人工 Chrome 验收

### M1 — 默认全自动 happy path

1. 启动当前 Web，安装/刷新新版扩展。
2. popup 不改 mode，分享 GitHub 测试页。
3. 在 session A 绑定 code，关闭 popup 与 ypi Browser Share panel。
4. 让 agent 连续 navigate → type → click → scroll。
5. 预期：无「允许一次」，无 pending_approval，四类均 terminal succeeded（页面条件允许）。

### M2 — session 隔离

1. session A 保持绑定。
2. session B 调 status/action。
3. 预期：B 显示未绑定，A 的 tab 无任何来自 B 的操作。

### M3 — 严格模式

1. 新建分享前选择「每次确认」。
2. 绑定 session A，触发 type/navigate。
3. 预期：pending card 可见；允许后执行；另一条拒绝后 terminal rejected。

### M4 — debugger 冲突

1. 分享后打开 DevTools/让其他 debugger 接管。
2. 触发 action。
3. 预期：扩展与 ypi 显示 detached/blocked，action failed，不发生隐蔽执行。

### M5 — 生命周期

逐项验证：unbind、replace share、popup stop、tab close、server restart/not_found。

- 预期：binding 清理、活动命令 failed、waiter 返回、extension detach、badge 清理。

### M6 — 离线/timeout

1. 绑定后暂停 extension service worker 或断开 Web。
2. 触发 action。
3. 预期：queued/running 状态可见，最终 failed/timeout；不伪装为审批阻塞。

### M7 — 版本组合

- 新扩展 + 旧 Web：选择全自动时明确升级提示，不创建“假全自动”分享。
- 新扩展 + 新 Web：全自动成功。
- 旧扩展 + 新 Web：协议可解析；文档提示更新扩展以获得默认体验。

## 回归风险重点

1. `commandNeedsApproval` 与 operator arrays 漂移。
2. 默认解析只改 server、未改 extension，导致用户仍默认 strict。
3. 只改 extension 文案、未增加 capability，连接旧 Web 后误导。
4. 删除 approval UI/API，破坏 strict/旧命令。
5. 全自动掩盖 debugger/offline 真实错误。
6. 直接 commands API 绕过 tool URL/参数校验。
7. 跨仓库只完成一侧。

## Checker 评审门禁

- 逐项对照 [prd.md](prd.md) R1–R13。
- 对照经批准 HTML 原型，不接受无原型的 UI 自由发挥。
- 查看双仓 diff；确认无无关改动、无 commit/push/merge。
- 自动命令全绿后仍必须完成 M1–M5；M6/M7 若环境受限需明确记录缺口和复现步骤。
