# TODO

本仓库 `packages/easy-np` 与 `packages/easy-npd` 两个包的待办与决策; 在新 session 接手本仓库的改动前读本页. 更新于 2026-09-29 10:22 +0800.

## 当前状态

- 本地只有 `main` 一个分支, 未推送, 不跟踪任何上游. 原 `np`, `npd`, `master` 三个本地分支已删除: `np`(`fce9c9e`)与 `npd`(`9bc3113`)都是 `main` 的祖先, 历史查法见根 `README.md` 的「历史」一节; `master` 是上游 npminstall 的 master, 远端 `origin/master` 仍在.
- 远端 `origin`(HeavenSky/np)只剩上游的 `master` 与 `1.x`..`6.x`, 默认分支是 `master`; `np`, `feat/lockfile-support`, `renovate/*`, `snyk-fix-*` 已按用户要求删除. 用户决定暂不删除 `master`. 合仓后的内容从未推送.
- 两个包各自 `npm i`, 不启用 npm workspaces; 根 `package.json` 只放 `npm --prefix` 调度脚本, 理由写在根 `README.md` 的「开发」一节.
- 两个包都用 mocha 11 + c8, `.mocharc.js` 开启 `parallel: true`, 全部用例结束后由 `test/.mocha-global.js` 删除 `test/fixtures/.tmp_*`; 每个测试文件只写自己的 fixture 目录或 `helper.tmp()` 生成的唯一目录.
- 已完成并提交: easy-npd 并行测试改造, D1, D2, D3, D4 与 easy-npd 发布准备(`package.json`, `LICENSE.txt`, `CHANGELOG.md`, `README.md`, 删除 `History.md` 与 `AUTHORS`); 提交见 `git log 41bff72..main`.

### 已知的验证缺口

- 两个包都没有在当前 `main` 上跑过全量; 本轮只跑了改动涉及的测试文件, 全部通过: easy-npd 的 link / install-save / install-cache-strict / local-install-pkgs / peer / uninstall 系列与 `get.test.js`, `uninstall-hoisted-links.test.js`; easy-np 的 link 系列, `install-save-folder`, `uninstallGlobal`.
- easy-npd 并行试跑的历史基线: 全量约 80s 完成, 此前唯一失败 `link-folder.test.js` 的 "should link one folder work" 已查明是断言仍写旧目录名 `link-demo`, 已修.
- 根目录 `.github/workflows/ci.yml` 从未在 GitHub 上运行过.

## 用户已定的决策

- 两个包在同一仓库维护, 不做公共代码抽象; 只统一文档, 脚本名(`test`, `test-cov`, `lint`, `fmt`, `fmt:check`)与 lint / fmt 配置.
- easy-npd: 包名 `easy-npd`, 版本 `0.0.0`, 全部 `npminstall` 标识改为 `npd`(命令 `npd` 系列, 缓存 `~/.npd_tarball`, 环境变量 `npd_cache`, 完成标记 `__npd_done`, User-Agent `easy-npd/<version>`).
- 两个包都用 mocha 11; 暂不对现有代码跑 `oxfmt` 与 `oxlint --fix`(easy-npd 的 `npm run fmt:check` 目前失败属预期); 做时单独一个提交, 只含格式变化.
- 在测试耗时问题修好之前, 不跑全量测试; 只跑与改动直接相关的测试文件.
- 只保留 `main` 分支, 不保留 `np`, `npd` 作为历史入口(推翻了原 D5 推荐的"保留两个源分支").
- D1: easy-npd 保留全局命令 `npd`, 在 README 写明与 npm 包 `npd`(bin `npd`, `npdg`)的冲突.
- D2: easy-npd 的 `.cnpmrc` 凭据只发给与 registry 同 host 的请求, `always-auth` 也不例外.
- D3: easy-npd 卸载后清理无人使用的根目录提升链接, 判定口径为"不被根 `package.json` 声明, 也不被其他 `_name@ver@name/node_modules` 引用", 并沿被移除包的依赖递归; 不回收 `_name@ver@name` 目录本身(写入 README「待办规划」).
- D4: easy-npd `publishConfig` 为 `"registry": "https://registry.npmjs.org/"`, 不带 tag.

## 待决策

| # | 问题 | 推荐 | 理由 | 选错的影响 |
| --- | --- | --- | --- | --- |
| D5 | 合仓后的 `main` 如何进入远端, 远端 `master` 何时删除 | 推送 `main`, 把 GitHub 默认分支设为 `main`; `master` 按用户决定暂留 | GitHub 拒绝删除默认分支, 删 `master` 前必须先换默认分支 | 推送与改默认分支都是对外可见的操作, 需用户确认后执行 |
| D6 | 两个包是否以及何时发布到 npm | 跑完一次全量并让 CI 通过后再发布 | 根 README 与两个包 README 的安装方式已写成 `npm i -g easy-np` / `easy-npd`, 未发布前这两条命令不可用 | 发布不可撤回(npm unpublish 有时间与依赖限制) |
| D7 | 测试耗时的测量是否算作全量运行 | 允许一次 `mocha --reporter json` 的并行全量, 只用于测量 | 找出最慢的测试文件必须跑全部文件; 并行后 easy-npd 全量约 80s, 耗时问题可能已基本解决 | 不允许则只能按经验猜慢文件, 改错方向 |

## 待办

### A. 测试耗时

- [ ] 按 D7 取得测量数据: 用 `mocha --reporter json` 或逐文件计时找出最慢的测试文件; 慢的主因预期是真实访问 registry 与安装大包(例如 `bigPackage`, `install-cypress`, `installGlobal`), 可选方向是复用本地缓存目录, 把大包换成小包, 或对 registry 做本地 mock; 选哪种先给出测量数据.
- [ ] 耗时修好后, 两个包各跑一次全量, 补齐上方「已知的验证缺口」.
- [ ] 让 CI 在 GitHub 上实际跑一次(依赖 D5 推送).

### D. 仓库与发布

- [ ] 按 D5 推送并设置默认分支.
- [ ] 按 D6 发布两个包; 发布前在各包目录 `npm pack --dry-run` 核对打包文件清单(本轮核对过: easy-npd 42 个文件, easy-np 37 个文件, 均只含 `lib`, `bin`, `node-gyp-bin` 与 `README.md`, `CHANGELOG.md`, `LICENSE.txt`, `package.json`).
