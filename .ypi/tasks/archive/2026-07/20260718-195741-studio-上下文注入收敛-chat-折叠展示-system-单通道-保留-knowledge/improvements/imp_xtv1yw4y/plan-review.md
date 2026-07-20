# 计划审批书 — IMP-001 Studio tag 注入预览

> **审阅入口**：请先读本文，再按需打开产物链接。  
> **批准前请同时确认**：实现计划（IMP1-01…03）+ **HTML 原型**。  
> **当前状态目标**：`waiting_plan_approval` — 用户确认前 **不实现**。

## 结论摘要

在已交付的 SCI L0/L1 **之上**做小改进：

1. **parse API** 导出被剥离的 `injectionBlocks` / `injectionText`（完整闭合白名单块）  
2. **Studio tag** 从非交互 `span` 升级为可点击 `button` → **只读 popover** 预览注入原文  
3. **Copy injection**（+ 可选 Copy full raw）；气泡 Copy/Edit 仍用干净 `displayText`  
4. **不改** L1 system 单通道、子代理、JSONL、审批  

### 关键能力边界（请知悉）

| 能做 | 不能做（本改进） |
| --- | --- |
| 查看**该条用户消息**里历史被写入、现被 L0 剥离的 `<ypi-studio-*>` 块 | 查看 **当前 agent 本轮 systemPrompt** 里的 live `buildStudioState` |
| 打开 **SCI 之前** 的脏 JSONL session 排查 | 在 **L1 之后的新消息**上显示 tag（新消息本就干净，无 user 侧注入可预览） |

若还需要 live system 注入诊断，请另开任务（diagnostics），不要塞进本改进。

## 产物链接

| 产物 | 链接 | 作用 |
| --- | --- | --- |
| Brief | [brief.md](brief.md) | 反馈、证据、边界 |
| PRD | [prd.md](prd.md) | R1–R16、范围、非目标 |
| Design | [design.md](design.md) | 契约、状态机、风险 |
| Implement | [implement.md](implement.md) | IMP1-01…03 DAG |
| Checks | [checks.md](checks.md) | 单测 B1–B10 + 人工 I/G |
| UI | [ui.md](ui.md) | 类名、文案、验收点 |
| **HTML 原型** | [sci-injection-preview-prototype.html](sci-injection-preview-prototype.html) | **正式视觉审批材料** |

## Implementation Plan 一览

| ID | 标题 | 依赖 | 说明 |
| --- | --- | --- | --- |
| IMP1-01 | parse blocks + 单测 | — | 先做 |
| IMP1-02 | button tag + popover CSS | IMP1-01 | UI 门禁后 |
| IMP1-03 | 文档 + 回归验证 | IMP1-01…02 | 收尾 |

`maxConcurrency = 1`

## 推荐默认决策

| # | 决策 | 默认 |
| --- | --- | --- |
| Q1 | popover vs 气泡内大段 expand | **popover** |
| Q2 | Copy full raw | **是**（次要按钮） |
| Q3 | 本改进是否含 live system 诊断 | **否** |
| Q4 | 展示截断 | **64KiB**；Copy injection 仍用全文 |
| Q5 | 多消息多 popover | **互斥**（后开关前） |
| Q6 | partial 是否可点 | **否**（保持 SCI） |
| Q7 | 批准本 HTML 为 IMP1-02 标准 | **请明确** |

## 风险与回滚

| 风险 | 缓解 |
| --- | --- |
| 误解为 live system 预览 | 面板固定说明 + 本审批书边界表 |
| 大注入卡顿 | 展示截断 |
| outside-click / z-index | 对齐现网 popover 模式；UAT |
| 回归 strip | 保留 U1–U14 + 新 B 用例 |

**回滚**：仅回滚 UI/parse 扩展提交；无数据迁移。

## 审批清单（用户）

- [ ] 同意范围：历史脏消息 tag **点击只读预览** + Copy  
- [ ] 知悉 **非** live system 注入查看器；新干净消息无 tag  
- [ ] 同意推荐默认 **Q1–Q6**  
- [ ] 批准 HTML 原型 [sci-injection-preview-prototype.html](sci-injection-preview-prototype.html)  
- [ ] 批准 implementationPlan **IMP1-01…03**  
- [ ] 知悉不改 L1 / 子代理 / JSONL  

**批准用语示例：**

```text
确认，按 IMP-001 plan-review 与 sci-injection-preview-prototype.html 开始实现
```

**修改用语示例：**

```text
需要修改：…
```

---

*改进师说明：规划与 HTML 原型已写入 `improvements/imp_xtv1yw4y/`。子代理环境若无法调用 `ypi_studio_task` 写回 instance 状态，请主会话将 improvement 标为 `waiting_plan_approval` 并保存 implementationPlan。用户明确批准前不派 implementer。*
