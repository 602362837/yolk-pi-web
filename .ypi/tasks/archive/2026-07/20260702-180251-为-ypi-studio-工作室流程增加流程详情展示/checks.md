# Checks

## 自动验证

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

## 手工验证

1. 打开 YPI Studio → Workflows，点击任意 workflow 卡片进入详情。
2. 详情显示主路径节点、owner/委派、审批、产物、触发方式、分支与例外流。
3. 返回按钮回到流程列表。
4. 打开任务详情概览，看到当前任务对应 workflow，并高亮当前 status。
5. 损坏/自定义 workflow 不导致面板崩溃。
