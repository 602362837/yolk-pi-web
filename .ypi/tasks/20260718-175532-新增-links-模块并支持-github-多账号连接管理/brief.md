# Brief：Links 模块与 GitHub 多账号交互式授权

## 目标

在 yolk pi web 的 Settings 中新增独立 **Links** 模块，让终端用户通过 GitHub 的交互式授权流程连接多个 GitHub 身份。用户只需点击“连接 GitHub”、在 GitHub 官方页面输入设备码并批准授权；服务端获得 OAuth access token 后安全保存，浏览器只显示身份、最近验证状态与已授予 scopes，永不显示或要求用户复制 secret。

## 对上一版计划的纠正

用户此前说“这个阶段不需要 OAuth App”，上一版被错误理解成“不要任何 OAuth，因此让用户手工创建并粘贴 PAT”。用户真实意图是：**不要让终端用户自己创建、复制、粘贴 token，而应走一遍 GitHub 授权。**

这里必须区分两个概念：

- **OAuth App / GitHub App 是产品用于发起授权的应用身份**，由产品方或部署方创建和配置。
- **access token 是授权完成后 GitHub 发给服务端的用户凭据**，终端用户不应手工填写，前端也不应看到。

因此“用户不需要创建 OAuth App”不等于“产品不使用 OAuth”。本次修订明确采用产品提供的 GitHub OAuth App 发起授权。

## P0 已选方案

- 主方案：**B. GitHub OAuth Device Flow**。
- 应用身份：**产品方拥有的 GitHub OAuth App**，启用 Device Flow。
- client 配置：后端从 server-only `YPI_LINKS_GITHUB_OAUTH_CLIENT_ID` 读取；官方构建/部署注入产品 client id，源码开发者可用自己的 OAuth App 覆盖。client id 不是 secret，但不把配置入口暴露为终端用户表单。
- client secret：Device Flow 不需要，P0 不配置、不打包、不下发 client secret。
- scopes：P0 只请求 `read:user`，不请求 `repo`、`workflow`、组织管理等仓库权限。
- PAT：**完全移出 P0**；不提供隐藏的主路径或默认表单。未来若增加高级 PAT fallback，必须重新审批独立安全与 UI 方案。

Device Flow 适合本机 Next 服务：不需要回调端口、PKCE、`127.0.0.1` listener 或粘贴 redirect URL；用户可以在同机或另一台设备的浏览器完成 GitHub 授权。服务端按 GitHub 返回的 polling interval 轮询 token endpoint。

## 范围内

- Settings 左侧新增 root-level `Links` 页面。
- GitHub 连接：开始授权、展示设备码、打开 GitHub 官方验证页、授权进度、成功/失败/过期/取消。
- 多账号活动连接列表：label、login、GitHub numeric user id、最近验证时间、状态、requested/granted scopes。
- 同一 GitHub identity 重复连接返回 `409 duplicate_identity`，不静默替换现有本机 token。
- 断开：删除本机活动 OAuth secret、metadata soft-delete、活动列表移除。
- Links 与 LLM auth 完全隔离。

## 范围外

- 手填 PAT、token reveal/copy/import。
- GitHub OAuth web callback、loopback listener、手工粘贴 callback URL。
- GitHub App 安装、仓库授权选择、installation token。
- `gh auth login` 调用或导入本机 gh 凭据。
- clone、repo/org 列表、PR、Issue、Actions、权限引擎、运行时账号选择或 failover。
- 本机断开时自动撤销 GitHub 远端授权；P0 仅删除本机 secret，并引导用户按需前往 GitHub Authorized OAuth Apps 撤销。

## 成功定义

用户无需创建 PAT 或 OAuth App，即可点击连接、在 GitHub 官方页面完成授权，并在 Links 中同时看到至少两个不同 GitHub 身份。access token、device_code 与上游原始错误不会出现在 API 响应、DOM、日志、metadata、toast 或任务/session JSONL；断开后活动 secret 被删除且连接从活动列表消失。

## 实施前置条件

产品所有者需在实现/UAT 前提供一个已启用 Device Flow 的 GitHub OAuth App client id，并决定官方发布时的注入方式。缺少配置时，UI 只能显示安全的“GitHub 授权尚未配置”，不能退回 PAT 表单。