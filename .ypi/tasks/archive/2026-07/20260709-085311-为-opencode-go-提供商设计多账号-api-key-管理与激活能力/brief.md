# brief

## 任务

为内置 `opencode-go` 提供商设计“多账号 API Key 管理 + 激活切换”能力。本轮仅完成 intake：基于当前项目已有 `ModelsConfig`、API-key provider 路由与激活模式，明确需求背景、范围、约束、主要风险与待确认点，为后续 planning 提供可执行输入；本轮不实现代码。

## 背景与现状依据

已基于当前仓库结构确认以下现状：

- `components/ModelsConfig.tsx`
  - API Key provider 当前只有单个输入框，支持 `Save / Disconnect`，语义是“当前 provider 只有一个已配置 key，可替换或删除”。
  - 设置入口在现有 Models / Auth 配置弹窗内，因此后续方案一定会改动前端设置页交互。
- `app/api/auth/api-key/[provider]/route.ts`
  - `GET` 仅返回 `configured/source/models/displayName` 等状态，不返回真实 key。
  - `POST` 仅接受一个 `apiKey` 并直接写入当前 provider 的有效凭证。
  - `DELETE` 仅删除当前 provider 的单个已存 key。
- `app/api/auth/accounts/[provider]/activate/route.ts` + `lib/oauth-accounts.ts`
  - OAuth provider 已有“保存多个账号 + 激活一个账号”的现成产品模式，可作为后续 API key 多账号设计参考，但不能直接假设实现复用。
- `node_modules/@earendil-works/pi-coding-agent/docs/providers.md`
  - `opencode-go` 是已内置的 API-key provider，当前支持通过凭证配置使用。

## 需求背景

当前 `opencode-go` 只支持“单 provider 单 key”的配置方式，存在以下问题：

1. 用户有多个 `opencode-go` API Key 时，无法在产品内长期保存并切换，只能反复覆盖当前 key。
2. 当前没有“激活某个 key 作为当前生效凭证”的显式能力，不利于日常切换、排障和配额管理。
3. 用户已明确补充要求：**`apiKey` 需要回显**。这意味着后续设计不能只保留“已配置/未配置”或纯掩码状态，必须讨论已保存 key 在前端的显示/查看方式。
4. 该能力会改动设置页的信息结构与交互流，不再是单输入框覆盖保存的问题，而是“列表管理 + 激活 + 查看/编辑/删除”的完整管理体验。

## 目标

后续 planning 需要围绕以下目标展开：

- 支持为 `opencode-go` 保存多个 API Key 记录。
- 支持明确激活其中一个 API Key，作为当前 `opencode-go` provider 的实际生效凭证。
- 在设置页中提供可管理的多 key 交互，而不是仅允许覆盖单值。
- 满足用户“`apiKey` 需要回显”的补充要求，并明确其具体交互、安全边界与实现约束。
- 与现有旧配置兼容：已有单 `apiKey` 用户升级后不能失效，也不能被强制手工迁移。

## 范围内

- `opencode-go` provider 的多 API Key 保存、查看、激活、删除、替换等产品方案设计。
- 设置页 / `ModelsConfig` 中与 `opencode-go` 相关的交互变更设计。
- 后端 API / 存储契约层面的规划：如何从“单 key 状态接口”演进到“多 key 管理 + 激活”的能力。
- 与现有运行时认证刷新机制的兼容要求（激活后应能切换当前实际使用的 key）。
- 旧单 `apiKey` 配置的兼容与迁移策略规划。
- `apiKey` 回显需求的产品定义、安全边界和实现约束规划。

## 非范围

- 本 intake 阶段不实现代码。
- 本 intake 阶段不扩展到所有 API-key provider；默认聚焦 `opencode-go`，是否抽象为通用能力留待 planning 决策。
- 不改造 OAuth 账号体系本身；仅可把其“多账号 + 激活”模式当作参考。
- 不改造自定义 `models.json` provider 的 `apiKey` 字段语义，除非 planning 证明兼容性必须联动。
- 不修改上游 pi SDK / provider 内部实现。

## 关键约束

1. **必须兼容旧单 `apiKey` 配置**
   - 现有单 key 用户升级后应保持可用。
   - 后续设计必须定义：旧数据在新 UI 中如何呈现、默认是否视为一个已导入账号、是否自动成为 active。

2. **后续 planning 必须经过 UI 原型门禁**
   - 该任务明确涉及前端设置页交互变化、用户可见信息结构变化。
   - 根据本项目 YPI Studio 规则，后续 planning **必须产出 HTML UI 原型**（`ui.md` 可承载 fenced `html` 或链接到 `.html` 文件），并在进入实现前交由主会话 / 用户审批。
   - 纯 Markdown 说明不能替代 HTML 原型。

3. **不能只做“后端多存几个 key”**
   - 因为用户已经提出“`apiKey` 需要回显”，前后端与数据契约必须联动设计，不能只补数据结构。

## 主要风险

1. **安全风险：API Key 回显**
   - 当前系统默认不返回真实 key；若要回显，需谨慎处理前端展示、接口返回、日志、缓存、复制行为与屏幕暴露风险。
   - 需要避免因为“可回显”而把 secret 无意暴露到浏览器缓存、调试日志或错误上报中。

2. **兼容风险：旧单 key 配置迁移**
   - 当前 `opencode-go` 只有单 active key 语义；多账号设计若改写存储结构，必须保证旧数据可无损识别。

3. **产品边界风险：`opencode-go` 是否仅做特例还是抽象成通用 API-key 账号能力**
   - 若只对 `opencode-go` 做特例，后续其他 provider 可能重复建设。
   - 若一开始就抽象成通用层，设计和实现复杂度会上升。

4. **Provider 边界风险：`opencode` 与 `opencode-go` 的关系**
   - 当前上游文档中两者都属于 OpenCode 家族，后续需要明确账号池是否完全独立，避免产品语义混淆。

## 待确认点

1. **“apiKey 需要回显” 的准确含义是什么？**
   - 是要求保存后长期可再次查看明文？
   - 还是仅允许用户主动点击“显示”后查看？
   - 是否允许复制？是否默认掩码展示？

2. **多 key 的最小管理字段有哪些？**
   - 仅保存 key 本身并自动编号，还是需要备注/名称/创建时间/最后激活时间等元数据？

3. **激活语义是否严格为“同一 provider 同时只有一个 active key”？**
   - 当前需求看起来是单 active，但需在 planning 明确。

4. **`opencode-go` 的账号池是否与 `opencode` 独立？**
   - 当前任务标题只指向 `opencode-go`；是否允许未来复用同一套账号记录，需要产品侧确认。

5. **兼容策略具体采用哪种方式？**
   - 旧单 key 是在读取时虚拟成一条账号记录，还是首轮进入新版本时迁移落盘？
   - 若迁移失败或回滚，如何保证旧逻辑仍可读？

6. **回显权限边界是否需要额外确认动作？**
   - 例如是否需要用户再次点击 reveal、再次输入确认信息，或只要进入设置页即可看到。

## 后续 planning 入口建议

后续进入 planning 时，至少应覆盖：

- PRD：明确用户场景、激活语义、回显要求与验收标准。
- UI：基于现有 `ModelsConfig`/设置页产出 HTML 原型，展示列表、激活、回显、替换、删除、空状态、旧配置迁移后的状态。
- Design：明确前端状态、后端 API、存储结构、兼容策略、运行时认证刷新方式与回滚方案。
- Implement / Checks：明确迁移验证、兼容验证、安全检查与手工验收点。
