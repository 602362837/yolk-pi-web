# Summary

已完成左侧 session 列表偶发缓慢的代码级根因分析和实施规划，未修改生产代码。

核心结论：project-space 专用 route 仍对所有 active session 执行 `SessionManager.listAll()`、逐文件 header 读取和 Studio task 投影；已有 project-session index 未用于读取且当前覆盖不完整。前端刷新和 projects state 更新会重复触发 sessions 请求，token 只防旧响应写入，不会取消服务端扫描。列表树渲染目前不是首要瓶颈。

推荐按“阶段计时 -> 前端去重/abort -> 服务端 single-flight 与文件级增量缓存 -> index 候选校验/backfill -> 基准和回归测试”实施。保持现有 UI 行为，因此当前不触发 HTML 原型门禁；任何加载体验改版都必须重新派发 UI 设计员并审批。
