# Review：GitHub 自动化凭据产品化

**Task:** `20260724-173213-github-自动化凭据产品化-本机持久化-设置页配置-env-仅覆盖`  
**Role:** checker（独立验收，不轻信 implementer 自述）  
**Verdict:** **Pass**  
**Date:** 2026-07-24

---

## Summary

GHCRED-01…08 交付面与 PRD / Design / Checks / 批准 UI 主路径一致。离线强验收（store、env overlay、HMAC、token cache、API 契约、sentinel、docs local-first）均通过。未发现阻塞缺陷。真实 GitHub App + 公网 HTTPS live UAT 未执行，按 checks 标为 **pending / residual risk**，不伪造通过。

---

## Findings Fixed

None（检查阶段未改生产代码；无需小修）。

---

## Remaining Findings

### 非阻塞 / 已知风险

1. **真实 GitHub App + 公网 HTTPS UAT 未做**  
   无本轮批准的安全测试 App / 公网隧道。Offline：local HMAC 通过/错误签名 401、JWT、installation token cache 轮换、restart-import（子进程 + 空 `YPI_GITHUB_APP_*`）已覆盖。Live install / Recent Deliveries / 公网 ping 仍需 owner 提供非生产资源后补跑。

2. **管理 UI/API 仍无产品级鉴权**  
   本机凭据 API 扩大了“能访问 Settings/API 的主体可写 App 身份”的既有管理面风险。文档已要求：公网只代理 webhook；管理面本机/受控访问。属既有部署边界，非本任务回归引入的新阻塞。

3. **Lint 11 warnings（0 errors）**  
   均在无关路径（ChatMinimap、archive scripts、antigravity/grok transaction、model-prices test）；GitHub credentials 路径无新增 error/warning。

### 阻塞

None。

---

## 需求覆盖（对照 checks C1–C10）

| ID | 检查 | 结论 | 证据 |
| --- | --- | --- | --- |
| C1 | 设置一次 → 重启/新进程无 env → 仍 configured | **Pass（offline）** | `test-github-automation` GHCRED-06 restart-import；store 落盘 `credentials.v1.json` + generation PEM |
| C2 | 本机 Webhook secret HMAC | **Pass** | GHCRED-06 local HMAC pass + wrong signature fail |
| C3 | env 覆盖仍可用 | **Pass** | env-only 回归 + 逐字段 overlay / blank fallback / invalid-local masking |
| C4 | env 不是唯一入口 | **Pass** | UI 主卡「本机 GitHub App 凭据」+ CTA「保存到本机」；checklist 引导本机卡；docs setup §4 默认路径 |
| C5 | safe projection only | **Pass** | credentials route + `assertGithubAutomationProjectionSafe`；suite sentinel 扫描；projection 禁 secret 容器 |
| C6 | PEM paste / file 二选一 | **Pass** | UI 互斥 mode + route 同时提交 400 |
| C7 | 轮换清 installation token cache | **Pass** | PUT/DELETE 后 `clearGithubAppInstallationTokenCache()`；suite 覆盖 |
| C8 | DELETE 只清 local | **Pass** | confirm=`remove_local_credentials`；不触 env/config/jobs；env 完整时 effective 仍 configured |
| C9 | checklist/verify 主路径 | **Pass** | setup-verify 前三项「本机凭据」；verify sideEffects 仍 false / no-store |
| C10 | 文档 local-first | **Pass** | setup/deploy/ops/api/frontend/library/architecture/AGENTS；无“设置页故意不收密钥”陈旧结论 |

---

## 代码审查（关键路径）

### 1. env > local > missing

- `lib/github-app-credentials.ts`：`resolveEffectiveCredentialSnapshot()` 一次 local snapshot，App ID / key / webhook / slug 各自非空 env → local → missing；空白 env 不覆盖。
- 全 env 覆盖时 local invalid 不阻塞 effective `ready`（local summary 仍 invalid 供 UI 警告）。

### 2. Settings 可保存本机凭据

- `components/GithubAutomationConfig.tsx`：主卡在 checklist 前；App ID / password secret / PEM paste|file；FormData → `PUT /api/github-automation/credentials`；成功清 transient；删除 danger confirm。
- `app/api/github-automation/credentials/route.ts`：multipart allowlist、尺寸上限、paste/file 互斥、blank-preserve、no-store。

### 3. no-store / no reveal

- credentials / status / verify：`Cache-Control: no-store`。
- 响应只含 `configured` / readiness / has* / sources / local summary；无 App ID 原值、secret、PEM、path、fingerprint。
- UI 已配置态 placeholder「留空则保留…」，无 masked 回显、无下载。

### 4. blank-preserve / delete 只清 local

- Store upsert：省略/空白 preserve **仅 local**，注释与实现均禁止从 env 导入。
- 首次完整 bundle；unknown/future schema fail closed，普通 upsert 不覆盖。
- DELETE 固定 confirm；清 local + token cache；env 不受影响。

### 5. installation token cache invalidation

- `lib/github-app-client.ts` 导出 `clearGithubAppInstallationTokenCache()`。
- credentials route 在 durable PUT/DELETE **成功后**再 clear，再 build safe status。

### 6. Store 安全契约

- `lib/github-app-credential-store.ts`：generation PEM 先写再原子切 `credentials.v1.json`；0700/0600；process queue + mkdir lock；basename containment / 普通文件 / RSA / size / fingerprint；DELETE 不碰 config/jobs/deliveries。

### 7. Docs local-first

- `docs/integrations/github-app-automation-setup.md` 默认 Settings 本机凭据；env 仅 §9 高级覆盖。
- deploy / troubleshooting / modules / AGENTS 导航与 storage 路径已更新。
- 静态检索：无“设置页故意不接受密钥 / env 唯一入口”产品文案残留（ops 中 “env-only” 仅指旧 Links Client ID 排障，无关本功能）。

### 8. UI vs 批准 HTML

- 生产结构对齐 `github-app-local-credentials.html`：主卡位置、三列状态+来源、无回显、PEM 互斥、保存到本机、危险删除、高级 env 折叠、checklist 在后。
- 本轮未跑浏览器矩阵；结构/文案/状态机由源码对照 + CSS class 覆盖验收。完整 desktop/≤640px/dark/light/keyboard/reduced-motion 人工点检仍建议主会话抽检（非代码阻塞）。

---

## Verification

| Command | Result |
| --- | --- |
| `npm run lint` | **pass** — 0 errors, 11 pre-existing warnings（无关路径） |
| `node_modules/.bin/tsc --noEmit` | **pass** — exit 0 |
| `npm run test:github-automation` | **pass** — `76/76`（含 GHCRED-06 全块） |
| `npm run test:github-unattended` | **pass** — `17/17` |
| `npm run test:github-publish-policy` | **pass** — `23/23` |

### GHCRED-06 块覆盖（测试名）

- local store first-save permissions / generation / restart-import  
- partial rotation atomic generation / blank-preserve  
- env overlay matrix / blank fallback / invalid local masking  
- local webhook HMAC pass/fail + env secret override  
- installation token cache clear after rotation/delete  
- fail-closed malformed/future/symlink/oversize/non-RSA + concurrent upsert  
- credentials route GET/PUT/DELETE + sentinel isolation  
- setup/status source semantics；非凭据面干净  

---

## 对照 checks 总门禁

| 门禁 | 状态 |
| --- | --- |
| plan / UI 原型已进入实现且 8/8 done | 接受（任务已 implementing closeout；最终 HTML 存在） |
| 无 commit / push / merge（本 checker） | 遵守 |
| 离线强验收 | **通过** |
| 真实 GitHub UAT | **pending**（资源未批准） |
| 范围未漂移（无 secret 进 `/config`、Links、pi-web.json） | **通过** |

---

## Verdict

### **Pass**

**原因：**

1. 生产代码路径满足 env→local→missing、本机可配置、no-store/no-reveal、blank-preserve、DELETE 仅 local、token cache 失效、generation store fail-closed。  
2. 设置页主路径与文档 local-first 一致；env 为高级覆盖。  
3. lint / tsc / 三套 GitHub 聚焦测试全部通过。  
4. 剩余项仅为约定内的 live UAT 与既有管理面暴露风险，不构成实现阻塞。

### 建议主会话

1. **可 transition → `completed`**（由主会话执行）。  
2. 可选：在非生产测试 App + 公网 HTTPS 上补 C1 手工 live 矩阵（Settings 保存 → 真停 `ypi` → 无 env 重启 → status/verify → 签名 webhook → env override / delete 分支）。  
3. **不要**在本任务由 checker/implementer 自动 commit；提交另走 submit 流程。  
4. 工作区另有无关 untracked Studio task 目录与 `patch.md`，清理/提交时勿混入本任务。

---

## Artifacts

| Artifact | Action |
| --- | --- |
| `review.md` | **本文件（checker 产出）** |
| 生产代码 | 本轮 **未修改** |
| `handoff.md` | implementer 自述；本 review 独立复核后采纳其测试数字，并以上表为准 |
