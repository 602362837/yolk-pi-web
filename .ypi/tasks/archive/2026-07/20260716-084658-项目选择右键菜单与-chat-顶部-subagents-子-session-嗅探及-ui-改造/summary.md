# Summary

## 完成内容

1. **项目选择右键菜单**：左侧顶部项目空间选择按钮右键与三点按钮使用同一份当前工作区菜单；WorkTree 时两入口追加归档/删除。
2. **Chat 顶部 Subagents**：改为直接嗅探当前父 Chat 的 YPI Studio 持久 child session（`GET /api/sessions/:id/studio-children`），不再走旧 tool-call / sessionFile 递归探测。
3. **UI**：active + 最近 20 条终态分组展示；整行进入只读 audit session；动画与 reduced-motion；窄屏顶栏可达性修复。
4. **验收后补丁**：
   - child 审计视图增加明确「返回父 Chat」按钮
   - Branches/System/Subagents/Git 顶栏面板统一支持点击空白 / Escape 关闭

## 验证

- lint / tsc / `test:studio-child-sessions` 通过
- 真实浏览器验收（含 375/640 窄屏与用户验收）通过

## 状态

用户验收通过。
