# PRD — Browser Share 服务地址配置与 debugger/CDP 模式

## 目标与背景

Browser Share 需要从“固定本机默认端口插件”增强为可连接用户指定 ypi web 服务地址的插件，并设计可选 Chrome debugger/CDP 模式，以便在用户明确授权后获得更细节的页面信息和更稳定的浏览器操作。

## 范围内

### 服务地址配置

- 插件 popup 提供“蛋黄派服务地址”配置入口。
- 默认值保持 `http://localhost:30141`。
- 支持 `http://127.0.0.1:<port>`、`http://localhost:<port>`、`http://<LAN IP>:<port>`、`https://<domain>`，以及可选 path 前缀（如反代在 `/ypi` 下时存储 `https://example.com/ypi`）。
- 保存前执行 URL 规范化和 `/api/browser-share/health` 连通性测试。
- 对非 loopback 或明文 HTTP LAN 地址显示安全提示。
- 新分享使用保存后的 base URL；已有 active share 使用创建时记录的 base URL，避免中途切换到错误服务。
- 插件 README 与校验脚本同步更新。

### debugger/CDP 模式

- 以显式 opt-in 的实验模式设计，不默认启用。
- 推荐保持标准插件不含 `debugger` 权限；如 Chrome 不支持 runtime optional debugger permission，则提供 debugger build/manifest 变体。
- debugger 模式只 attach 当前被用户分享的 tab，并在停止分享、切换地址、tab 关闭、命令完成后尽量 detach。
- 使用 CDP 增强快照：viewport、元素 bounds、AX role/name、frame/selector/debuggerRef 等受限字段。
- 使用 CDP 增强操作：导航等待、坐标点击、wheel scroll、文本输入；失败时回退 content-script 模式。
- 截图能力不自动纳入默认快照；若首版包含截图，必须单独 checkbox 或 ypi 侧一次性确认。

### ypi web 后端兼容

- 保持现有 API 路径不变。
- `/api/browser-share/health` 可扩展返回 version/capabilities，但旧插件只看 `res.ok` 时仍可工作。
- `POST /api/browser-share/shares` 可接受扩展 capabilities/captureMode/debugger state 等新字段，旧字段保持兼容。
- `BrowserSharePageSnapshot` 增加可选字段，不破坏现有工具读取 visibleText/elements。
- Agent tools 继续禁止 `shareId` 参数。

## 范围外

- 不把外部 Chrome 扩展纳入 ypi web npm/Next 构建。
- 不实现完整 ypi web 应用级登录/公网鉴权；如果用户把 ypi web 暴露到公网，应另立安全任务。
- 不让 ypi web/server 直接连接 Chrome remote-debugging-port。
- 不暴露 raw DOM/AX tree、cookies、localStorage、完整表单值给 agent。
- 不改变 share code 单次绑定机制。

## 需求与验收标准

| 编号 | 需求 | 验收标准 |
| --- | --- | --- |
| R1 | 插件可配置服务地址 | popup 能输入、保存、测试 base URL；默认 localhost 行为不变。 |
| R2 | 支持非默认端口/LAN/HTTPS 反代 | 使用自定义地址生成 share code、上传快照、轮询命令、回传结果均走该地址。 |
| R3 | 动态 host 权限安全 | 非默认 origin 需通过 Chrome runtime host permission 或明确 manifest/build 策略；不得为了便利默认加入 `<all_urls>` host_permissions。 |
| R4 | 地址切换不串服务 | active share 记录创建时 baseUrl；切换配置后需停止/重新分享或仅对下一次分享生效。 |
| R5 | debugger 模式 opt-in | 标准路径无 debugger；用户显式启用后才 attach 当前 tab，并显示风险文案和状态。 |
| R6 | CDP 快照受限 | `browser_share_snapshot` 在 debugger 模式下可看到 bounds/AX/viewport 等摘要，但没有 raw DOM/AX 和敏感字段值。 |
| R7 | CDP 操作兼容 | click/type/scroll/navigate 在 debugger 模式优先 CDP，失败回退现有 content-script/Chrome tabs 能力，仍遵守 readonly/interactive 审批矩阵。 |
| R8 | 截图受控 | 若实现 screenshot，必须单独 opt-in/审批，不能默认附加到所有快照。 |
| R9 | 文档与验证 | ypi web docs 与 extension README 更新；web lint/tsc 与 extension build 通过；完成手工矩阵验证。 |

## 未决问题

1. **debugger 权限发布方式**：采用单一插件直接加入 `debugger` 权限，还是保留标准插件并新增 debugger build/manifest？推荐后者。
2. **截图是否进入本轮**：推荐本轮先做 CDP 结构化快照/坐标能力，截图作为显式开关或后续子任务。
3. **远程 ypi web 安全承诺**：本任务是否只提示“自定义地址必须是可信内网/受保护反代”，还是同时做 Browser Share 局部 token？推荐不做局部 token，避免误以为保护了整个 ypi web。
