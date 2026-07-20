# Checks — IMP-001 Studio tag 注入预览

## 1. 需求覆盖

| 需求 | 检查 | 方式 |
| --- | --- | --- |
| R1–R2 默认干净 | 无注入 / 默认不展开 | 单测 + 人工 |
| R3–R7 点击预览 | button/aria/关闭/partial | 代码审 + 人工 |
| R8–R10 Copy 三源 | injection / raw / display | 代码审 + 人工 |
| R11–R13 parse blocks | 顺序/空/半截 | 自动单测 |
| R14–R16 不回退 L1/child/JSONL | extension diff 空 | 代码审 + `test:studio-extension-sci` |
| N1–N5 浮层/主题/截断 | 人工 + 截断单测 | 混合 |

## 2. 单元：parse blocks（扩展 message-display）

脚本：`npm run test:studio-message-display`

| # | 用例 | 期望 |
| --- | --- | --- |
| B1 | 无标签 | `injectionBlocks=[]`，`injectionText=""`；原 U1 仍过 |
| B2 | user + state | blocks 长度 1；`tag=ypi-studio-state`；raw 含开闭标签；display 仅用户句 |
| B3 | state + knowledge | 顺序 state→knowledge；injectionText 含两段 |
| B4 | 多 state | 两块都在；status 规则仍符合现网（首个 state 或现逻辑） |
| B5 | 半截开标签 | 不作为 complete block；confidence partial；若另有完整块则 blocks 仅完整者 |
| B6 | 字面 `ypi-studio-state` 无尖括号 | blocks 空 |
| B7 | first-reply / context 标签 | 可进 blocks |
| B8 | formatYpiStudioInjectionPreview 短文本 | truncated=false |
| B9 | preview > 64KiB | truncated=true；text 长度受控 |
| B10 | 回归 U1–U14 | 全绿 |

## 3. UI / 交互（人工为主）

| # | 用例 | 期望 |
| --- | --- | --- |
| I1 | 脏 session 点 tag | popover 打开，pre 含注入 |
| I2 | note 可见 | historical ≠ live system |
| I3 | Esc / outside / close / toggle | 关闭 |
| I4 | Copy injection | 剪贴板 = injectionText |
| I5 | Copy full raw | 剪贴板 = rawText |
| I6 | 气泡 Copy | 剪贴板 = displayText |
| I7 | 干净消息 | 无 tag |
| I8 | 新 SCI 消息 | 无 tag（能力边界） |
| I9 | partial 脏半截 | 无成功可点 tag |
| I10 | 键盘 Tab 到 tag，Enter 打开 | 可操作 |
| I11 | 明暗主题 | 对比度可接受 |
| I12 | 窄屏 | 面板不裁切主按钮 |
| I13 | 两条脏消息 | 打开 B 关闭 A（若实现互斥） |

## 4. 回归

| # | 场景 | 自动 | 人工 |
| --- | --- | --- | --- |
| G1 | L1 input continue / system prompt query | `test:studio-extension-sci` | — |
| G2 | 审批同轮 | `test:studio-dag` | 可选 |
| G3 | title strip 仍干净 | 既有 title 测 | — |
| G4 | widget 无改 | 无强制；勿改 widget 文件 | — |

## 5. 质量门禁

| 命令 | 必须 |
| --- | --- |
| `npm run test:studio-message-display` | 是 |
| `npm run test:studio-extension-sci` | 是 |
| `node_modules/.bin/tsc --noEmit` | 是 |
| `npm run lint` | 是（允许既有非本改动文件错误，同 SCI N2） |

## 6. Checker 重点

1. **能力边界文案**：面板是否写明 historical stripped，而非 live system  
2. **三 Copy 数据源** 不串  
3. **extension / buildMemberPrompt** 无行为 diff  
4. **showTag 条件** 未放宽到 partial  
5. **大文本** 展示截断不炸内存  

## 7. 手工验收脚本

1. 打开 SCI 前历史脏 session → 点 `Studio · …` → 见 state/knowledge 原文  
2. Copy injection → 粘贴编辑器核对  
3. 气泡 Copy → 仅用户句  
4. 新 session 发消息 → 无 tag  
5. Esc / 外侧关闭  
6. dark / 窄屏扫一眼  

## 8. 退出标准

- B1–B10 自动绿  
- I1–I12 关键人工通过或记录已知限制  
- 无 L1/子代理回退  
