# Brief

## 用户目标

研究 Trellis 的任务归档与知识沉淀机制，并为 YPI Studio 设计/实现对应能力：

- 工作室任务支持归档；
- 归档时生成可复用的知识沉淀；
- 后续工作室任务启动或成员执行时能读取已沉淀知识。

## 初步研究结论

详见 `research/trellis-archive-knowledge.md`。

核心参考：Trellis 使用 `.trellis/tasks/archive/<YYYY-MM>/` 移动任务目录归档；长期知识不主要沉在任务目录，而是通过 `trellis-update-spec` 写入 `.trellis/spec/`，再由后续 `trellis-before-dev` 读取。

## 初步方案方向

YPI Studio 可采用：

- `.ypi/tasks/archive/<YYYY-MM>/<task-id>/` 保存归档任务；
- `.ypi/knowledge/` 保存长期知识沉淀；
- `.ypi/knowledge/index.json` 提供后续任务注入上下文的索引；
- 扩展 `ypi_studio_task`、Studio API 与 Studio Panel UI 支持 archive / archived list / knowledge injection。
