# Checks

## 需求覆盖

- [ ] 新 session 与新账本事件不再读取/保存 cache-write token 或分项费用。
- [ ] 历史账本文件 byte-for-byte 不变，查询/API 按批准口径处理旧值。
- [ ] Usage、顶栏、消息尾注、表格、drawer、tooltip、图表无 Cache Write / Cache W / R/W。
- [ ] Cache Read 与缓存命中率仍正确。
- [ ] token 主值是完整整数，M 只是派生显示；复制/tooltip 可见精确值。
- [ ] 价格页覆盖缺价、已配置、builtin、explicit free，并正确区分 0。
- [ ] 手填与智能建议均经过差异确认；建议请求从不写文件。
- [ ] 保存后 Model Registry resolved price 与 UI 一致，只影响未来调用。
- [ ] HTML 原型存在且有用户审批记录。

## 自动验证

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

建议新增 focused tests：

```bash
npm run test:usage-accounting
npm run test:model-prices
```

`test:usage-accounting` 至少覆盖：normalizer 忽略 cacheWrite/cacheWrite1h、v1 兼容零字段、历史事件查询归零、SDK total/cost.total 保留、legacy rollup、exact/M formatter 边界。

`test:model-prices` 至少覆盖：builtin override、自定义模型 merge、未知模型、partial cost、显式免费、tiers/cacheWrite/无关字段保留、JSONC、原子写失败、revision 409、权限、批次上限、reload 验证、secret redaction、source allowlist/redirect/size/timeout、AI schema/幻觉拒绝。

## API 契约测试

- [ ] GET 不返回 apiKey、headers、auth/account、完整 baseUrl、绝对路径。
- [ ] PATCH 负数/NaN/Infinity/超限/重复目标返回 422 且文件不变。
- [ ] stale revision 返回 409，两个并发保存不互相覆盖。
- [ ] suggest 拒绝 URL/prompt/path 等额外输入；超过 20 个目标返回 400/422。
- [ ] source redirect 到非 allowlist host 被拒绝；远端正文不进入错误响应/日志。
- [ ] AI timeout、单来源失败返回 partial，全部失败仍可手填。
- [ ] 保存响应通过 fresh registry read 验证 effective cost。

## 数据兼容测试

- [ ] 用含历史 cacheWrite 的 v1 fixture 查询，确认文件未变且 API 符合最终决策。
- [ ] 老客户端仍能解析 deprecated 数字字段。
- [ ] includeArchived、Studio child parent rollup、standalone 与 child-selected 口径不回归。
- [ ] 原有 `models.json` 的 providers/models/modelOverrides/compat/headers/tiers/comments 不丢失。
- [ ] 已有 cost.cacheWrite 被保留但新 UI 不展示/修改。
- [ ] 回滚后 models.json 仍可由 Pi CLI 和 web 读取。

## 人工验收

1. 对缺价内置模型手填三项价格，确认保存前 diff、保存后 resolved 值和下一次调用费用。
2. 对自定义 provider 模型保存，确认没有创建错误的 modelOverride 或覆盖 baseUrl/auth。
3. 运行智能填写：高置信度候选、冲突候选、无结果各一次；确认没有自动保存。
4. 人工修改 models.json 后再提交旧页面草稿，确认 409 与 reload/合并提示。
5. 用窄屏和键盘完成筛选、编辑、确认；检查焦点、错误朗读和底部操作区。
6. Usage 中检查小值、999999、1000000、大值：整数精确，M 换算正确。
7. 检查旧日期账本、当前聊天顶栏、Studio parent/child、archive scope。

## 重点风险门禁

- UI 原型与用户审批缺失：阻塞。
- cacheWrite 历史 API 口径未确认：阻塞。
- totalTokens 是否保留 SDK authoritative total 未确认：阻塞。
- explicit-free 持久化位置未通过 Pi schema spike：阻塞。
- JSONC 注释/尾逗号不能安全 merge：阻塞。
- 智能来源 allowlist 未批准：智能填写阻塞，但手填可独立实施。
