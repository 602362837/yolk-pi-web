# Handoff — IMP-001 滚动修复（主会话实现）

## 已完成

1. **Page sole scroller**（`app/globals.css`）  
   - `.ypi-studio-task-document-page`：`height/max-height:100dvh; display:flex; flex-direction:column; overflow:hidden`  
   - `.is-page` / `.is-embedded`：有界 flex + `overflow:hidden`  
   - `.ypi-studio-task-document-body`：`flex:1; min-height:0; overflow:auto`（去掉会破坏高度链的 min-height:240px）

2. **Embedded 双滚消除**（`components/YpiStudioPanel.tsx`）  
   - `TaskDetailShell` 增加 `lockScroll`：document 打开时 `overflow:hidden`  
   - `TasksTab` 在 `documentTarget` 存在时外层 `overflowY:hidden`  
   - detail 外包一层 flex 高度传递容器

3. **可聚焦 body**（`YpiStudioTaskDocumentView.tsx`）：`tabIndex={0}` 便于滚轮目标

4. **文档**（`docs/modules/frontend.md`）：sole scroller 说明

## 验证

- `npm run lint`：0 errors  
- `tsc --noEmit`：通过  

## 人工验收点

- 新标签打开长 plan-review：不点击正文即可滚轮  
- 详情内嵌 Design：不点击即可滚；返回后普通 Tab 仍可滚  

## 说明

实例在 `implementing` 时无法再写入 DAG plan，本改进由主会话整项实现；请 transition → checking。
