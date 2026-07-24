# UI：Settings → GitHub 自动化 → 本机 App 凭据

## 门禁状态

- **触发 UI 原型门禁：是。** 本任务新增 secret 表单、私钥输入方式、来源状态、删除确认，并改变 Setup checklist 与 env 信息层级。
- **最终 HTML 原型**：[github-app-local-credentials.html](github-app-local-credentials.html)
- **草案备份**：[github-app-local-credentials-prototype.html](github-app-local-credentials-prototype.html)
- **交付状态**：UI 设计员已审阅并确认最终可交互 HTML；**待用户批准**后才能进入 implementing。
- **门禁结论**：HTML 原型已齐，不再因 UI 阻塞；实现前仍需用户批准本计划与原型。

## 设计目标

把当前“App 配置方式 = 复制环境变量名”的运维说明，改为普通用户可完成的一次性本机配置：

1. 主入口是 **本机 GitHub App 凭据**。
2. 用户可以填写 App ID、Webhook secret，并粘贴或选择 PEM。
3. 已保存字段只显示“已配置 / 来源”，不显示原值或 masked 片段。
4. env 移到折叠的高级区，并清楚表达 `env > 本机 > 未配置`。
5. 配置完成后继续沿用现有 checklist、仓库关联、模式、readiness、policy 与 jobs。

## 信息架构

```text
GitHub 自动化
├─ 页面说明 / 帮助 / 即时保存
├─ 主状态 banner
├─ 本机 GitHub App 凭据             # 新主卡
│  ├─ App ID / key / webhook 三列状态与来源
│  ├─ App ID + Webhook secret
│  ├─ 粘贴 PEM | 选择本机文件
│  └─ 保存到本机 / 移除本机凭据
├─ Setup checklist + 验证配置       # 文案改为设置页动作
├─ 高级：环境变量覆盖               # 从主路径降级
├─ 运行模式 / readiness
├─ 允许仓库 / policy
└─ jobs
```

## 主路径

1. 用户打开 Settings → GitHub 自动化。
2. 未配置时 banner 直接引导在本机凭据卡完成三项输入，不再要求 shell env。
3. 私钥默认“粘贴 PEM”，也可切到“选择本机文件”；两种输入互斥，切换时清理另一种临时值。
4. 点击“保存到本机”：表单 busy；服务端校验并落盘。
5. 成功后清空 Webhook secret、PEM、File input；三项显示“已配置 · 本机”。
6. 点击“验证配置”继续既有 App/install/permissions/assignee/allowlist/webhook checklist。
7. 以后轮换时输入新值；留空表示保留已保存本机值。
8. 如需清理，点击“移除本机凭据”，确认只删除 local fallback，不修改 env 或 GitHub 远端。

## 组件与交互

### 凭据状态

- 三项 status tile：`未配置 / 已配置 / 不可用`。
- source pill：`本机 / env / 未配置`。
- env 覆盖时不隐藏本机配置能力；提示“当前进程优先使用 env，本次保存更新 fallback”。
- local 损坏但 env 全覆盖：effective 可用，同时显示本机 fallback 需修复。

### App ID

- 数字输入，首次示例 placeholder。
- 已配置时为空，placeholder “留空则保留已配置 App ID”。
- 不回显现值。

### Webhook secret

- `type=password`、`autocomplete=new-password`。
- 不提供 reveal/copy/download/masked preview。
- 已配置时为空，placeholder “留空则保留已配置 secret”。
- 保存成功、删除、切 view、unmount 后清理。

### Private key

- 两段选择：`粘贴 PEM` / `选择本机文件`。
- 粘贴：monospace textarea，只显示本次输入。
- 文件：单文件 picker；不显示/保存原绝对路径，不用扩展名/MIME替代服务端解析。
- 已配置时两个输入都为空；不提供下载/reveal。

### 保存

- 主按钮“保存到本机”，不是全局 Settings Save。
- 首次保存需要三项完整；轮换允许只提供变更项。
- busy 时锁定表单与删除操作，`aria-busy=true`。
- 成功以后服务端 safe projection 为准，不以乐观 UI 冒充成功。

### 删除

AppPrompt danger confirm 固定表达：

> 只删除本机保存的 GitHub App 凭据。不会删除 GitHub App、installation、允许仓库、jobs，也不会修改环境变量。若 env 仍存在，当前进程可能继续显示已配置。

### env 高级区

- 默认折叠，标题“高级：环境变量覆盖”。
- 仅列 env 名与逐字段覆盖规则；不显示值。
- 面向 CI、容器、secret manager 和专业部署；明确普通本机用户无需配置。
- 可保留复制 env 名按钮，但不应出现在前三个 checklist 主 CTA。

## 状态矩阵

| 状态 | 主要呈现 | 可操作 |
| --- | --- | --- |
| 未配置 | 三项待配置；完整表单 | 保存到本机 |
| 本机已配置 | 三项“已配置 · 本机”；轮换输入为空 | 轮换、验证、移除 |
| env 全覆盖 | 三项“已配置 · env”；说明 local fallback | 更新 fallback、验证、移除 local |
| env/local 混合 | 每项独立来源；同 App 风险提示 | 补齐/轮换、验证 |
| local 损坏 | danger banner；不读取/显示内容 | 移除 local 后完整重配 |
| 保存中 | 表单 busy，防重复提交 | 等待 |
| 校验失败 | 字段级安全文案，不含输入 | 修正并重试 |
| 存储失败/锁超时 | 页面级错误；旧 server 状态仍生效 | 重试/刷新 |
| 删除确认 | danger alertdialog | 取消 / 确认移除 |
| 删除后 env 完整 | effective 仍 configured | 说明 env 仍接管 |
| 删除后无 env | 变回未配置 | 重新配置 |

最终 HTML 底部控制器覆盖：未配置、本机已配置、env 覆盖、本机损坏、保存中、保存失败、light/dark；保存和删除确认可交互。

## 响应式与可访问性

- 复用现有 card/button/field/pill 视觉语言，不新增第二套 Settings chrome。
- 桌面三项状态并排；≤640/700px 单列。
- label/input 明确关联；输入方式使用 button group/radio 等价语义。
- focus visible；modal 为 `alertdialog`、`aria-modal`，Escape/取消/确认和 focus restore 由生产 `AppPrompt` 提供。
- 状态必须含文字，不只依赖颜色；live region 只播报保存/删除/验证结果，不播报每次键入。
- reduced motion 禁止 shimmer/scan；长 env 名与错误码允许换行。

## UI 设计员任务书

UI 设计员应：

1. 读取 `components/GithubAutomationConfig.tsx` 现有卡片顺序和 `app/globals.css` `.github-automation-*` 样式。
2. 审阅 [github-app-local-credentials-prototype.html](github-app-local-credentials-prototype.html)，重点验证信息层级、轮换认知、env 覆盖表达和窄屏。
3. 最终 HTML 已交付：github-app-local-credentials.html；批准后按此实现生产 UI。
4. 覆盖状态矩阵、keyboard、dark/light、≤640px、reduced-motion。
5. 不引入 secret reveal、server path 输入、全局 Save 语义或 env-only 回退。
6. 在本 `ui.md` 记录最终原型路径与变更摘要，然后向用户请求批准。

## 用户审批记录

- 当前：**已请求 / 待批准**。
- 最终原型：[github-app-local-credentials.html](github-app-local-credentials.html)
- 交互对齐情况：
  - **新主卡位置**：置于 Checklist 之前，符合 PRD 的“设置页主路径”。
  - **无回显/无掩码**：已配置状态下输入框留空，提示“留空则保留...”，不显示任何历史值。
  - **私钥输入方式**：互斥的“粘贴 PEM”与“选择文件”，切换时互相清理，符合要求。
  - **env 降级展示**：折叠的“高级”面板只做说明，状态胶囊单独展示每个字段的 env 覆盖来源。
  - **危险删除操作**：需要显式的 `alertdialog` 二次确认，满足安全边界。
  - **组件与主题适配**：适配窄屏单列、深浅主题及减弱动画要求。

主会话/用户：请打开最终原型 [github-app-local-credentials.html](github-app-local-credentials.html) 确认以上交互；如果无需调整，请明确批准，然后转入 `implementing` 阶段。
