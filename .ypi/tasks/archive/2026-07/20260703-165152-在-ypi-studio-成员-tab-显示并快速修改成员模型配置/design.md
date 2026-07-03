# 设计：在 YPI Studio 成员 tab 显示并快速修改成员模型配置

## 现状分析

- YPI Studio Members tab 目前只展示 `.ypi/agents/*.md` 成员职责、描述、文件路径和 Markdown 预览。
- 成员运行模型配置不在 `.ypi/agents`，而在本机 `~/.pi/agent/pi-web.json` 的 `studio` 配置中：
  - `studio.defaultPolicy`
  - `studio.members[memberId]`
- Settings 已有 Studio section，可配置默认策略与四个默认成员模型/thinking。
- `ypi_studio_subagent` 运行时已通过 `lib/ypi-studio-policy.ts` 按链路解析：`toolInput > memberConfig > defaultPolicy > followMain > piDefault`。
- AppShell 已加载 `/api/web-config` 到 `webConfig`，Settings 保存后会 reload。
- 当前 Settings modal 不支持从外部直接打开到 Studio section，也不支持定位某个成员行。
- `AgentCard` 当前是 `<button>`，如果要加“修改模型”按钮，需避免嵌套 button。

## 推荐方案

### 数据流 / API

不新增 API，复用现有：

- `GET /api/web-config`：读取 `PiWebConfig.studio`
- `PUT /api/web-config`：保存 Settings 修改
- `GET /api/studio/agents?cwd=...`：读取成员列表

数据流：

1. `AppShell` 继续加载 `webConfig`。
2. `AppShell` 将 `webConfig?.studio` 传给 `YpiStudioPanel`。
3. `YpiStudioPanel` 用 `agent.id` 查找：
   - `studio.members[agent.id]`
   - 不存在或 `unset` 时显示默认策略 fallback。
4. 点击“修改模型”：
   - `YpiStudioPanel` 调用 `onOpenStudioMemberSettings(agent)`。
   - `AppShell` 打开 `SettingsConfig`，传入：
     - `initialSection="studio"`
     - `studioFocusMember={ id, name }`
     - 可选 `studioFocusField="model"`
5. `SettingsConfig` 打开后自动切到 Studio section，并滚动/高亮对应成员配置行。
6. 用户保存后沿用现有 `PUT /api/web-config`；`AppShell.onConfigChange/onClose` reload webConfig，Members tab 自动刷新展示。

### UI 方案

#### Members tab 卡片

每个成员卡增加运行策略摘要：

- `模型：跟随主会话`
- `模型：Pi 默认`
- `模型：anthropic/claude-sonnet-4`
- `模型：使用默认策略 · 跟随主会话`
- `模型：配置加载中` / `模型配置不可用`

可附带：

- `thinking: inherit/high/...`
- `来源：成员配置 / 默认策略`

卡片右侧或底部增加 `修改模型` 按钮。

实现注意：将 `AgentCard` 从 `<button>` 改为 `<div role="button" tabIndex={0}>` 或其他非 button 容器，避免内部按钮嵌套；`修改模型` 点击 `stopPropagation()`，不改变当前选中成员。

#### Agent detail

在成员详情顶部增加“运行策略”小卡：

- 当前配置模型
- thinking
- 来源
- “修改模型”按钮

#### Settings modal

`SettingsConfig` 增加外部打开参数：

```ts
initialSection?: SettingsSection;
studioFocusMember?: { id: string; name?: string };
studioFocusField?: "model" | "thinking";
```

行为：

- 初始 section 使用 `initialSection ?? "yolk"`。
- 当 `initialSection === "studio"` 时立即加载 models。
- 如果 `studioFocusMember.id` 是默认成员，定位默认成员行。
- 如果是自定义成员，不在默认四成员内：
  - 在 Studio section 增加“当前项目成员”或“自定义成员”行。
  - 使用 `studio.members[id] ?? studio.defaultPolicy` 初始化显示。
  - 修改后写入 `studio.members[id]`。
- 高亮目标行一次，滚动到可见区域。

## 涉及文件

预计改动：

- `components/AppShell.tsx`
  - 保存 Settings 打开请求状态。
  - 向 `YpiStudioPanel` 传入 `studioConfig` 和打开 Settings 回调。
  - 向 `SettingsConfig` 传入初始 section / focused member。

- `components/YpiStudioPanel.tsx`
  - Members tab 显示成员模型策略。
  - AgentCard 支持“修改模型”按钮。
  - AgentDetail 展示运行策略。
  - 增加模型策略格式化 helper。

- `components/SettingsConfig.tsx`
  - 支持外部初始 section。
  - 支持定位 / 高亮 Studio member row。
  - 支持 focused custom member 配置行。

- `components/ModelSelect.tsx`（可选）
  - 若希望打开 Settings 后自动 focus 模型选择器，可增加 `autoFocus` 或 `autoOpen`；非必须。

- `docs/modules/frontend.md`
  - 更新 `YpiStudioPanel` 和 `SettingsConfig` 描述。

通常无需改动：

- `app/api/web-config/route.ts`
- `app/api/studio/agents/route.ts`
- `lib/pi-web-config.ts`
- `lib/ypi-studio-policy.ts`

## 边界情况

- 无 `cwd`：Members tab 本身为空，不展示模型操作。
- `/api/web-config` 加载失败：显示“模型配置不可用”，但仍可点击打开 Settings，让 Settings 自己加载并报错。
- 成员 id 重复：多个成员会指向同一个 `studio.members[id]` 配置，应按现有 `agent.id` 行为展示。
- 自定义成员：必须支持从 Members tab 点击后在 Settings 中出现对应配置行。
- `unset`：展示为“使用默认策略”，不要误显示为最终模型。
- Settings 保存未关闭：保存后 AppShell reload，关闭后 Members tab 展示更新。
- 不改变运行时解析优先级，不把模型写入 `.ypi/agents`。

## 实施步骤

1. 给 `SettingsConfig` 增加外部打开参数，支持初始 Studio section 与成员行高亮。
2. 在 `AppShell` 增加 `openStudioMemberSettings(agent)` 状态和传参。
3. 在 `YpiStudioPanel` 增加 `studioConfig` / `onOpenStudioMemberSettings` props。
4. 在 Members tab / AgentDetail 中显示模型策略摘要与“修改模型”入口。
5. 处理自定义成员在 Settings Studio section 的临时配置行。
6. 更新 `docs/modules/frontend.md`。
7. 跑验证：`npm run lint`、`node_modules/.bin/tsc --noEmit`。

## 待确认决策

1. 点击“修改模型”后：推荐先定位并高亮 Settings 的成员配置行，不自动展开 ModelSelect 下拉，减少焦点/弹层复杂度。
2. 自定义成员：推荐仅在从 Members tab 跳转时显示对应自定义成员配置行；Settings 常规入口保持默认成员配置，避免无 cwd 时加载项目成员列表。