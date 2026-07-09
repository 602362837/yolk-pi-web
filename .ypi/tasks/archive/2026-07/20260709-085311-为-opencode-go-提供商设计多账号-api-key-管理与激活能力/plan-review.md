# plan review：为 `opencode-go` 设计多账号 API Key 管理与激活能力

## 当前建议状态

- **当前状态：已完成 UI 原型交付，待你审批方案方向与 UI 原型。**
- 本轮已补齐由 **UI 设计员交付的 HTML 原型** `ui-prototype.html` 并更新了设计说明 `ui.md`。

## 相关产物

- [brief.md](brief.md)
- [prd.md](prd.md)
- [ui.md](ui.md)
- [ui-prototype.html](ui-prototype.html)
- [design.md](design.md)
- [implement.md](implement.md)
- [checks.md](checks.md)

## 方案一句话摘要

推荐方案是：**新增应用自管的 `opencode-go` 多 API Key 账号存储层，账号列表/激活/回显由 web UI 管理；当前 active key 始终镜像回 `auth.json`，运行时继续复用现有 `AuthStorage` / `ModelRegistry` / `reloadRpcAuthState()` 链路，不改上游 SDK。**

---

## PRD 摘要

已明确以下产品定义：

1. **账号模型**
   - `账号 = 一条 API Key 记录`；
   - 支持 `displayName`、`description`、脱敏 key 预览、删除、激活；
   - 记录内有稳定 `accountId`、时间戳与 active 状态。

2. **激活语义**
   - 同一 provider 同时最多一个 active；
   - 首次保存自动 active；
   - 删除 active 且还有剩余账号时，自动切到 fallback；
   - 删除最后一条后 provider 回到未配置状态。

3. **`apiKey` 回显定义**
   - 默认只显示脱敏预览；
   - 必须对单条记录显式点击 reveal，前端才收到明文；
   - 支持显式 copy；
   - 列表 / summary / provider list 都不返回明文；
   - 明文只允许通过单账号 reveal 接口返回。

4. **旧单 key 兼容**
   - 旧 `auth.json` 中的单 key 首次进入管理页时做幂等导入；
   - 导入后仍保留 `auth.json` 中当前 active key 作为运行时镜像；
   - 旧版本回滚后仍可继续读取当前 active key 工作。

5. **范围控制**
   - v1 只对 `opencode-go` 开新 UI；
   - `opencode` 与其它 API-key provider 不改产品行为。

详情见 [prd.md](prd.md)。

---

## UI 摘要

### 门禁结论

- **已触发 UI 原型门禁：是。**
- 触发原因：本任务会把 `ModelsConfig` 中 `opencode-go` 从“单输入框 Save / Disconnect”改为“账号列表管理 + 激活 + reveal/copy + 编辑 + 删除”。

### 当前状态

- **已交付 HTML 原型**，可通过相对链接 [ui-prototype.html](ui-prototype.html) 进行审阅与交互状态仿真。
- `ui.md` 已写明设计要点与原型包含的交互。

### UI 原型已覆盖

- 空状态；
- 旧单 key 导入后的默认状态；
- 多账号列表状态；
- `Activate` / `Active` 标识；
- `Show / Hide` / `Copy`；
- `Edit`（显示名 / 描述 / 替换 key）；
- 删除 active 后自动 fallback；
- 删除最后一条后的断开状态；
- 错误 / 加载 / reveal 失败状态。

详情见 [ui.md](ui.md)。

---

## Design 摘要

### 核心技术决策

1. **不改上游 SDK 数据结构**
   - 不把多条 key 直接写进 `auth.json`；
   - 继续尊重上游 `AuthStorage` 的“一 provider 一 credential”契约。

2. **新增应用自管多账号存储层**
   - 建议目录：`~/.pi/agent/auth-api-key-accounts/opencode-go/`；
   - `accounts.json` 保存元数据；
   - `<accountId>.json` 保存单账号 secret；
   - 元数据只保留 `maskedKeyPreview` 与 `keyFingerprint`，不保存明文 key。

3. **active mirror 回写 `auth.json`**
   - 激活 / 替换 active / 删除最后一条时，同步更新 `auth.json` 中的 `opencode-go` credential；
   - 然后调用 `reloadRpcAuthState()`；
   - 这样运行时无需理解多账号概念。

4. **API 演进策略**
   - 保留 `/api/auth/api-key/[provider]` 作为 summary / legacy compatibility route；
   - 新增 `opencode-go` 多账号管理路由族：list / create / update / delete / activate / reveal；
   - 不复用现有 OAuth `auth/accounts/[provider]` 路由，避免 token/account 与 secret reveal 语义混杂。

5. **通用 vs 特化推荐**
   - **底层服务层泛化**：`lib/api-key-accounts.ts` 用 provider 参数设计；
   - **产品开放面特化**：v1 只 allowlist `opencode-go`。

详情见 [design.md](design.md)。

---

## Implement 摘要

建议实现顺序：

1. 先补 UI 设计员 HTML 原型并完成审批；
2. 实现 `lib/api-key-accounts.ts` 与 active mirror；
3. 演进 `/api/auth/all-providers` 与 `/api/auth/api-key/[provider]`；
4. 新增 `opencode-go` 多账号管理路由；
5. 改造 `ModelsConfig` 的 `opencode-go` UI；
6. 同步 docs，跑 lint / tsc，做手工验收。

`implement.md` 中已经给出可执行子任务表和机器可读 `json ypi-implementation-plan`，实现员可直接按阶段接手。

详情见 [implement.md](implement.md)。

---

## Checks 摘要

重点检查项：

1. **明文边界**
   - 列表、summary、provider list、toast、日志都不能出现明文 key；
   - reveal 只允许单账号专用接口返回明文，且 `no-store`。

2. **兼容边界**
   - 旧单 key 用户可无损升级；
   - 回滚后仍可使用当前 active mirror；
   - 其它 API-key providers 与 OAuth 路径不回归。

3. **运行时一致性**
   - metadata 的 `activeAccountId` 与 `auth.json` active mirror 必须一致；
   - 激活后实际请求要切到新 key。

4. **删除语义**
   - 删除 active 且仍有剩余账号时，fallback 自动激活；
   - 删除最后一条时 provider 断开。

详情见 [checks.md](checks.md)。

---

## 主要风险

1. **明文回显泄漏风险**
   - 若 reveal 逻辑与列表逻辑混在一起，最容易把 secret 带进非预期响应或日志。
2. **legacy import 重复导入**
   - 若不做 `keyFingerprint` 幂等匹配，会生成重复账号。
3. **旧 DELETE 语义误伤**
   - 如果把旧 `/api/auth/api-key/[provider] DELETE` 粗暴映射成“删除全部账号”，风险很高。
4. **UI 门禁未过就开工**
   - 本任务的主要复杂度之一就在设置页信息结构与交互；跳过 HTML 原型很容易做错。
5. **`opencode` / `opencode-go` 混淆**
   - 两者同属 OpenCode 家族、环境变量名相同，但 v1 必须 provider 级隔离。

---

## 待你审批点

请主会话 / 用户明确批准以下事项：

1. **是否批准总体方案方向**
   - 多账号存储层独立维护；
   - 当前 active key 镜像回 `auth.json`；
   - 运行时继续复用现有 SDK auth 链路。

2. **是否批准 `apiKey` 回显定义**
   - 默认脱敏；
   - 主动 reveal；
   - 单账号明文接口；
   - 支持显式 copy；
   - 不做“页面加载即全部明文回显”。

3. **是否批准兼容策略**
   - 旧单 key 首次进入管理时幂等导入；
   - 回滚继续依赖 `auth.json` 当前 active key。

4. **是否批准范围控制**
   - v1 产品只对 `opencode-go` 开多账号 UI；
   - 底层服务层允许泛化，但不立即开放到其它 API-key providers。

5. **是否接受删除 active 的推荐语义**
   - 删除当前 active 且仍有剩余账号时，自动激活 fallback。

6. **审阅并批准已生成的 HTML 原型**
   - 我们已经补齐了 HTML 原型与 UI 交互说明。
   - 原型覆盖了全部边界条件及退回/切换交互逻辑，请求批准进入后续实现。

---

## 当前结论

**UI 原型已交付并与方案方向合并，待你一并审批方案方向与 UI 原型。**

如果你对目前的 HTML 交互设计、API 安全边界及自动回退机制均满意，批准后任务即可进入实现阶段。