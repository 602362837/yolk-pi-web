# design

## 方案摘要

将 YPI Studio 默认成员定义改为自包含的工作室角色说明，去掉所有 Trellis 直指。初始化新项目时写入清理后的模板；对已有项目采用版本化、可判定的安全迁移：只自动替换完全匹配旧默认模板的成员文件，跳过用户自定义内容并报告需要人工处理。

## 影响模块和边界

### 需要修改

- `lib/ypi-studio-agents.ts`
  - 修改 `DEFAULT_YPI_STUDIO_AGENTS` 四个成员正文。
  - 建议将默认成员 frontmatter `version` 从 `1` 升级到 `2`。
  - 建议保留旧默认模板签名或检测函数，用于安全迁移已初始化成员。
- `lib/ypi-studio-types.ts`
  - 如果返回迁移结果，扩展 `YpiStudioAgentWriteResult.status` 支持 `updated`，或在 `YpiStudioAgentsInitResponse` 新增 `updated` / `warnings` 字段。
- `components/YpiStudioPanel.tsx`
  - 如果 API 返回 `updated` / `warnings`，更新初始化反馈文案；否则无需改 UI 结构。
- 本仓库现有 `.ypi/agents/*.md`
  - 作为已初始化项目样本，也应由实现阶段同步清理；这是工作室配置文档，不是生产代码。

### 不建议修改

- `lib/ypi-studio-extension.ts#buildMemberPrompt`：它正确读取项目本地成员定义；泄露根因是成员文件内容，不是注入机制。
- `lib/ypi-studio-workflows.ts` / `.ypi/workflows/*.json`：未发现 Trellis 直指。
- `lib/ypi-studio-tasks.ts`：任务模板未发现 Trellis 直指；`events.jsonl` 是 Studio 自身事件文件，不属于 Trellis 泄露。
- 独立 Trellis 功能与文档：设置页、Trellis 面板/API/reader 属于产品中的独立功能，不在本任务清理范围。

## 建议成员文案原则

- 对外只说“蛋黄派工作室 / YPI Studio / 工作室任务 / 成员 / 规划 / 实现 / 检查”。
- 不出现 `Trellis`、`.trellis`、`task.py`、`active task`、`jsonl manifest`、`check.jsonl`、`Trellis Design/Implement/Check Agent`。
- 如果需要表达内部方法论，改写为通用动作：
  - “先读取上下文和项目规范”
  - “将需求转化为可执行规划”
  - “按计划实现并验证”
  - “按需求、设计和证据做质量门禁”

## 数据流 / API / 文件契约

1. 用户点击初始化或调用 `/studio-init`。
2. `POST /api/studio/agents` 或命令进入 `initializeYpiStudioAgents(cwd)`。
3. `writeDefaultAgent` 对缺失文件写入 v2 清理模板。
4. 对存在文件：
   - 若内容完全等于旧默认模板，替换为 v2 清理模板并报告 `updated`。
   - 若不是旧默认模板，保持跳过，不覆盖用户内容；如仍含 Trellis 直指，报告 warning 供用户决定。
5. `GET /api/studio/agents` 返回清理后的成员内容，`YpiStudioPanel` 渲染预览。
6. `ypi_studio_subagent` 派发时，`buildMemberPrompt` 读取同一成员文件；因此新派发不会带入旧默认 Trellis 文案。

## 兼容性、风险、回滚

- 兼容：默认文件名、成员 id、frontmatter description、工作流 owner、任务状态不变，现有任务可继续引用 `architect/ui-designer/implementer/checker`。
- 迁移风险：直接覆盖已有成员可能丢失用户自定义；必须只自动替换可判定旧默认内容。
- 历史风险：历史 transcript、task title、events 中已有 Trellis 文本不应重写；验收时需限定扫描范围。
- 回滚：若迁移逻辑异常，可回退到只更新默认模板、不触碰已存在文件；用户可手动编辑 `.ypi/agents/*.md`。
