# TODO

本仓库 `packages/easy-np` 与 `packages/easy-npd` 两个包的待办与决策; 在新 session 接手本仓库的改动前读本页. 更新于 2026-10-02 23:36 +0800.

## 当前状态

- 本地 `main` 跟踪 `origin/main`; GitHub 默认分支是 `main`, `master` 已删除, 远端另有上游的 `1.x`..`6.x`. `7fb7fed` 的 CI 已在 GitHub 上通过.
- npm 上两个包的 0.0.0 发布于 2026-09-29, 内容与 `7fb7fed` 一致; 0.0.1(bin 入口修复与测试环境隔离)的版本号与 CHANGELOG 已改好, 尚未提交与发布.
- 测试进程启动时由各包 `test/.mocha-global.js` 清掉继承的 `np_cache`, `npm_config_*` 等变量, 并把 HOME 指向 `test/fixtures/.home`(已忽略, 跨次保留, 首轮需重新下载缓存).
- 2026-10-02 在 0.0.1 工作区上两个包各跑一次并行全量, 全部通过且无 pending: Node v26.10.0 下 easy-np 298 例, easy-npd 270 例; Node v20.20.2 下 easy-np 299 例, easy-npd 270 例; 单包墙钟约 2 分钟.
- 两个包的 `npm run lint`(oxlint)零警告, `npm run fmt:check`(oxfmt)通过.

## 用户已定的决策

- 两个包在同一仓库维护, 不做公共代码抽象; 只统一文档, 脚本名(`test`, `test-cov`, `lint`, `fmt`, `fmt:check`)与 lint / fmt 配置.
- 只保留 `main` 分支.
- 两个包共用磁盘缓存 `~/.np_tarball`, 缓存相关的配置参数, 默认值与路径尽可能一致; 约束写在根 `README.md`, 改动缓存布局时两个包同步修改.
- 0.0.1 在 2026-10-02 发布.

## 待办

- [ ] 发布两个包的 0.0.1: 提交并推送后, `npm login` 再在 `packages/easy-np` 与 `packages/easy-npd` 各执行一次 `npm publish`; 打包清单已用 `npm pack --dry-run` 核对.
