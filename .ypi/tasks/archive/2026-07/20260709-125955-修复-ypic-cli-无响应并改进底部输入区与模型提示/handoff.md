# handoff

## 任务完成总结

**任务 ID:** 20260709-125955-修复-ypic-cli-无响应并改进底部输入区与模型提示  
**状态:** ✅ completed  
**检查结论:** Pass（checker 两轮验证通过，无 blocker）

---

## 用户原始问题

用户反馈 ypic CLI 存在三类问题：
1. `/model` 命令无响应
2. 普通输入（如"帮我看一下一级债动态表头的判定逻辑"）无响应
3. 启动提示不足 + 输入区体验差（需底部固定、分隔线、模型状态显示、`/model` 选择）

---

## 修复内容

### 核心修复

| 问题 | 根因 | 修复方案 |
|------|------|----------|
| `/model` 无响应 | `bin/ypic.js` 无 `/model` handler，未知 slash 被当 prompt 透传 | 实现完整 `/model` 命令：`current/list/<provider>/<modelId>/thinking/<level>` |
| 普通输入无响应 | CLI 缺少 sending/waiting/error 可见状态；`connectSse()` fire-and-forget 导致首条消息竞态 | SSE connected gate + 发送前立即显示 sending/waiting + 统一错误状态 |
| 启动提示不足 | 欢迎信息缺少 cwd/server/session/model 关键信息 | 增强 startup banner 显示完整上下文 |
| 输入区体验 | 历史输出与输入混在同一终端流 | 实现 `TerminalFrame`（TTY 底部固定）+ `PlainFrame`（fallback）双 frame 架构 |

### 架构改动

- **TerminalFrame**（TTY 模式，`frame.kind === "tty"`）：
  - ANSI alternate screen + 固定底栏
  - 分隔线、状态点（idle/busy/error）、右侧模型+thinking 显示
  - resize 自适应
- **PlainFrame**（fallback，`frame.kind === "plain"`）：
  - 非 TTY / NO_COLOR / YPIC_PLAIN 环境
  - readline 驱动，无 ANSI 污染
- **Frame 选择逻辑**：TTY 且 stdin/stdout 均为 TTY 且未设置 NO_COLOR/YPIC_PLAIN 时使用 TerminalFrame，否则 PlainFrame

### Checker 额外修复

- **PlainFrame close handler**：非 TTY positional 模式下 `readline` 的 `close` 事件会提前退出，导致 `node bin/ypic.js "hello"` 无法等待流式完成。修复为显式 `onClose` handler，仅在非 positional 模式下触发 quit。
- **`/model thinking` running 阻断**：agent running 时所有 `/model` 变体（包括 `/model thinking <level>`）应统一拒绝，避免中途改模型导致状态不一致。

---

## 改动文件清单

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `bin/ypic.js` | 核心修改 | +600 行：TerminalFrame/PlainFrame 双 frame 架构、`/model` 命令实现、SSE connected gate、发送状态反馈、模型状态同步 |
| `scripts/test-ypic-cli.mjs` | 测试扩展 | 53 tests（+11 新增）：覆盖 frame 选择、ANSI strip、visualWidth、PlainFrame 行为、close handler |
| `README.md` | 文档更新 | 新增 ypic CLI 章节：启动提示、`/model` 命令表格、TTY 底部输入区说明、降级兼容 |
| `docs/deployment/README.md` | 文档扩展 | 扩展 `ypic terminal chat` 章节：startup display、TTY bottom input area、plain fallback |
| `docs/architecture/overview.md` | 架构文档 | 新增 CLI 渲染抽象章节：TerminalFrame/PlainFrame 设计说明、布局规则、降级策略 |

---

## 验证结果

| 验证项 | 结果 |
|--------|------|
| `npm run lint` | ✅ 通过（无错误） |
| `node_modules/.bin/tsc --noEmit` | ✅ 通过（无错误） |
| `npm run test:ypic-cli` | ✅ 53 checks passed |
| `node bin/ypic.js --help` | ✅ 输出完整帮助，含 `/model` 命令 |
| UI 原型门禁 | ✅ 通过（用户已在 chat 中批准，服务端记录 approvalGrant） |

---

## 剩余手工验收（建议用户在本地执行）

1. **启动检查**：`npm run dev` → `node bin/ypic.js --port 30141` → 检查启动 banner、底部输入区、模型状态栏
2. **模型命令**：
   - `/model current` → 显示当前模型和 thinking
   - `/model list` → 列出可用模型，当前模型标注 `*`
   - `/model <provider>/<modelId>` → 切换后状态栏更新
   - `/model thinking <level>` → 切换后状态栏更新
3. **普通输入**：发送中文 prompt（如"帮我看一下一级债动态表头的判定逻辑"）→ 应出现 sending→waiting→streaming 输出
4. **中断控制**：`/abort` 在 running 时打断
5. **降级模式**：`YPIC_PLAIN=1 node bin/ypic.js --port 30141` → plain fallback 正常，无 ANSI 污染
6. **Positional 消息**：`node bin/ypic.js "hello" --port 30141` → positional message 正常流式输出

---

## 剩余风险

- **端到端依赖**：完整验收依赖本机 server/model/auth 配置，如遇模型/auth 问题应以 `/config` 指引提示而不是静默
- **IME 兼容性**：TTY raw-mode 下中文输入法/IME 可能存在兼容问题；遇到时建议 `YPIC_PLAIN=1` 降级
- **模型名称解析**：`/model` 以第一个 `/` 为 provider/modelId 分隔符，provider 或 modelId 包含空格时需用户手动引号处理；当前设计不覆盖此极端情况

---

## 决策记录

- **2026-07-09T05:00 UTC**：用户在 chat 中明确批准实现计划，触发 `awaiting_approval → implementing`
- **2026-07-09T06:30 UTC**：Checker 第一轮 verdict "Needs work"（UI 审批记录缺失）
- **2026-07-09T06:32 UTC**：更新 `ui.md` 和 `plan-review.md` 记录审批事实
- **2026-07-09T06:33 UTC**：Checker 第二轮 verdict "Pass"，无 blocker

---

## 交付状态

✅ **任务完成**  
✅ **检查通过**  
✅ **文档齐全**  
⚠️ **建议用户执行手工验收确认端到端行为**
