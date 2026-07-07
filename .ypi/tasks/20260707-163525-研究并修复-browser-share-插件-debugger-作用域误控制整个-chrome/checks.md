# checks

## 需求覆盖检查

- [ ] 文档/设计明确：`chrome.debugger.attach({ tabId })` 是 tab target，但 Chrome 原生 debugger infobar 是全局安全提示。
- [ ] 文档/设计不承诺“Chrome 顶部 debugger 提示只出现在分享 tab”。
- [ ] 共享 tab 自有标记方案存在：页面 overlay/badge、action badge、popup 状态；其他 tab 不显示 Browser Share 自有标记。
- [ ] 停止、替换、解绑、过期、tab close、debugger detach 时会移除共享 tab 自有标记并清理 action badge。
- [ ] 若页面受限无法注入 overlay，popup/action badge/ypi web 会显示 fallback 状态。
- [ ] 若考虑按需 attach/read-only 模式，必须有主会话明确产品决策和单独能力降级设计。

## 自动验证

本轮仅更新规划文档，不改生产代码。后续实现时运行：

插件仓库：

```bash
cd /Users/zyj/gitProjects/ypi-browser-share-extension
npm run build
rg -n "chrome\.debugger\.(attach|sendCommand|detach)|tabs\.query|setBadgeText|share-marker" src manifest.json
```

如改 ypi web：

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

## 手工验收矩阵

1. **Chrome 原生 infobar 预期**：在 tab A 开启分享后，Chrome 顶部 debugger 警告可能在多个 tab/window 出现；这不判为失败，只确认文案/文档解释正确。
2. **Browser Share 自有标记隔离**：tab A 开启分享后，页面 overlay/action badge 只出现在 tab A；切到 tab B 不出现 overlay/badge。
3. **命令作用域**：在 ypi 执行 scroll/click/navigate，只影响 tab A；tab B 不被操作。
4. **导航/reload**：tab A reload 或由命令 navigate 后，overlay 能重注入；如注入失败，popup 显示 marker failure/fallback。
5. **替换分享**：在 tab B 创建新分享后，tab A overlay/badge 被移除，tab B 出现 overlay/badge。
6. **停止/解绑**：popup stop 或 ypi unbind 后，overlay/badge 清空，debugger detach，activeShare 移除。
7. **关闭分享 tab**：关闭 tab A 后，本地 activeShare 清理，服务端收到 stop/tab_closed，badge/overlay 不残留。
8. **受限页面 fallback**：在 `chrome://` 等不可注入页面上，分享失败或 marker fallback 状态清晰；不能假装已有页面标记。
9. **DevTools 冲突**：其他 debugger 接管时，overlay/popup/web 显示异常状态，action tools fail-safe，不静默降级执行。

## 回归风险

- 把 Chrome 原生全局 infobar 当成实现失败，导致错误追求不可实现目标。
- Overlay 遮挡页面或被页面 CSS 破坏；需要 Shadow DOM、幂等注入、紧凑布局。
- 跨 origin 导航后 activeTab/scripting 注入失败；需 marker 状态可见并保留 action badge fallback。
- Title/favicon 标记若默认开启会改变页面状态；建议不作为默认验收项。
- 为减少 infobar 改成按需 attach 可能破坏 persistent debugger 可靠性和安全模型。

## 人工评审重点

- 搜索确认没有新增 `{ targetId }` 或多 tab attach 循环。
- 评审文案：只承诺 Browser Share target/overlay 是共享 tab，不承诺 Chrome 原生 infobar tab-only。
- 评审 overlay 生命周期：replace/stop/unbind/tab close/navigation 都有清理或重注入路径。
- 评审权限：不要为了 overlay 默认请求 `<all_urls>`；如需要更广页面标记能力，必须单独做权限产品决策。
