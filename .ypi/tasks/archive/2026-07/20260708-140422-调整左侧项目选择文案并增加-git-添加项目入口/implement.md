# Implement：建议执行计划

> 前置门禁：本任务触发 UI prototype gate。用户已更新需求，旧版 `ui-prototype.html` 只覆盖本地基准路径，必须先由 `ui-designer` 修订 HTML 原型并获得用户审批。

## 需先阅读的文件

1. `AGENTS.md`
2. `docs/modules/frontend.md`
3. `docs/modules/api.md`
4. `docs/standards/code-style.md`
5. `components/SessionSidebar.tsx`
6. `app/api/projects/select-directory/route.ts`
7. `app/api/projects/route.ts`
8. `lib/project-registry.ts`
9. `lib/project-registry-types.ts`

## 人类可读子任务表

| ID | Phase | Order | 标题 | 依赖 | 主要文件 | 验收 |
| --- | --- | ---: | --- | --- | --- | --- |
| UI-001 | prototype | 1 | 修订并审批左侧项目下拉 HTML 原型 | 无 | `ui.md`, `ui-prototype.html` 或 `ui-prototype-v2.html` | 原型覆盖固定 Git 文案、两个输入、目录按钮、clone busy/error/success 状态，并有用户审批记录。 |
| FE-001 | implement | 2 | 修改项目文件夹添加文案 | UI-001 | `components/SessionSidebar.tsx` | 不再出现 `Choose project folder…`；普通文件夹选择仍注册并选中项目 main space。 |
| FE-002 | implement | 3 | 新增 Git 表单展开态与两输入状态 | UI-001 | `components/SessionSidebar.tsx` | 点击 `Add project from Git…` 展开表单；包含 `Local parent path` 与 `Remote repository`；不改变当前项目；与手动路径表单互斥。 |
| API-001 | implement | 4 | 扩展目录选择 purpose | UI-001 | `app/api/projects/select-directory/route.ts`, `docs/modules/api.md` | 无 body 旧调用正常；`purpose: "git-parent"` 使用 Git 父目录提示；响应结构不变。 |
| API-002 | implement | 5 | 新增 Git clone 并注册项目接口 | UI-001 | `app/api/projects/git-clone/route.ts`, `lib/project-registry.ts`, `docs/modules/api.md` | 后端在父目录 clone 远程仓库，成功后注册 targetPath 并返回项目；错误码清晰；不使用 shell 拼接。 |
| FE-003 | implement | 6 | 接入 Git 父目录选择与 clone 提交 | FE-002, API-001, API-002 | `components/SessionSidebar.tsx` | 目录按钮只回填父目录；提交 clone 成功后选中返回 main space；失败不切换项目。 |
| DOC-001 | implement | 7 | 更新模块文档 | FE-001, FE-002, API-001, API-002, FE-003 | `docs/modules/frontend.md`, `docs/modules/api.md` | 文档描述 Git clone/register/select 闭环与 API 契约。 |
| CHECK-001 | check | 8 | 自动与人工验证 | FE-001, FE-002, API-001, API-002, FE-003, DOC-001 | 全部相关文件 | lint/type-check 通过；手工验证普通项目添加、Git clone 成功与主要错误态。 |

## 机器可读 Implementation Plan

```json ypi-implementation-plan
{
  "schemaVersion": 2,
  "subtasks": [
    {
      "id": "UI-001",
      "title": "修订并审批左侧项目下拉 HTML 原型",
      "phase": "prototype",
      "order": 1,
      "dependsOn": [],
      "files": [
        ".ypi/tasks/20260708-140422-调整左侧项目选择文案并增加-git-添加项目入口/ui.md",
        ".ypi/tasks/20260708-140422-调整左侧项目选择文案并增加-git-添加项目入口/ui-prototype.html"
      ],
      "instructions": "指派 ui-designer 基于现有 SessionSidebar 项目选择下拉修订 HTML 原型。必须覆盖 Add project folder…、固定 Git 入口 Add project from Git…、Local parent path、Remote repository、父目录选择按钮、Clone and add、busy/error/success/cancel 状态。旧原型只覆盖本地基准路径，不可直接进入实现。",
      "acceptance": "存在修订版 HTML 原型和明确用户审批记录；两输入布局、提交按钮文案、错误态和成功后选中 main space 结果说明被确认。",
      "validation": [
        "人工审阅修订版 ui-prototype.html 或 ui-prototype-v2.html",
        "确认 plan-review.md 记录修订原型审批状态"
      ],
      "risks": [
        "未修订原型导致实现仍按旧本地基准路径方案",
        "窄侧栏下两个输入与错误文案溢出"
      ],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "FE-001",
      "title": "修改项目文件夹添加文案",
      "phase": "implement",
      "order": 2,
      "dependsOn": ["UI-001"],
      "files": ["components/SessionSidebar.tsx"],
      "instructions": "将目录选择快捷入口的非 busy 文案从 Choose project folder… 改为 Add project folder…；同步检查同一组件内空态提示是否还引用旧文案。",
      "acceptance": "代码中无用户可见 Choose project folder…；普通文件夹选择仍注册并选中项目 main space。",
      "validation": [
        "rg \"Choose project folder\" components/SessionSidebar.tsx 应无结果",
        "手工点击 Add project folder… 成功选择并注册项目"
      ],
      "risks": ["误改 busy 文案或破坏现有注册流"],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "FE-002",
      "title": "新增 Git 表单展开态与两输入状态",
      "phase": "implement",
      "order": 3,
      "dependsOn": ["UI-001"],
      "files": ["components/SessionSidebar.tsx"],
      "instructions": "增加 gitAddOpen、gitParentPathValue、gitRemoteRepositoryValue、gitAddError、gitParentPickerBusy、gitCloneBusy、gitParentPathInputRef、gitRemoteRepositoryInputRef 等局部状态。添加 Git 菜单项，文案固定 Add project from Git…。点击后展开表单，两个输入标签固定为 Local parent path 与 Remote repository，并与 customPathOpen 互斥。关闭下拉、取消、Escape 时清理 Git 临时状态。",
      "acceptance": "Git 表单可展开/取消；不改变 selectedCwd、selectedProjectId、selectedSpaceId；不会与 Add project path 表单同时展开。",
      "validation": [
        "手工点击 Git 入口展开两输入表单",
        "手工切换到 Add project path 时 Git 表单关闭",
        "关闭下拉后临时状态清理"
      ],
      "risks": ["状态清理遗漏导致 stale path/repository", "窄侧栏布局溢出"],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "API-001",
      "title": "扩展目录选择 purpose",
      "phase": "implement",
      "order": 4,
      "dependsOn": ["UI-001"],
      "files": [
        "app/api/projects/select-directory/route.ts",
        "docs/modules/api.md"
      ],
      "instructions": "给 POST /api/projects/select-directory 增加兼容请求体 { purpose?: \"project\" | \"git-parent\" }。服务端只接受 enum 并映射固定 prompt/title，禁止任意 prompt 字符串进入 osascript/shell/PowerShell。旧无 body 调用默认 project。",
      "acceptance": "旧调用兼容；git-parent 调用返回结构不变；无 shell 注入面。",
      "validation": [
        "代码审查确认无 body 默认 project",
        "代码审查确认未拼接任意客户端 prompt"
      ],
      "risks": ["本地 OS picker 难以在 CI 自动验证", "prompt 字符串转义风险"],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "API-002",
      "title": "新增 Git clone 并注册项目接口",
      "phase": "implement",
      "order": 5,
      "dependsOn": ["UI-001"],
      "files": [
        "app/api/projects/git-clone/route.ts",
        "lib/project-registry.ts",
        "docs/modules/api.md"
      ],
      "instructions": "新增 POST /api/projects/git-clone，接收 { parentPath, remoteRepository }。校验父目录存在/是目录/可写，检查 git 可用；用 execFile 参数数组执行 git clone，不使用 shell 拼接；从远程地址推导仓库目录名并拒绝已存在目标目录；clone 成功后注册 targetPath 并 sync worktrees；返回 project/created/worktrees/clone。错误响应包含 error、code，注册失败时包含 clonedPath。",
      "acceptance": "成功 clone 后项目被注册并返回 main space；父目录无效、远程为空、git 不可用、目标存在、clone 失败、注册失败有清晰错误；无 shell 注入风险。",
      "validation": [
        "代码审查 execFile 调用不启用 shell",
        "手工用本地可访问仓库 URL clone 成功",
        "手工验证目标目录已存在时拒绝覆盖"
      ],
      "risks": ["私有仓库凭据交互导致 clone 挂起", "clone 时间超过请求超时", "clone 成功但注册失败留下目录"],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "FE-003",
      "title": "接入 Git 父目录选择与 clone 提交",
      "phase": "implement",
      "order": 6,
      "dependsOn": ["FE-002", "API-001", "API-002"],
      "files": ["components/SessionSidebar.tsx"],
      "instructions": "新增 handleGitParentDirectoryPicker 与 handleGitCloneSubmit。目录按钮调用 select-directory purpose=git-parent，成功后只 setGitParentPathValue。提交时校验两个输入非空，调用 /api/projects/git-clone，成功后像 registerAndSelectProjectPath 一样更新 projects 并选中 project.spaces.main；失败显示 gitAddError，不切换当前项目。",
      "acceptance": "选择父目录只回填输入；Clone and add 成功后选中新项目 main space；失败不调用普通父目录注册、不改变当前项目。",
      "validation": [
        "手工选择 Git 父目录后输入框回填且不发生 POST /api/projects",
        "手工 clone 成功后当前项目切换到新项目 main space",
        "手工 clone 失败后当前项目保持不变并显示错误"
      ],
      "risks": ["误复用普通目录 handler 导致父目录被注册", "busy 状态与普通目录选择状态串扰"],
      "parallelizable": false,
      "localReview": true
    },
    {
      "id": "DOC-001",
      "title": "更新模块文档",
      "phase": "implement",
      "order": 7,
      "dependsOn": ["FE-001", "FE-002", "API-001", "API-002", "FE-003"],
      "files": [
        "docs/modules/frontend.md",
        "docs/modules/api.md"
      ],
      "instructions": "更新 SessionSidebar 描述，记录 Git 添加入口支持填写 Local parent path/Remote repository、clone 成功后注册并选中 main space。同步更新 select-directory purpose 和 projects/git-clone route 契约。",
      "acceptance": "文档与实现一致，不过度承诺分支选择、凭据管理或进度流。",
      "validation": ["人工审阅文档 diff"],
      "risks": ["文档误写为已支持范围外 Git 能力"],
      "parallelizable": true,
      "localReview": true
    },
    {
      "id": "CHECK-001",
      "title": "自动与人工验证",
      "phase": "check",
      "order": 8,
      "dependsOn": ["FE-001", "FE-002", "API-001", "API-002", "FE-003", "DOC-001"],
      "files": [
        "components/SessionSidebar.tsx",
        "app/api/projects/select-directory/route.ts",
        "app/api/projects/git-clone/route.ts",
        "docs/modules/frontend.md",
        "docs/modules/api.md"
      ],
      "instructions": "运行 lint/type-check，并按 checks.md 完成人工浏览器/API 验证。重点确认普通项目添加仍走 /api/projects，Git 父目录选择不注册项目，clone 成功后注册 targetPath 并选中 main space。",
      "acceptance": "自动验证通过；人工验收项记录通过或明确剩余问题。",
      "validation": [
        "npm run lint",
        "node_modules/.bin/tsc --noEmit",
        "浏览器手工验证左侧项目下拉与 Git clone 流"
      ],
      "risks": ["本地系统目录选择器受运行环境限制", "网络/Git 凭据导致手工 clone 不稳定"],
      "parallelizable": false,
      "localReview": true
    }
  ],
  "execution": {
    "groups": [
      { "id": "gate", "subtasks": ["UI-001"], "parallel": false },
      { "id": "implementation", "subtasks": ["FE-001", "FE-002", "API-001", "API-002", "FE-003", "DOC-001"], "parallel": false },
      { "id": "verification", "subtasks": ["CHECK-001"], "parallel": false }
    ]
  }
}
```

## 验证命令

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

## 手工验证重点

1. 项目下拉打开后，旧文案 `Choose project folder…` 不再出现。
2. `Add project folder…` 选择目录后仍调用 `/api/projects` 注册项目，并选中返回 main space。
3. `Add project path…` 手动添加路径行为不变。
4. `Add project from Git…` 展开 Git 表单，包含 `Local parent path`、目录按钮、`Remote repository`。
5. Git 父目录按钮选择目录后只回填输入框，不调用 `/api/projects`，不切换当前项目。
6. 输入有效父目录和远程仓库后点击 `Clone and add`：后端 clone 成功，项目注册到 Project Registry，UI 选中返回 main space。
7. 父目录无效、远程为空、目标目录已存在、clone 失败、注册失败时展示错误且当前项目不变。
8. 外部点击、取消、Escape 会清理 Git 表单临时状态。

## 检查门禁

- 修订版 UI HTML 原型已审批。
- Git clone 后端不使用 shell 拼接远程地址或路径。
- 普通项目添加注册语义未回退。
- clone 成功后注册的是克隆得到的项目目录，不是父目录。
- lint/type-check 通过。
