# TODO

本仓库两个包的未决事项. 更新于 2026-10-06 16:30 +0800.

## 已知不足

- allowScripts: 没有 `deny-scripts` 命令, 拒绝要手写 `false` 条目; `approve-scripts` 把 tarball url 依赖当作 registry 包写入包名, url 依赖要手写 url 键; easy-np 的 `np-x rebuild <pkg>` 对未放行而被跳过的包仍打印 `rebuilt`.
