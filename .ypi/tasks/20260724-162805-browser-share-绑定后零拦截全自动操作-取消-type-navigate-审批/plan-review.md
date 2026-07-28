# 计划审批书 — Browser Share 绑定后全自动

> **当前结论：架构规划与 UI 原型均已完成，准备好进入用户正式批准。** UI 设计员已补齐 HTML 原型。请主会话审阅本文件及原型，并将任务 transition 到 `awaiting_approval` 以等待用户确认。

## 方案摘要

推荐保留 wire 兼容并改变主路径语义：

1. `interactive` 技术值继续保留，但产品语义改为 **全自动**：click/type/scroll/navigate 全部直接 queued。
2. `readonly` 技术值保留为可选 **每次确认（严格模式）**：四类 action 仍走既有 pending approval。
3. 新分享默认全自动；Chrome extension popup 默认选择「全自动（推荐）」。
4. approval API、pending/rejected/timeout 协议不删除，服务严格模式、旧客户端和在途命令。
5. session/tab/debugger/敏感字段/http(s) 导航等安全边界不变；取消的是 ypi 产品内逐次审批，不是执行失败检查。
6. health 增加 full-auto capability，避免新扩展连接旧 Web 后错误宣传全自动。

## 规划产物

| 产物 | 链接 | 内容 |
| --- | --- | --- |
| Brief | [brief.md](brief.md) | 问题、证据、目标、非目标、成功标准 |
| PRD | [prd.md](prd.md) | R1–R13、模式表、用户验收场景 |
| UI Brief | [ui.md](ui.md) | UI designer 输入、双表面、状态/a11y 门禁 |
| Design | [design.md](design.md) | 权限策略、API/capability、数据流、兼容与回滚 |
| Implement | [implement.md](implement.md) | BSFA-01…04 DAG、双仓文件与验证 |
| Checks | [checks.md](checks.md) | 自动/手工/安全/兼容矩阵 |
| HTML 原型 | [browser-share-full-auto-prototype.html](browser-share-full-auto-prototype.html) | **已就绪**：覆盖两端 5 种交互状态 |

## 推荐默认行为

| 项 | 推荐 |
| --- | --- |
| 新分享默认 | 全自动 |
| 全自动命令 | click/type/scroll/navigate 全部自动 |
| 更严格模式 | 保留“每次确认”，所有 action 逐次确认 |
| raw wire | 保留 `interactive/readonly`，UI 不展示 raw 值 |
| debugger 不可用 | 明确失败，不回退 |
| 解绑/停止 | 立即失去授权并释放 debugger |
| 旧 Web 能力不足 | 全自动创建 fail closed + 升级提示 |

## Implementation Plan 一览

| ID | 标题 | 依赖 | 主要边界 |
| --- | --- | --- | --- |
| BSFA-01 | Web 权限策略、集中校验、focused tests | — | 单一策略真相 |
| BSFA-02 | Web API/tool/UI/docs 同步 | BSFA-01 + UI approval | operator 与面板一致 |
| BSFA-03 | Chrome 扩展默认模式与 capability/UI | BSFA-01 + UI approval | 独立仓库 |
| BSFA-04 | 双仓集成验证与文档收尾 | 01–03 | Chrome 手工矩阵 |

建议 `maxConcurrency=2`：BSFA-01 完成后，BSFA-02 与 BSFA-03 文件不重叠，可并行；BSFA-04 收尾。

## 兼容性说明

- 无磁盘/JSONL 迁移；Browser Share 为进程内状态。
- 现有 command/status/approval 路由与字段保持。
- 新 Web 接受旧扩展模式值；旧扩展可能仍默认严格，需升级扩展获得默认全自动。
- 新扩展通过 health capability 避免连接旧 Web 时作出错误承诺。
- 运行中既有 command 不重写状态。

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 自动误操作 | 分享+绑定作为明确授权；当前 tab/session 限定；持续状态信号；stop/unbind。 |
| API 绕过 tool 校验 | manager 集中校验 URL与payload。 |
| UI/队列语义漂移 | manager 单一 policy + operator tests；UI读取 operator。 |
| 双仓只更新一侧 | 独立 implementation subtask + 双仓 checker。 |
| extension/Web 版本错配 | additive health capability，full auto fail closed。 |
| strict/旧客户端回归 | approval/status 全保留。 |

## 用户最终审批清单

- [ ] 同意默认 **全自动**，四类 action 不再逐次批准。
- [ ] 同意保留「每次确认」严格模式，而非本期改成真正只读。
- [ ] 同意 wire 继续使用 `interactive/readonly`，产品 UI 使用「全自动/每次确认」。
- [ ] 批准 [browser-share-full-auto-prototype.html](browser-share-full-auto-prototype.html) 的 extension popup 与 ypi 面板设计。
- [ ] 批准 BSFA-01…04 implementationPlan（maxConcurrency=2）。
- [ ] 知悉 debugger/离线/执行失败/timeout 仍可能阻断；“零拦截”仅指取消逐次审批。
- [ ] 知悉实现涉及当前 Web 仓库与独立 Chrome extension 仓库。

## 主会话下一步

1. 主会话保存 [implement.md](implement.md) 的 machine-readable implementationPlan（如果尚未保存）。
2. transition `planning -> awaiting_approval`，向用户展示本审批书与 HTML 原型进行正式审批。
3. 用户明确批准前停止；不得进入 implementing。
