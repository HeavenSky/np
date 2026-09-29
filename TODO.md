# TODO

本仓库 `packages/easy-np` 与 `packages/easy-npd` 两个包的待办与决策; 在新 session 接手本仓库的改动前读本页. 更新于 2026-09-29 11:04 +0800.

## 当前状态

- 本地只有 `main` 一个分支, 未推送, 不跟踪任何上游; 历史查法见根 `README.md` 的「历史」一节.
- 远端 `origin`(HeavenSky/np)只剩上游的 `master` 与 `1.x`..`6.x`, 默认分支是 `master`; 用户决定暂不删除 `master`. 合仓后的内容从未推送, 根目录 `.github/workflows/ci.yml` 从未在 GitHub 上运行过.
- 2026-09-29 在 `3e70f02` 上两个包各跑一次并行全量, 全部通过且无 pending: easy-npd 245 例, 墙钟 91s; easy-np 276 例, 墙钟 110s. 最慢的文件是两个包的 `installGit`(约 65s)与 `concurrency-install`(约 56s), 并行墙钟的下限由它们决定.
- 两个包的 `npm run lint`(oxlint)零警告, `npm run fmt:check`(oxfmt)通过.

## 用户已定的决策

- 两个包在同一仓库维护, 不做公共代码抽象; 只统一文档, 脚本名(`test`, `test-cov`, `lint`, `fmt`, `fmt:check`)与 lint / fmt 配置.
- 只保留 `main` 分支.
- 两个包共用磁盘缓存 `~/.np_tarball`, 缓存相关的配置参数, 默认值与路径尽可能一致; 约束写在根 `README.md`, 改动缓存布局时两个包同步修改.

## 待决策

| # | 问题 | 推荐 | 理由 | 选错的影响 |
| --- | --- | --- | --- | --- |
| D5 | 合仓后的 `main` 如何进入远端 | 推送 `main`, 把 GitHub 默认分支设为 `main`; `master` 按用户决定暂留 | GitHub 拒绝删除默认分支, 以后要删 `master` 必须先换默认分支 | 推送与改默认分支都是对外可见的操作, 需用户确认后执行 |
| D6 | 两个包何时发布到 npm | CI 在 GitHub 上通过后再发布 | 根 README 与两个包 README 的安装方式已写成 `npm i -g easy-np` / `easy-npd`, 未发布前这两条命令不可用 | 发布不可撤回(npm unpublish 有时间与依赖限制) |
| D7 | 是否继续压测试耗时 | 不再改测试 | 再压需要对 `installGit` 与 `concurrency-install` mock git 与 registry, 收益小于维护成本 | 若仍嫌慢, 可再对这两个文件做本地 mock, 可回退 |

## 待办

- [ ] 按 D5 推送并设置默认分支, 然后让 CI 在 GitHub 上实际跑一次.
- [ ] 按 D6 发布两个包; 发布前在各包目录 `npm pack --dry-run` 核对打包文件清单只含 `lib`, `bin`, `node-gyp-bin` 与 `README.md`, `CHANGELOG.md`, `LICENSE.txt`, `package.json`.
