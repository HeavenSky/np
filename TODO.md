# TODO

本仓库两个包的未决事项. 更新于 2026-10-04 22:02 +0800.

## 功能待办

- easy-np: `--lockfile-path` 支持 workspace, 使各 workspace 按 lockfile 还原各自版本, 与 `npm ci` 一致.
- easy-np: 回收 `.store` 中卸载或重装后不再被任何链接引用的 `<name>@<version>` 目录.
- easy-npd: 回收卸载或重装后不再被任何链接引用的 `node_modules/_name@version@name` 目录.

## 已知不足

- allowScripts: 没有 `deny-scripts` 命令, 拒绝要手写 `false` 条目; `approve-scripts` 把 tarball url 依赖当作 registry 包写入包名, url 依赖要手写 url 键; easy-np 的 `np-x rebuild <pkg>` 对未放行而被跳过的包仍打印 `rebuilt`.
- `np-lock.json` 只锁定 registry 包, git, 本地路径与 tarball url 依赖每次重新获取; workspace 下的锁文件读写只有单仓用例覆盖.
