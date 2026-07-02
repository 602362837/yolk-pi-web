# Implement Plan

## 阶段 1：服务端数据契约与 resolver

1. 在 `lib/ypi-studio-types.ts` 增加：
   - `YpiStudioSessionTaskLinkSource`
   - `YpiStudioSessionTaskLinkReason`
   - `YpiStudioSessionTaskLinkResult`
   - `YpiStudioTaskWidgetProjection`
   - `YpiStudioTaskWidgetStep`
   - `YpiStudioTaskWidgetSubagentRun`
   - `YpiStudioTaskWidgetEvent`
   - `YpiStudioLiveRunOverlay`
2. 在 `lib/ypi-studio-tasks.ts` 导出只读 runtime context helper，用于读取 exact context 当前 task，不改变写入逻辑。
3. 在 `lib/ypi-studio-transcripts.ts` 增加 bounded tail preview helper。
4. 新增 `lib/ypi-studio-session-link.ts`：
   - 生成 exact keys：`pi_<sessionId>`、`pi_transcript_<sha256(sessionFilePath).slice(0,24)>`。
   - 扫描 active + archived tasks 建索引。
   - 按 runtime pointer、task.contextIds、session transcript evidence 解析。
   - 构建轻量 widget projection。

## 阶段 2：API

1. 新增 `app/api/sessions/[id]/studio-task/route.ts`。
2. 使用 `resolveSessionPath` / `SessionManager` 读取 session header 和 entries。
3. 校验 header cwd 是否在 allowed roots。
4. 支持可选 `leafId`，非法 leaf 返回 400。
5. 返回 link result：resolved / no-workspace / no-evidence / task-not-found / ambiguous。

## 阶段 3：前端集成

1. 新增 `components/YpiStudioSessionWidget.tsx`：
   - 桌面浮层、拖拽、localStorage 位置。
   - workflow flow-line 步骤。
   - artifact 摘要。
   - subagent waterfall runs。
   - 移动端 compact pill + bottom sheet。
2. 修改 `components/ChatWindow.tsx`：
   - 增加 `onStudioToolProgressChange` callback。
   - 从 `toolProgressById` 过滤 Studio tool progress 并上抛 overlay。
3. 修改 `components/YpiStudioPanel.tsx`：
   - 增加 optional focus props。
   - focused task 切到 Tasks tab、切 active/archived scope、滚动高亮。
4. 修改 `components/AppShell.tsx`：
   - 管理 session studio task fetch/polling 状态。
   - agent_end 后刷新。
   - 点击 widget 打开 Studio drawer 并设置 focused task。
   - 当 Studio drawer 已聚焦同一 task 时隐藏/降噪 widget。

## 阶段 4：文档与验证

1. 更新：
   - `docs/modules/api.md`
   - `docs/modules/frontend.md`
   - `docs/modules/library.md`
2. 运行：
   - `npm run lint`
   - `node_modules/.bin/tsc --noEmit`
3. 手工检查已有 Trellis widget、SessionChangesFloatingPanel、YpiStudioPanel 行为不回退。

## 实现注意事项

- 不使用 `pi_process_*` 作为 session 关联证据。
- 不让浏览器传 cwd 给 association route；只信 session header cwd。
- 不返回 artifact 正文或完整 transcript。
- 低置信/冲突情况不弹错误 toast。
- 所有新增 props 保持 backward-compatible。
