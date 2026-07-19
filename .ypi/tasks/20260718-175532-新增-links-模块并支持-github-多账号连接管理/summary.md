# Summary — Links / GitHub 多账号 Device Flow

## 交付

Settings 新增 **Links** 模块；P0 通过 **GitHub OAuth Device Flow** 连接多个 GitHub 身份（点连接 → 设备码 → 官方页批准 → 本机安全存 token）。**无 PAT 粘贴主路径**；与 LLM auth 完全隔离。

## 关键能力

- Settings → Links →「连接 GitHub」
- 设备码 / 复制 / 打开 `github.com/login/device` / SSE 进度 / 多账号卡片 / 本机断开
- scope：`read:user`；server-only `YPI_LINKS_GITHUB_OAUTH_CLIENT_ID`；无 client secret
- 存储：`~/.pi/agent/links/`（0700/0600）；token 永不回前端

## 验证

- `npm run test:links`：**79 passed**
- Checker：**Pass**（修复 persist 注册竞态、starting 取消、SSE 终态错误展示）
- 残留：需配置真实 OAuth client id 后做 live UAT

## 使用前置

```bash
export YPI_LINKS_GITHUB_OAUTH_CLIENT_ID=<product-owned-oauth-app-with-device-flow>
```
