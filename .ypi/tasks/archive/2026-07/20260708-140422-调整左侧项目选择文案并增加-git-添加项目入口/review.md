# review

## Checker verdict

通过，无 blocker。

## Verified

- `Choose project folder…` 已改为 `Add project folder…`
- 左侧新增 `Add project from Git…`
- Git 表单包含 `Local parent path` 与 `Remote repository`
- `Remote repository` 支持 `https://...` 与 `git@host:user/repo.git`
- Git 父目录选择只回填路径，不注册项目
- clone 成功后注册克隆得到的项目目录并选中 main space
- 失败时保留当前项目并显示错误
- `npm run lint` 与 `node_modules/.bin/tsc --noEmit` 通过

## Note

存在一条非阻塞 UX 备注：Git 表单打开时若直接点击某个项目空间，当前实现会关闭下拉，但不会立即清空 Git 表单状态；再次打开下拉可能看到保留的表单值。此问题不阻塞本次交付。