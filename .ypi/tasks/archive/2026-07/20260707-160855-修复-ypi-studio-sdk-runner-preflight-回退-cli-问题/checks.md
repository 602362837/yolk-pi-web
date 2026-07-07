# Checks

## 必跑

- `npm run lint`
- `node_modules/.bin/tsc --noEmit`

## 建议新增/运行

- `node --loader ./scripts/ts-extension-loader.mjs --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/test-ypi-studio-sdk-runner.mjs`

## 手工 smoke

1. 临时设置 `~/.pi/agent/pi-web.json`：`studio.subagents.runner = "sdk"`。
2. 创建一个 review-only 临时 Studio task。
3. 启动 checker 子代理，prompt 只要求回复一句话。
4. 验证：
   - run.status=succeeded；
   - run.runner=sdk；
   - run.childSessionId 与 childSessionFile 存在；
   - child JSONL first line 包含 `studioChild`；
   - `listAllSessions({ includeStudioChildren: true })` 能读到 child。
5. 恢复 runner 配置。

## 回归

- `studio.subagents.runner=cli` 仍可显式走旧 CLI 路径。
- 普通 Sidebar 不显示 child audit session。
- `/api/usage?sessionId=<parent>` 在有真实 SDK child usage 后可纳入 child totals。
