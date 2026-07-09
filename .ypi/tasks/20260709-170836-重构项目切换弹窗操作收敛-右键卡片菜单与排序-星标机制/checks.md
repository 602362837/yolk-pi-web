# checks

## 审批前检查

- [ ] [`plan-review.md`](plan-review.md) 不含 TBD，且可作为用户审批入口。
- [ ] [`plan-review.md`](plan-review.md) 已链接 [`brief.md`](brief.md)、[`prd.md`](prd.md)、[`design.md`](design.md)、[`ui.md`](ui.md)、[`project-switch-card-menu-prototype.html`](project-switch-card-menu-prototype.html)、[`implement.md`](implement.md)、[`checks.md`](checks.md)。
- [ ] HTML 原型已提交给用户审阅。
- [ ] 用户明确批准后才进入实现。

## 自动验证

实现完成后至少运行：

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

若新增或调整测试，补充对应测试命令。

## 需求覆盖检查

| 需求 | 检查点 |
| --- | --- |
| Project card 右键 | 左侧任意 project card 右键出现项目菜单；菜单目标不依赖当前选中项目。 |
| Space row/card 右键 | main 与 WorkTree space 均可右键；WorkTree 显示删除 WorkTree 专属动作。 |
| 顶部三点菜单保留 | 当前工作区快捷菜单仍存在；文案与弹窗右键菜单分工清晰。 |
| 星标语义 | 用户可见文案为“星标”；project/space 均写 `pinned`；不新增第二套字段。 |
| 项目排序 | 星标项目仍排在非星标项前；同组按最近打开/更新时间和名称排序。 |
| 空间排序 | main 永远第一；非主空间按拖动顺序；space 星标不改变顺序。 |
| 新空间追加 | 新建/刷新发现 WorkTree 后出现在非主空间列表底部。 |
| 持久化 | 拖动排序后刷新页面/重开弹窗/重启服务仍保持顺序。 |
| WorkTree 安全 | archive/delete 确认、dirty summary、fallback 和 session cleanup 不退化。 |

## 手工验收场景

1. **Project 菜单**
   - 打开项目空间弹窗。
   - 右键非当前 project card。
   - 执行“星标项目 / 取消星标项目”，确认项目星标态与排序更新。
   - 执行“编辑项目元数据…”，确认编辑目标是右键项目。

2. **Main space 菜单**
   - 右键 main space。
   - 确认没有 WorkTree 删除动作。
   - 执行星标/编辑/切换均作用于 main space。

3. **WorkTree space 菜单**
   - 右键 WorkTree space。
   - 确认出现删除 WorkTree / 归档相关动作。
   - 执行删除/归档时进入原有确认流程，而不是直接删除。

4. **空间拖动排序**
   - 在同一 project 下准备至少 3 个非主空间。
   - 拖动第二个到最后。
   - 关闭并重开弹窗，确认顺序保持。
   - 刷新页面，确认顺序保持。
   - 对其中一个 space 星标，确认顺序不变化。

5. **新空间追加**
   - 在已有自定义顺序的 project 下创建或刷新发现新 WorkTree。
   - 确认新 space 出现在非主空间列表底部，不插入到星标空间前面。

6. **缺失路径状态**
   - 对 missing space 确认不能切换。
   - 右键仍能执行可用的编辑/星标/归档动作；不可用动作禁用。

## 回归风险检查

- [ ] 空 registry onboarding 与添加项目流程不受影响。
- [ ] 搜索项目/空间时右键菜单目标仍正确。
- [ ] Dialog `Esc`、backdrop close、focus restore 不因 context menu 破坏。
- [ ] `ProjectSpaceSwitchDialog` 关闭时清理拖动/menu 临时状态。
- [ ] 归档当前选中 project/space 后 fallback 选择仍合理。
- [ ] WorkTree 删除后 `onSessionDeleted`、`loadProjects(false)`、`loadSessions(false)` 仍触发。
- [ ] Project Registry 仍是顶层项目来源；未扫描 sessions 合成项目。

## 重点风险

- HTML5 drag/drop 在滚动容器中可能存在边界问题，需要真实浏览器手工验证。
- 旧数据缺失 `sortOrder` 时 fallback 必须稳定，否则可能造成首次升级后空间顺序跳变。
- 顶部菜单与右键菜单共享动作时要避免错误修改当前选中状态或错误关闭弹窗。
