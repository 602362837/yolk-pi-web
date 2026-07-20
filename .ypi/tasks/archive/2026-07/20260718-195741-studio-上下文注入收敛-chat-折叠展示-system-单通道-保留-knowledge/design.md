# Design — Studio Context Integrity（SCI）

## 1. 方案摘要

将 Studio 主会话上下文从 **user transform + system 双注入** 收敛为：

```
input:  副作用 only（审批 grant）→ continue（user JSONL 干净）
before_agent_start: 唯一注入 → systemPrompt += startup?(once) + buildStudioState(root, key, event.prompt) + rule
Chat L0: 纯函数 strip 历史脏 user 文本 → 干净气泡 + compact status tag
Child:  buildMemberPrompt 不变
```

核心原则：**写入干净、展示剥离、模型侧 system 单通道刷新、能力不回退。**

## 2. 现状数据流（AS-IS）

```
User types text
  → pi.on("input")
      → recordYpiStudioUserApproval(root, key, text)   // keep
      → transform text = user + "\n\n" + buildStudioState(root, key, text)  // pollutes JSONL
  → agent run
  → pi.on("before_agent_start")
      → systemPrompt = base + startup?(once) + buildStudioState(root, key)  // NO query
      → LLM sees state twice (user + system); knowledge query only on user side
  → Chat renders full user JSONL content (injection visible)
```

证据：

- `lib/ypi-studio-extension.ts` ~2783–2809
- `buildStudioState` ~303–351（tags: `ypi-studio-state` + nested/adjacent knowledge via `getYpiStudioKnowledgeContextForPrompt` → `ypi-studio-knowledge`）
- `startupContext` ~353–366（`ypi-studio-context` + knowledge + `ypi-studio-first-reply`）
- SDK: `docs/extensions.md` `before_agent_start.event.prompt` / `input` actions

## 3. 目标数据流（TO-BE）

```
User types text
  → pi.on("input")
      → recordYpiStudioUserApproval(root, key, text)
      → { action: "continue" }   // no transform
  → JSONL user message = clean user text
  → pi.on("before_agent_start")
      → promptQuery = event.prompt ?? ""
      → systemPrompt = base
          + (first time for key ? startupContextWithoutKnowledge : "")
          + buildStudioState(root, key, promptQuery)
          + orchestration rule
  → LLM sees latest state + knowledge(query=prompt) once per turn on system
  → Chat UserMessageView:
      → parse/strip known tags from content
      → render clean markdown + optional Studio tag
      → Copy/Edit use clean text (fallback full)
```

## 4. 影响模块与边界

| 模块 | 改动 | 边界 |
| --- | --- | --- |
| `lib/ypi-studio-message-display.ts`（**新建**） | strip/parse 纯函数 + status 提取 + 标签常量 | 无 IO；可被 UI 与 title 复用 |
| `lib/ypi-studio-extension.ts` | input continue；before_agent_start 带 prompt；startup 去重 | 不改 tools/commands/buildMemberPrompt |
| `components/MessageView.tsx` | `UserMessageView` 使用 strip 结果 | 仅 user 消息；assistant/tool 不动 |
| `app/globals.css` | compact tag 样式 | 复用 badge/chip 视觉语言 |
| `lib/session-title.ts` | 可选：seed/display 前 strip | 不改 session 文件 |
| `hooks/useAgentSession.ts` | **默认不改**（客户端发送本就干净） | 若未来乐观路径会拼注入再改 |
| `lib/ypi-studio-tasks.ts` | **不改**审批/knowledge API 语义 | 仅被 extension 以新参数调用 |
| 子代理 runner | **不改** | child 跳过主 extension |
| 历史 JSONL | **不改写** | 仅读时 strip |

## 5. 契约设计

### 5.1 已知注入标签（L0 strip 白名单）

| Tag | 来源 | strip |
| --- | --- | --- |
| `ypi-studio-state` | `buildStudioState` | 是 |
| `ypi-studio-knowledge` | `getYpiStudioKnowledgeContextForPrompt` | 是 |
| `ypi-studio-context` | `startupContext`（若误入 user 极少见；防御性） | 是 |
| `ypi-studio-first-reply` | `FIRST_REPLY_NOTICE` | 是 |

规则：

- 匹配完整块：`<tag>…</tag>`，允许跨行；大小写敏感（与现网一致小写）
- 连续多块、块间空白一并清理
- 用户正文中的**字面相似但非完整标签**（如 `` `ypi-studio-state` `` 或未闭合半截）**不得误删**正文；半截标签：保守策略 = **不 strip 整条**（fail closed on safety of user text = fail open display full）或仅 strip 完整块。**推荐：只移除完整闭合块；半截保留在正文，且若检测到半截则 `confidence: "partial"`，UI 仍可显示 tag 但 Copy 用“完整块已剥、半截保留”的结果**
- 不使用广义 HTML sanitizer，避免误伤用户 HTML 代码块（用户消息走 Markdown）

### 5.2 纯函数 API（建议）

```ts
export type YpiStudioInjectionStatus =
  | "no_task"
  | "intake" | "planning" | "awaiting_approval" | "implementing"
  | "checking" | "review" | "user_acceptance" | "waiting_for_improvements"
  | "completed" | "cancelled" | "failed"
  | "context"   // generic fallback
  | "unknown";

export interface YpiStudioUserDisplayContent {
  /** Text for bubble / copy / edit */
  displayText: string;
  /** Original input */
  rawText: string;
  /** True if any complete injection block removed */
  hadInjection: boolean;
  /** Parsed from state block when possible */
  studioStatus: YpiStudioInjectionStatus | null;
  /** full | partial | none */
  stripConfidence: "full" | "partial" | "none";
}

export function parseYpiStudioUserMessage(raw: string): YpiStudioUserDisplayContent;
export function stripYpiStudioInjections(raw: string): string; // convenience → displayText
export function formatYpiStudioMessageTag(status: YpiStudioInjectionStatus | null): string;
// → "Studio · implementing" / "Studio · no_task" / "Studio · context"
```

Status 解析：

1. 在 state 块内匹配 `Status: no_task` → `no_task`
2. 匹配 `Task: <id> (<status>)` → 取括号 status
3. 否则若有任何 studio 注入块 → `context`
4. 无注入 → `studioStatus = null`，不显示 tag

### 5.3 Extension 行为契约

**input**

```ts
pi.on("input", (event, ctx) => {
  const key = getKey(event, ctx);
  const ev = event as { text?: string };
  if (typeof ev.text !== "string" || !ev.text.trim()) return { action: "continue" };
  try { recordYpiStudioUserApproval(root, key, ev.text); } catch { /* best-effort */ }
  return { action: "continue" }; // NO transform
});
```

注意：

- 不区分 `event.source`（interactive/rpc/extension）——continuation 的 `sendUserMessage` 也不应被拼 state
- 空文本 continue
- 审批仍基于**用户原文**（与现网一致；transform 前后原文相同用于 approval regex）

**before_agent_start**

```ts
pi.on("before_agent_start", (event, ctx) => {
  const key = getKey(event, ctx);
  const cur = event.systemPrompt ?? "";
  const prompt = typeof event.prompt === "string" ? event.prompt : "";
  const startup = startupKeys.has(key) ? "" : startupContext(root); // see de-dupe
  startupKeys.add(key);
  return {
    systemPrompt: [
      cur,
      startup,
      buildStudioState(root, key, prompt),
      "YPI Studio rule: the main session must orchestrate task state. For member work, call ypi_studio_subagent instead of pretending to be that member.",
    ].filter(Boolean).join("\n\n"),
  };
});
```

**startup 去重（推荐默认 Q2）**

- `startupContext` **移除**内部 `getYpiStudioKnowledgeContextForPrompt` 调用
- 保留：`ypi-studio-context` 编排说明、`PLAN_REVIEW`/`UI_PROTOTYPE` 提示、`FIRST_REPLY_NOTICE`、Workspace
- 每轮 knowledge 只出现在 `buildStudioState` 尾部，query 为 `event.prompt`（no_task 时 fallback `"recent studio task knowledge"` 保持现网）

**不要**改用 `return { message: { display:false } }` 作为 L1 主路径（L2 选项）：session 持久化语义不同，回归面更大。

### 5.4 UI 契约

`UserMessageView`：

1. `raw =` 现有 content 拼接逻辑
2. `parsed = parseYpiStudioUserMessage(raw)`
3. 气泡正文：`parsed.displayText`（空且无图时可仍只显示图）
4. 若 `parsed.hadInjection && parsed.studioStatus`：在气泡行上方/外侧渲染 tag `formatYpiStudioMessageTag(...)`
5. Copy / Edit：`parsed.displayText`；若 `stripConfidence === "none" && hadInjection` 不可能；若 parse 抛错 catch → raw

乐观消息：客户端 `message` 本就无注入 → 无 tag，行为不变。

### 5.5 标题契约

`sessionTitleSeedFromUserMessage`：

```ts
export function sessionTitleSeedFromUserMessage(message: string): string {
  const cleaned = stripYpiStudioInjections(message);
  return truncateSessionTitle(cleaned) || PENDING_SESSION_TITLE;
}
```

避免历史/异常路径把 `<ypi-studio-state>` 写进侧栏标题。`displayTitleForSession` 对 `firstMessage` 同样可 strip（只影响展示）。

## 6. Knowledge 相关性证明

| 场景 | 现网 query | SCI query | 结论 |
| --- | --- | --- | --- |
| 主会话每轮 | input transform 内 `ev.text` | `event.prompt`（SDK：用户 prompt） | 对齐；skill/template 扩展后 prompt 可能更完整 → **≥ 现网** |
| no_task | `ev.text` 或 fallback recent | `event.prompt` 或 fallback recent | 对齐 |
| 子代理 | `buildMemberPrompt` 内 task+member+delegated | 不变 | 不回退 |
| startup 首轮 | startup knowledge(无用户 query) + user-side knowledge | 仅 per-turn buildStudioState(prompt) | 去掉无 query 的重复块；**不弱于**有效 knowledge |

## 7. 兼容性

| 项 | 策略 |
| --- | --- |
| 历史脏 JSONL | L0 渲染 strip；不迁移 |
| 旧 session 双注入记忆 | LLM 历史 user 仍含注入（模型仍可见历史脏 user）；新轮 system 单通道。可选 L2：context hook 清洗历史——**本交付不做** |
| 扩展 API | 仅改变 handler 返回值；无 settings schema 变更 |
| 外部依赖 Pi SDK | 使用已文档化的 `event.prompt`；若类型未暴露则 cast（与现 `systemPrompt` cast 一致） |

## 8. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 去掉 user 注入后模型“看不到”状态 | 编排失败 | system 每轮强制注入；checks 回归 no_task / awaiting_approval / implementing |
| `event.prompt` 与 input text 在 transform 链后不一致 | knowledge 偏差 | L1 后无 Studio transform；记录 SDK 顺序：input → skill/template → before_agent_start |
| 用户正文含完整伪造标签 | 被 strip | 可接受边缘；文档说明；partial 策略不删半截 |
| 审批依赖 transform 后文本 | grant 失败 | 审批用原始 `ev.text`，与现网一致 |
| startup 去 knowledge 导致首轮弱 | 首答缺知识 | 首轮仍有 `buildStudioState(prompt)` knowledge |
| UI tag 破坏气泡布局 | 视觉回归 | HTML 原型 + CSS 变量；窄屏检查 |
| 历史 messages 仍占 context token | 成本 | L2；本交付接受 |

## 9. 回滚

1. **代码回滚**：恢复 `input` transform 与 `before_agent_start` 无 query 调用；移除 UI strip（或 feature flag，L0 可不加 flag 以降低复杂度——回滚靠 git）
2. **无需数据回滚**：未改 JSONL / task store
3. **部分回滚**：可只回滚 L1 保留 L0（展示仍干净但新消息又变脏）——不推荐长期

## 10. L2 边界（非本交付）

- no_task 轻量 state
- `display:false` custom message 注入
- context 事件清洗历史 user
- 点击 tag 展开原始注入
- knowledge token 动态预算

## 11. 文档更新点

- `docs/modules/library.md` — 新模块与 extension 注入策略
- `docs/modules/frontend.md` — UserMessageView Studio tag
- `docs/architecture/overview.md` — Studio context integrity 简述（若 overview 已有 studio 段则补一段）

## 12. 测试设计要点

见 [checks.md](checks.md)。自动化优先：

- 新建 `scripts/test-ypi-studio-message-display.mjs`（或扩展现有 studio 测试）测纯函数
- 新建/扩展 extension 行为测：mock `buildStudioState` 输入参数含 prompt；input 返回 continue
- 保留 `npm run test:studio-dag` 等既有套件防审批回归
