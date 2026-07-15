# Review — IMP-004 主任务验收弹窗增加确认并归档按钮

## 实现摘要
- `components/AppPromptProvider.tsx` / `components/AppPromptDialog.tsx`：新增 `confirmChoice` 三按钮确认能力，支持 secondary confirm action。
- `components/YpiStudioSessionWidget.tsx`：主任务验收弹窗新增「确认并归档」路径；普通确认仍只 completed；归档路径先 completed 后 archive，归档失败不回滚 completed 并提示可从 Studio Panel 重试。
- `app/globals.css`：新增 secondary success/danger prompt button 样式。
- `docs/modules/frontend.md`：更新主任务验收写路径说明。

## 验证
- `npm run lint`：通过；仅历史 warning，无 error。
- `node_modules/.bin/tsc --noEmit`：通过。
