# checks

## 需求覆盖检查

- [ ] 左侧项目/空间选择不再使用 dropdown；点击顶部切换按钮打开 modal/dialog。
- [ ] 弹窗分层选择路径明确：先选项目，再选项目空间。
- [ ] 大量项目/空间可滚动、可搜索，长文本不撑破布局。
- [ ] 当前项目、当前空间、WorkTree、missing 空间有明确视觉状态。
- [ ] 无项目注册的新环境能打开弹窗并看到添加第一个项目入口。
- [ ] 添加项目文件夹、手动路径、默认目录、Git clone 入口全部保留且互斥表单行为正确。
- [ ] 选择空间后会话列表、文件浏览、Git/WorkTree 摘要、新会话 cwd 都切到目标空间。
- [ ] WorkTree 右键归档/删除入口不回退。

## 自动验证

实现完成后至少运行：

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

若实现新增可测试纯 helper，补充对应单元测试或至少用 TypeScript 类型检查覆盖。

## 手工验收场景

1. **普通切换**：已有多个项目，每个含 main + worktree；打开弹窗，先点另一个项目，再点其主空间，确认 sidebar header、sessions、file explorer cwd 更新。
2. **大量项目**：构造/使用 50+ 项目或长路径项目；确认弹窗不溢出 viewport，项目/空间列表分别滚动，搜索可过滤。
3. **WorkTree 空间**：空间列表显示 `WT`、branch/base；右键 WorkTree 行仍能打开归档/删除菜单。
4. **missing 空间**：路径缺失空间禁用，点击不切换，说明可见。
5. **空 registry**：使用临时 `PI_CODING_AGENT_DIR` 或清空 registry 的测试环境，确认左侧按钮可打开空状态，可添加项目。
6. **添加项目路径**：手动输入合法路径注册成功后自动选中 main；非法路径错误显示且不改变当前选择。
7. **目录选择**：目录选择取消不改变状态；成功选择后注册并切换。
8. **Git clone**：填写 parent + remote，失败时显示错误且不切换；成功后选中 cloned project main。
9. **键盘/关闭**：Tab 可到搜索、项目、空间、添加入口；Esc/backdrop/close 关闭并恢复焦点；busy 状态不产生半更新。
10. **窄侧边栏/窄窗口**：左侧顶部按钮文本省略稳定，弹窗在小窗口内仍可滚动操作。

## 质量检查

- [ ] 不新增 session 扫描作为项目来源。
- [ ] 不把 Project Registry path 比较改成 display path；继续依赖现有 canonical/pathKey 逻辑。
- [ ] 没有修改 session JSONL 和 Project Registry schema。
- [ ] 没有把 API 错误吞掉；错误能展示在弹窗对应区域。
- [ ] Dialog 使用 `role="dialog"`、`aria-modal`、可见标题和关闭按钮。
- [ ] 实现后更新 `docs/modules/frontend.md`。

## 回归风险重点

- `useEffect` 自动选择第一个项目的逻辑在无项目时不能无限 set state。
- `loadSessions()` 在无 selected project/space 时应保持空列表，不报错。
- 弹窗关闭时清理 transient form state，不应清理已选择的 project/space。
- `workspaceMenuOpen`、WorkTree context menu、metadata dialog 与新 modal 的 z-index 不能互相遮挡。
- AppShell browser title 依赖 `onProjectSpaceChange`，切换后仍需更新。
