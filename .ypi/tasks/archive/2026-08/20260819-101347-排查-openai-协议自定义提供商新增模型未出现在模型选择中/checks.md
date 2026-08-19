# Checks — custom provider/model 配置可见性

> **Checker remediation:** 除原矩阵外，本版把 R9/R10 existing-session 行为与 R11 sync coordinator import-failure 真值列为阻断项。源码正则、纯helper测试或“live函数未抛”均不能作为通过证据。

## 1. 需求覆盖矩阵

| 需求 | 自动检查 | 人工检查 |
| --- | --- | --- |
| R1 现有 provider 新 model | warm append + production commit notification | U1 |
| R2 新增整个 provider | warm whole-provider exact group/model | U2 |
| R3 新会话语义 | fresh session runtime + shared admin catalog双断言 | U2 |
| R4 auth gate | no-key/missing-env/literal/stored controls | U4 |
| R5 candidate语义验证 | missing baseUrl/empty id/invalid schema不写盘 | U5 |
| R6 refresh/reload分工 | refresh stale、reload/fresh可见 | 代码审查 |
| R7 generation race | late old init/refresh不回填 | — |
| R8 catalog fail closed | runtime error → 500；client last-good | U5 |
| R9 live切换 | actual wrapper stale session `set_model`一次exact reload/retry | U3 |
| R10 current稳定 | actual wrapper descriptor替换；reload/reconcile无setModel/model_change/default write | U3 |
| R11 writers一致 | direct/sync/price success-only；sync notifier import/reject不得假`ok` | — |
| R12 wire/性能 | client + performance + read-purity | U6 |

## 2. 修复前必须失败的核心复现

### F1 — 追加 model

1. 临时 agentDir 写入有效 `alpha/model-a` + fake literal key；
2. 预热 admin catalog；
3. 原子写入 `alpha/model-a + model-b`；
4. 只走当前 production catalog invalidate，不调用 test runtime reset；
5. 修复前 `model-b` 缺失；修复后可见。

### F2 — 新增整个 provider

1. 预热只含 `alpha` 的 admin catalog；
2. 写入完整 `beta`：`baseUrl`、`openai-completions`、literal key、`beta-model`；
3. 修复前：fresh session runtime `getModel(beta,beta-model)` 与 available均为真，但 shared catalog没有 beta；
4. 修复后：shared catalog与 selector都包含 beta group/model。

### F3 — false success

1. Direct PUT `broken` provider：有 api/key/model，但缺 baseUrl；
2. 当前实现返回200并写盘；fresh runtime `getError`有值、provider/model不存在；catalog仍返回200 missing；
3. 修复后 PUT 422、磁盘/revision/cache/live state均不变。

### F4 — Existing session行为证据缺失

1. 构造已在registry中的alive `AgentSessionWrapper`，其runtime在config reload前持有旧descriptor；
2. `reloadRpcModelsConfigState()` 后 exact descriptor替换，但`setModel`、settings defaults、`model_change` append均为0；
3. `send(set_model)` 首次exact miss时只`reloadConfig()`一次并重试同一identity；成功只执行一次正常`setModel`，第二次仍miss则保持原错且不产生写入；
4. 不接受仅检查源码中存在函数名/注释，必须实际执行wrapper行为。

### F5 — Sync import-failure false ok

1. 完成verified sync durable write，但令unified commit notifier动态import/执行失败；
2. 即使注入的live reload stub返回`ok`，admin generation/catalog epoch仍无完成证明；
3. 预期wire必须为`runtimeReload:"partial"`并带固定warning，绝不能`ok`；
4. notifier成功且`live.failed===0`才允许`ok`。

## 3. 自动测试点

### A. custom provider composition/auth

- A1 完整 literal-key provider：provider/model/available均存在；
- A2 stored auth provider同样 available；
- A3 no key：provider/model loaded，available=false；
- A4 missing env key：loaded，available=false；
- A5 missing baseUrl：composition error，provider/model absent；
- A6 empty model id/invalid schema：whole candidate被拒，不影响旧有效配置；
- A7 custom provider不需要 extension `registerProvider`；
- A8 fixed extension registration在 same-runtime `reloadConfig`后保留；fresh admin也重新注册。

### B. direct candidate/save

- B1 valid normalized candidate验证通过并按 revision写盘；
- B2 missing baseUrl 422 no-write；
- B3 empty id/invalid cost/compat 422 no-write；
- B4 candidate无 auth仍可合法保存；
- B5 semantic failure不改 backup/revision、不发 notification；
- B6 temp dir/file private且finally清理；
- B7 错误固定，不含 path/config/key/baseUrl/header/SDK原文；
- B8 verification network guard=0。

### C. admin runtime/catalog

- C1 warm append model后新 generation可见；
- C2 warm add provider后新 generation可见；
- C3 delete provider/model后不再投影；
- C4 name/thinking/baseUrl descriptor更新；
- C5 old init晚到不覆盖 fresh；
- C6 old refresh finally不删除 fresh pending；
- C7 invalidation后新请求不join old flight；
- C8不同 agentDir/modelsPath隔离；
- C9 runtime `getError` → route 500 safe code；
- C10 browser server error保留last-good；
- C11 recovery后新 success可发布；
- C12 fixed providers与warm performance不回退；
- C13 admin/verification network guard=0。

### D. new/existing session

- D1 fresh session runtime读取commit后的whole provider；
- D2新会话selector仍来自shared catalog，不能用session runtime假通过；
- D3 actual `AgentSessionWrapper.send(set_model)`首次miss → reload → 同一provider/id exact成功；
- D4 unknown model只reload一次/同一identity重试一次后仍报原错，无循环/fuzzy/fallback；
- D5 actual registry wrapper same-id current descriptor引用替换；
- D6 config reload/reconcile不调用`setModel`；
- D7 config reload/reconcile不写settings defaults/`model_change`，不改thinking；
- D8成功`set_model`只允许正常SDK `setModel`产生的一次`model_change`，retry/reconcile不得额外追加，默认model/thinking写入为0；
- D9删除current不自动fallback；
- D10单wrapper失败不阻断其他wrapper，summary计数准确；
- D11 auth reload仍是offline refresh；
- D12测试finally恢复`globalThis.__piSessions`、销毁wrapper/timer，不污染其他suite。

### E. writer gating

- E1 direct verified+written触发一次；
- E2 direct stale/parse/semantic/write fail不触发；
- E3 sync verified write触发，warm runtime exact model存在；
- E4 sync verification fail/rollback/skip不触发；
- E5 sync live失败为partial，不假报ok；
- E6 sync unified notifier import/reject/throw时为partial，即使live-only stub返回ok也不能提升；
- E7 sync只有notifier成功完成且`live.failed===0`才为ok；
- E8 sync skip/no-write不调用notifier；
- E9 price successful written触发；422/409/500/no-write不触发，必须给出专项测试证据；
- E10一个commit只有一个 admin/catalog notification owner。

### F. frontend/wire

- F1 Models close force refresh得到新payload；
- F2 stale browser response不能覆盖新generation；
- F3 server 500保留last-good；
- F4 success `modelList` provider/model/displayName语义不变；
- F5 ChatInput/ModelSelect不做custom过滤；
- F6无前端生产逻辑变更。

## 4. 验证命令

```bash
npm run test:web-model-runtime
npm run test:model-catalog-races
npm run test:model-catalog-performance
npm run test:model-catalog-read-purity
npm run test:model-catalog-client
npm run test:models-config-races
npm run test:models-config-sync
npm run test:model-prices
npm run test:session-model-pin
npm run lint
node_modules/.bin/tsc --noEmit
```

## 5. 人工 UAT

### U1 — Existing provider append model

1. 已有合法、已配置key的custom OpenAI provider；
2. 打开Chat模型选择器预热；
3. Models中追加唯一model id并保存、关闭；
4. 重新打开选择器搜索；
5. 预期：无需刷新页面/重启即可看到并选择。

### U2 — Add whole provider + New Chat

1. 预热catalog；
2. 新增provider，填写唯一name、合法Base URL、OpenAI API、fake/local key和model id；
3. 保存并关闭Models；
4. 打开New Chat选择器；
5. 预期：出现新provider分组和model；创建draft/发送后同一exact模型可用。

### U3 — Existing live session

1. 保存前打开普通Chat session；
2. 保存新增provider/model；
3. 在原session选择新增model；
4. 预期：成功，无`Model not found`；仅正常模型切换可产生一次`model_change`，reload/reconcile/retry不产生额外记录，settings默认model/thinking不变；
5. 自动化等价门槛：actual wrapper harness必须记录`reloadConfig=1`、同一exact lookup重试、`setModel=1`、额外`model_change=0`、default writes=0。

### U4 — No-auth control

1. 保存结构合法但无key/provider stored auth的provider；
2. 预期：保存可成功，但不进入available selector；
3. 配置literal/stored key并再次保存/刷新；
4. 预期：进入selector。

### U5 — Invalid save与last-good

1. 保持一个可见last-good catalog；
2. 尝试保存missing baseUrl或空model id；
3. 预期：现有footer错误区显示固定失败，旧配置与选择器保持；
4. 不出现“已保存”；不泄露path/key/config。

### U6 — No UI regression

检查provider分组、搜索、Enter/Escape、fallback label；无新按钮、toast、banner或布局变化。

## 6. 隐私/安全

- 所有测试只用临时目录与fake key；
- candidate temp为0700/0600并清理；
- 不输出raw config、key、baseUrl、headers、operator路径；
- `/api/models`错误仅固定`model_catalog_unavailable`；
- candidate/admin验证不访问远端模型端点；
- live测试启用`PI_OFFLINE=1`；不发inference。

## 7. 重点回归风险

1. old admin pending回填或删除new pending；
2. semantic verifier误把无auth当无效；
3. runtime.getError被200吞掉导致last-good清空；
4. fixed provider在fresh admin丢失；
5. live descriptor refresh写入model_change/defaults，或把正常`set_model`的一次记录与额外副作用混淆；
6. sync coordinator import失败后按live-only stub“未抛/ok”假报ok；
7. 为测试保留fallback而绕过admin generation/catalog notification；
8. 多writer重复generation/epoch owner；
9. temp candidate泄露secret；
10. config reload与active turn竞态；
11. 把新会话fresh runtime测试误当shared selector测试；
12. wrapper测试未清registry/timer导致进程挂起或跨case污染。

## 8. Checker 结论门槛

必须同时满足：whole-provider warm行为、append model、auth controls、semantic no-write、generation race、catalog 500+last-good、**actual existing-session wrapper exact切换/一次retry/side-effect计数**、**sync notifier import-failure为partial且只有完整commit成功可ok**、price success-only证据、writer gating、固定provider、离线/隐私、性能、lint/tsc和U1–U5。仅重启可见、前端重复fetch、test reset、源码正则、纯helper或只断言`reloadConfig`被调用均不算修复。
