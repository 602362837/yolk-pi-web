# IMP-002 修复计划

## 问题
用户在 30142 的指定 session 发送 `hi` 并收到回复，但独立 LLM 用量账本没有新增记录。

## 排查与修复范围
检查并验证：

1. 30142 进程使用的 agentDir 与账本目录是否一致；
2. recorder 是否被启用，以及写入失败是否被静默吞掉；
3. Chat 的 `message_end` 监听是否实际接收到 usage；
4. provider/model 是否能从当前调用上下文正确解析；
5. `/api/usage/calls` 查询是否读取同一账本；
6. 对当前 session 追加一次真实请求后，账本文件、API 返回和 UI 展示是否一致。

## 安全边界
不改变 LLM 请求参数和调用生命周期；保留旧 Usage；记录失败不能阻断聊天；不记录 prompt 或回复内容。

## 验证
使用用户提供的 session 和 30142 实测，补充定向测试，并运行 lint、tsc。