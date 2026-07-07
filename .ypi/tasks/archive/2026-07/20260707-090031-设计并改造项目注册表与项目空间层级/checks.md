# Checks

## 自动验证
- `npm run lint`
- `node_modules/.bin/tsc --noEmit`

## 手工验收
1. 空 registry 不扫描历史 sessions 生成项目，显示添加项目入口。
2. 注册普通项目 path 后生成 project + main space，刷新仍存在。
3. main space 新建 session 后 header/index 含 projectId/spaceId，并显示在该 space。
4. draft/Browser Share 预创建 session 也保留 project/space。
5. 旧 session 缺 projectId/spaceId 时 `GET /api/sessions/:id`、URL 打开、继续对话不报错，并显示未关联。
6. linked session fork 后继承 project/space；legacy session fork 仍 unassigned。
7. 已有 Git worktree 能作为项目子 space 出现；新建 WorkTree 后 registry 自动新增 space。
8. 删除/归档 WorkTree 后对应 space 标记 archived/missing，active sidebar 不显示。
9. 项目/space 昵称、tags、pin/archive 持久化并影响排序/显示。
10. 无 session 的新注册项目也能通过文件相关 API 访问。