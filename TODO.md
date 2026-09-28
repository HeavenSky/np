# TODO

本仓库 `packages/easy-np` 与 `packages/easy-npd` 两个包的待办与决策; 在新 session 接手本仓库的改动前读本页. 生成于 2026-09-28 20:19 +0800.

## 当前状态

- 工作分支 `main`(仅本地, 未推送), 由 `np` 分支移入 `packages/easy-np`, 再以子树合并把 `npd` 分支放入 `packages/easy-npd`; 两个源分支 `np`, `npd` 保留在本地. 远端 `origin`(HeavenSky/np)的默认分支是上游的 `master`, 本仓库的任何分支都未推送过合仓后的内容.
- 两个包各自 `npm i`, 不启用 npm workspaces; 根 `package.json` 只放 `npm --prefix` 调度脚本, 理由写在根 `README.md` 的「开发」一节.
- 两个包的测试都已从 egg-bin 迁到 mocha 11 + c8, 配置在各包 `.mocharc.js`, spec glob 在各包 npm 脚本里(放进 `.mocharc.js` 会让 `mocha <单个文件>` 仍跑全量).

### 工作区里未提交的改动(并行改造, 半成品)

`git status` 可见, 均属于下方 A 组第一项, 验证未完成, 接手时先读 diff 再决定提交或调整:

- `packages/*/.mocharc.js`: `parallel: true`, 并 `require` 新增的 `test/.mocha-global.js`(全部用例结束后在主进程删除 `test/fixtures/.tmp_*`).
- `packages/easy-npd/test/helper.js`: `helper.tmp()` 改为每次生成唯一目录 `.tmp_<uuid>`(与 easy-np 相同); 新增 `helper.restoreFile(file)`, 清理时写回被 `--save` 改写的被跟踪 fixture.
- easy-npd 拆分共用 fixture: `demo` → 新增 `demo-install-cache-strict`, `demo-install-save-folder`; `link-demo` → 新增 `link-folder`, `link-demo-module`; 对应测试文件改为引用新目录. `uninstallGlobal.test.js` 的路径正则改认 `.tmp_<uuid>`. `install-save-bin-name`, `local-install-pkgs`, `peer` 三个测试挂上 `restoreFile`.

### 已知的验证缺口

- easy-npd 改名提交(`chore: rename npminstall identifiers in easy-npd to npd`)之后没有跑完过全量: 串行跑到 142/239 全部通过后被中止.
- easy-npd 并行试跑: 第一轮 80s 完成, 238 通过 2 失败(link 用例共用 `link-demo`, 已按上文拆分); 第二轮在 214 个用例时中止, 213 通过, 1 失败: `test/link-folder.test.js` 的 "should link one folder work", 原因未查.
- easy-np 迁到 mocha 后只跑过定点用例, 没有跑过全量; 迁移前用 egg-bin `-p` 并行跑的基线为 272 通过 3 失败, 3 个失败(mocha 12 去掉 `_mocha` 两例, node-sass 一例)已在迁移提交中处理.
- 根目录 `.github/workflows/ci.yml` 从未在 GitHub 上运行过.

## 用户已定的决策

- 两个包在同一仓库维护, 不做公共代码抽象; 只统一文档, 脚本名(`test`, `test-cov`, `lint`, `fmt`, `fmt:check`)与 lint / fmt 配置.
- easy-npd: 包名 `easy-npd`, 版本 `0.0.0`, 源分支改名为 `npd`, 全部 `npminstall` 标识改为 `npd`(命令 `npd` 系列, 缓存 `~/.npd_tarball`, 环境变量 `npd_cache`, 完成标记 `__npd_done`, User-Agent `easy-npd/<version>`).
- 两个包都用 mocha 11; 暂不对现有代码跑 `oxfmt` 与 `oxlint --fix`(easy-npd 的 `npm run fmt:check` 目前失败属预期).
- 在测试耗时问题修好之前, 不跑全量测试; 只跑与改动直接相关的测试文件.

## 待决策(每项给出推荐)

| # | 问题 | 推荐 | 理由 | 选错的影响 |
| --- | --- | --- | --- | --- |
| D1 | npm 上已有包 `npd`, 其 bin 为 `npd` 与 `npdg`; easy-npd 的全局命令 `npd` 与它冲突 | 保留 `npd`, 在 easy-npd README 写明冲突, 写法照 easy-np README 对 sindresorhus `np` 的说明 | 与 easy-np 对 `np` 的处理一致; npm 在全局 bin 已被其他包占用时报 `EEXIST` 拒绝安装而不是静默覆盖 | 改名需同步 `package.json` bin, 帮助文案, 两个包与根目录 README; 发布前改都可回退, 发布后改名是破坏性变更 |
| D2 | easy-npd 在 `always-auth` 下把 Basic 认证发给所有地址, 且用子串匹配判断 registry(`lib/get.js` 的 `authed`) | 移植 easy-np `6367def` 的思路: 按 `new URL().host` 与 registry 比对, 只对同 host 请求附加认证, `always-auth` 也不例外 | 备用 registry(`lib/utils.js#getRemotePackage`), tarball CDN 与二进制镜像都会收到凭据; 交接时判为"不适用"只因 6.x 没有 `_authToken`, 泄露本身同样存在 | 依赖 `always-auth` 向非 registry host 发凭据的私有部署会失去认证; 可回退 |
| D3 | 是否把 easy-np `1ea85ce`(卸载后清理无人使用的提升链接)移植到 easy-npd | 移植, 但需按 6.x 布局改写 | 6.x 卸载后, 被卸载包的依赖在根 `node_modules` 的提升链接仍在, 包仍可被 require; easy-np 的实现依赖 `.store` 与 `isStoreLink`, 6.x 要改为扫描 `_name@ver@name/node_modules` 判断引用 | 不移植则行为与 easy-np 不一致; 移植错误会误删仍被依赖的链接, 需补测试 |
| D4 | easy-npd 的 `publishConfig.tag` 仍是上游的 `latest-6` | 改为 `"registry": "https://registry.npmjs.org/"`, 去掉 tag, 与 easy-np 相同 | 带 `latest-6` 发布时, `npm i easy-npd` 取 `latest` 标签, 装不到这次发布的版本 | 发布前可改; 已发布需手动 `npm dist-tag add` 修正 |
| D5 | 合仓后的 `main` 如何进入远端 | 推送 `main` 并把 GitHub 默认分支设为 `main`; 保留 `np`, `npd` 分支作为合仓前的历史入口, 不删除 | 远端默认分支 `master` 是上游 npminstall 的 master, 与本仓库内容无关 | 推送与改默认分支都是对外可见的操作, 需用户确认后执行 |
| D6 | 两个包是否以及何时发布到 npm | 先修完 A 组与 D1, D2, D4 再发布 | 根 README 与两个包 README 的安装方式已写成 `npm i -g easy-np` / `easy-npd`, 未发布前这两条命令不可用 | 发布不可撤回(npm unpublish 有时间与依赖限制) |

## 待办

### A. 测试并行与耗时(合仓后第一个任务)

- [ ] 收尾工作区里的并行改造: 查清 `link-folder.test.js` "should link one folder work" 的失败原因, 修好后提交; 提交前只跑改动涉及的测试文件.
- [ ] easy-np 用 mocha `--parallel` 定点验证: 它的 fixture 已按测试文件拆分, `helper.tmp()` 已唯一化, 但 `link-to-global.test.js` 与 easy-npd 一样在清理时删除 `link-demo/linked-package*/node_modules`, 需确认没有其他测试文件写同一目录.
- [ ] 查清耗时来源再改: 用 `mocha --reporter json` 或逐文件计时找出最慢的测试文件; 慢的主因预期是真实访问 registry 与安装大包(例如 `bigPackage`, `install-cypress`, `installGlobal`), 可选方向是复用本地缓存目录, 把大包换成小包, 或对 registry 做本地 mock; 选哪种先给出测量数据.
- [ ] 耗时修好后, 两个包各跑一次全量, 补齐上方「已知的验证缺口」.
- [ ] 让 CI 在 GitHub 上实际跑一次(依赖 D5 推送).

### B. easy-np → easy-npd

逐项核对 `aaf25fd..fce9c9e`(np 分支相对上游 8.0.1)的非测试改动, 结论:

| easy-np 提交 | 内容 | 对 easy-npd |
| --- | --- | --- |
| `546d0d4` | 缓存目录 `np-manifests` / `np-tgz` / `np-tmp` | 已有, 来自 npd 分支的 `54da58f` |
| `d9ef7e2`, `13d4779`, `e08c437` 的 publicHoistPattern 部分 | `--dedup`, `--public-hoist-pattern`, `config.np.publicHoistPattern` | 不适用: 6.x 本身就把每个包的最高版本链接到根目录 |
| `6367def` | registry token 只发给同 host | 见 D2 |
| `3d1cb32`, `1933c2f`, `31848fe` | 包名, 命令, 日志前缀, 缓存与标记改名 | 已完成(改名为 npd) |
| `2b03fb6`, `10408d9`, `e08c437` 的保留声明依赖部分 | 提升链接始终取最高版本, 部分安装不降级, 不覆盖根 `package.json` 声明的依赖 | 已有, 见 easy-npd `lib/local_install.js#shouldOverrideLink` |
| `e3e94db` | 帮助文案列出全部参数 | 已有 |
| `4791c8d`, `771f483`, `7200995`, `2527dcd`, `c25783f`, `fce9c9e` | 删除无效参数, 删除 prune, lockfile 失败退出, manifest 分目录, pruneJSON await, git 依赖 EALLOWSCRIPTS | 已有 |
| `54ab2c2`, `b04e54e`, `1f5ba56`, `b0e6b85`, `f2c928e`, `1d902aa` | workspace 相关修复 | 不适用: 6.x 无 workspace |
| `1ea85ce` | 卸载后清理无人使用的提升链接 | 见 D3 |
| `0ce3dcc`, `52d4156` | 删除上游 workflow 与 renovate | 已由根目录 CI 取代; easy-npd 无 `renovate.json` |
| `22eb6c8` | oxlint / oxfmt | 已有 |
| `d456598` | 全仓 oxfmt 格式化与 `oxlint --fix` | 暂缓(用户决定); 做时单独一个提交, 只含格式变化 |
| `8032520`, `82a99cc`, `97945e3`, `acc2170` | 发布准备与文档 | 需要做, 见下 |

- [ ] easy-npd 发布准备(对照 easy-np `8032520`): `package.json` 的 `description`, `keywords`, `author`, `files` 加入 `CHANGELOG.md`, `prepublishOnly: npm run lint`, `publishConfig`(见 D4); 删除上游的 `contributor` 脚本与 `git-contributor` 依赖; `LICENSE.txt` 加 `Copyright (c) 2026-present HeavenSky`.
- [ ] easy-npd 的 `CHANGELOG.md`: 上游 6.x 历史条目换成指向上游 CHANGELOG 的链接, 与 easy-np 相同; 删除上游的 `History.md` 与 `AUTHORS`(先确认 easy-np 对应文件的处理, easy-np 目录下已无这两个文件).
- [ ] easy-npd 的 `README.md` 补齐 easy-np 有而它没有的章节: 「安装范围」(去掉 workspace 行), 「已知安全风险」(两者同为 urllib 3 与 pacote 15, 内容可照搬后按 6.x 核对), 「待办规划」(6.x 对应项: 回收不再被引用的 `_name@ver@name` 目录), 命令名冲突说明(D1).
- [ ] 按 D2, D3 的结论实施, 各自补测试.

### C. easy-npd → easy-np

逐项核对 `54da58f..9bc3113`(npd 分支相对打补丁后的 6.8.0)的非测试改动, 结论: 除下面几项外, 全部改动都是从 np 分支移植过去的, easy-np 已有对应实现.

| easy-npd 提交 | 对 easy-np |
| --- | --- |
| `e03a31f`(node-gyp 10, engines `>=16.14.0`), `888db22`(tar 7) | easy-np 已是 node-gyp `^10.3.1`, tar 7, engines `>=16.14.0` |
| `07c61d4`(oxlint, CI 拆分 lint job) | easy-np 已有 oxlint; CI 已统一到根目录 |
| `05faacb`, `9bc3113`(文档与改名) | 各包自有, 不互相应用 |
| `3d45e91`(mocha 11 + c8) | 已在 `main` 上对 easy-np 做了同样迁移 |

- [ ] 无代码需要从 easy-npd 应用到 easy-np; 只需在 A 组完成后确认两个包的 `.mocharc.js` 与测试 helper 写法保持一致.

### D. 仓库与发布

- [ ] 按 D5 推送并设置默认分支.
- [ ] 按 D6 发布两个包; 发布前在各包目录 `npm pack --dry-run` 核对打包文件清单.
- [ ] 根 `README.md` 的「历史」一节在推送后核对 `git log np -- <路径>` 与 `git log npd -- <路径>` 的写法对远端克隆仍成立(两个源分支需要推送或保留在远端).
