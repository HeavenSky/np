# easy-np

基于 [cnpm/npminstall](https://github.com/cnpm/npminstall) 8.0.1 的 fork, 使用 `.store` 布局, 支持 npm workspaces.

本页只写与上游不同的地方, 分两部分: 「新增功能」是上游没有的能力, 「与上游 8.0.1 的差异」是上游已有功能在本 fork 中的不同行为. 未提到的用法同上游 [README](https://github.com/cnpm/npminstall/blob/master/README.md); 按版本列出的变更见 [CHANGELOG.md](./CHANGELOG.md).

## 安装

需要 Node.js >= 16.14.0; 编译原生模块时需要 Python 3.

```bash
npm i -g easy-np
```

- 安装未发布的代码: 在本仓库 `packages/easy-np` 下执行 `npm pack`, 再 `npm i -g ./easy-np-<version>.tgz`.
- 命令重名: 全局命令 `np` 与 npm 包 [`np`](https://www.npmjs.com/package/np)(sindresorhus 的发布工具)同名. 全局已装其中一个时再装另一个会报 `EEXIST`, 加 `--force` 才覆盖; 作为项目依赖时互不影响.

## 命令

| 命令                  | 别名                      | 作用                                                | 上游对应       |
| --------------------- | ------------------------- | --------------------------------------------------- | -------------- |
| `np` / `np-x install` | `i`, `add`                | 安装依赖                                            | `npminstall`   |
| `np-x uninstall`      | `un`, `remove`, `rm`, `r` | 卸载包, 并移除不再被使用的提升链接                  | `npmuninstall` |
| `np-x update`         | `up`, `upgrade`           | 删除 `node_modules` 后重装                          | `npmupdate`    |
| `np-x link`           | `ln`                      | 链接本地目录; 不带参数时把当前包安装并链接到全局    | `npmlink`      |
| `np-x fetch`          | 无                        | 只下载并解压指定的包, 不安装依赖, 不执行脚本        | 无, 新增       |
| `np-x rebuild`        | `rb`                      | 重跑已安装依赖的 preinstall / install / postinstall | 无, 新增       |

- 别名用法如 `np-x i`, `np-x rb`. `np-x -h` 列出全部子命令; `np-x <command> -h` 或 `np-x help <command>` 显示子命令的参数.
- `np --help` 显示安装的全部参数.

## 新增功能

以下能力上游 npminstall 8.0.1 没有.

### 自动切换公共源

不需要再用 `-c` 手动切换: 未指定私有源时, np 自动在 npmmirror(`registry.npmmirror.com`) 与 npmjs(`registry.npmjs.org`) 之间选择.

- 选源: 每次运行开始时, 同时请求两个源上的同一个小文件, 先返回的源优先.
- 换源重试: manifest, tgz, 以及依赖的安装脚本下载二进制文件或 Node.js 头文件失败时, 按「优先源, 另一个源」交替重试. 连同首次最多 4 次, 每个源 2 次, 不会一直卡在同一个源上.
- 镜像同步滞后: 镜像的 manifest 里没有要安装的版本时, 改从官方源获取.
- `--registry` 指定 npmmirror 或 npmjs: 跳过测速, 以指定的源优先, 失败时仍会换到另一个源.
- `--registry` 指定私有源: 完全关闭自动切换.
- `~/.nprc` 为某个 scope 单独指定 registry: 只关闭这个 scope 的自动切换.
- 测速缓存: 测速结果保存在 `~/.np_tarball/np-probe.json`(与 easy-npd 共用), 5 分钟内再次运行直接复用; `--probe-cache=<分钟>` 或环境变量 `np_probe_cache` 修改时长, `0` 表示每次都测速; `--no-cache` 时不读写.

### 失败后继续, 再次运行从断点接着装

- 一个包失败(下载, 子依赖或脚本失败)不再中止整次安装: 其余包照常安装, 结束时列出全部失败的包, 退出码为 1. 输出示例:
  ```
  1 package(s) failed, run np again to continue from where they stopped:
    - sharp@0.33.0: run install error
  ```
- 有依赖失败时, 跳过根包自身的生命周期脚本(它们通常依赖这些依赖), 下次安装成功后再执行.
- 失败或被中断后, 直接再次运行 `np` 即可继续: 不重新下载解压, 已成功的脚本不再执行, 不需要删除 `node_modules`.
- 可选依赖本身或它的子依赖失败时, 与 npm 一样只跳过该可选依赖, 不计入失败; 结束时列出失败的可选依赖, 以及重跑它们的 `np-x rebuild <pkg>` 命令.
- 多个 workspace, 以及 `np -g` 一次安装多个包时同样适用.

实现方式: 每个依赖包安装停在的阶段记录在 `node_modules/.store/.np-state.json`, 依次为 `deps`(安装子依赖), `preinstall`, `install`, `postinstall`, `finish`(自身步骤已完成); 本次运行没有失败时统一清除阶段. 不修改依赖包自己的 `package.json`; 0.0.2 写在包内 `package.json` 的 `__np_done` / `__np_stage` 仍能识别, 升级后不必重装.

### `np-x rebuild`: 重跑安装脚本

| 用法                                       | 作用                                                                                                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `np-x rebuild`, 等同 `np --rebuild`        | 按 `package.json` 重新遍历全部依赖, 按依赖顺序重跑每个依赖的三个安装脚本. 优先用磁盘缓存(manifest 不联网校验, 不测速), 缓存和 `node_modules` 里都没有的包才联网下载 |
| `np-x rebuild <pkg>[@<version range>] ...` | 只重跑列出的包在 `node_modules/.store` 中全部已安装版本的三个安装脚本, 版本范围用于筛选; 不下载, 不修改依赖与 `package.json`; 不支持 `-g`, `-w`, `--workspaces`     |

三个安装脚本指 preinstall, install, postinstall. 适用场景:

- 切换 Node.js 版本后, 重新编译原生模块.
- 修复由 easy-np 0.0.1 及更早版本装出的 `node_modules`: 这些版本会把脚本没跑完的包也标记为完成.

普通的失败或中断不需要 rebuild, 直接再次运行 `np` 即可.

### `np-x fetch`: 只下载解压

`np-x fetch <pkg> [<pkg> ...]`, 等同 `np --fetch-only`:

- 只下载, 校验并解压列出的包, 链接到 `node_modules/<name>`.
- 不安装依赖, 不执行生命周期脚本, 不链接 bin, 不修改 `package.json`.
- 不支持 git 包(获取 git 包要执行它的 prepare 脚本), 也不支持 `-g`, `-w`, `--workspaces`.
- 这些包被标记为未完成, 之后执行完整的 `np` 时会重新处理并补齐依赖.

### 根目录提升: `--dedup`

`--dedup` 把依赖树中每个包的最高版本链接到 `<root>/node_modules`, 即 npminstall@6 的扁平效果; 与 `--public-hoist-pattern` 同时使用时以 `--dedup` 为准.

### `np-lock.json`: 锁定版本

- 安装成功后在项目根目录(workspace 为 workspace 根)写入 `np-lock.json`, 记录每个依赖声明(`name@spec`)解析出的版本; 再次安装时直接复用, 不再联网解析. 与 easy-npd 读写同一份文件.
- 完整安装(`np` 不带包名)只保留本次用到的条目; `np <pkg>`, `-w`, `--workspaces`, `--production`, `--no-optional` 只追加, 不删除其他条目.
- 已安装的版本与锁定版本不同时重装为锁定版本; `np-x update` 忽略锁定版本, 按范围重新解析并写回.
- `--frozen-lockfile`: 只按 `np-lock.json` 安装, 有依赖不在锁文件中时报错, 不写回; 用于 CI.
- 项目已有 `package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lock` 或 `bun.lockb` 且没有 `np-lock.json` 时不生成; `--no-lockfile`, 环境变量 `np_lockfile=false` 或 `package.json` 的 `config.np.lockfile: false` 关闭; 使用 `--lockfile-path`, `--dependencies-tree` 或 `-g` 时不读写.
- 只锁定 registry 上的包; git, 本地路径与 tarball url 依赖每次重新获取.

### npm `overrides`

支持根 `package.json` 的 `overrides`(workspace 下只读 workspace 根): 包名, `name@<range>` 选择器, 嵌套对象(只作用于该包的依赖子树, 可带版本条件), `.` 改写包自身, 以及 `$name` 引用根依赖的版本. 嵌套越深的规则越优先; 与 npm 一样不改写根 `package.json` 的直接依赖. 同时存在 `resolutions` 时 `overrides` 优先.

### 缓存

- 与 easy-npd 共用用户配置 `~/.nprc` 和磁盘缓存 `~/.np_tarball`: 用其中一个装过的包, 另一个安装时直接命中缓存.
- npmmirror 与 npmjs 共用同一份缓存, 换源不会重复下载.
- `--refresh-cache`: 忽略已有的 manifest 与 tgz 缓存, 重新下载并覆盖, 用于缓存文件已损坏的情况.

### `workspace:` 协议

支持 `workspace:*`, `workspace:^`, `workspace:~` 与 `workspace:<range>`.

## 与上游 8.0.1 的差异

上游已有的功能在本 fork 中的不同行为. 未列出的修复(主要是 workspace 相关)见 CHANGELOG.

### 命名与文件位置

| 项                  | 上游 8.0.1                                                                   | easy-np                                                                                                                                         |
| ------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 包名与命令          | 包名 `npminstall`; 命令 `npminstall`, `npmlink`, `npmuninstall`, `npmupdate` | 包名 `easy-np`; 命令 `np` 与 `np-x`, 见「命令」                                                                                                 |
| 用户配置文件        | `~/.cnpmrc`(registry, scope registry 与认证)                                 | `~/.nprc`, 与 easy-npd 共用                                                                                                                     |
| 缓存目录            | `~/.npminstall_tarball` 下的 `manifests/` 与按包名拆分的多级 tarball 目录    | `~/.np_tarball` 下的 `np-manifests/<name>/<hash>.json`, `np-tgz/<name>/`, `np-tmp/<YYYYMMDD>/`; 不再自动清理过期临时目录                        |
| 缓存目录环境变量    | `npminstall_cache`                                                           | `np_cache`; `npm_config_cache` 两边都认                                                                                                         |
| `package.json` 配置 | `config.npminstall`                                                          | `config.np`                                                                                                                                     |
| 安装完成标记        | 包内 `package.json` 的 `__npminstall_done`                                   | 记在 `node_modules/.store/.np-state.json`, 不修改包内 `package.json`; 上游装出的 `node_modules` 会被视为未完成, 切换工具时先删除 `node_modules` |
| User-Agent          | `npminstall/<version>`                                                       | `easy-np/<version>`                                                                                                                             |

### 行为变更

| 项                                                  | 上游 8.0.1                                                                                     | easy-np                                                                                                                                                                      |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 选择 registry                                       | 固定一个 registry; 加 `-c` 才换成 npmmirror 与二进制镜像; 失败只在同一个源上重试               | 自动在 npmmirror 与 npmjs 之间切换, 见「自动切换公共源」                                                                                                                     |
| 安装失败                                            | 停在第一个错误, 提示删除 `node_modules` 后重试                                                 | 继续安装其余包, 再次运行从断点继续, 见「失败后继续」                                                                                                                         |
| 提升到根目录的包                                    | 固定提升名称匹配 `/(eslint\|prettier\|babel)/i` 的包                                           | 默认不提升; 用 `--public-hoist-pattern=<regexp>` 或 `config.np.publicHoistPattern` 指定, 命令行优先                                                                          |
| 提升链接的版本                                      | 根目录已有链接时保留; 加 `--force-link-latest` 才用更高版本覆盖                                | 始终取本次安装涉及的全部依赖树中的最高版本; 根 `package.json` 声明的依赖保持声明版本                                                                                         |
| `config.np` 的读取时机                              | 只在不带包名安装时读取                                                                         | `np` 与 `np <pkg>` 都读取                                                                                                                                                    |
| manifest 缓存键                                     | 按请求地址区分                                                                                 | 公共源统一按官方源地址, 两个源共用缓存                                                                                                                                       |
| 缓存中损坏的 tgz                                    | 校验失败后每次重试都读到同一个坏文件                                                           | 校验或解压失败时删除该文件并重新下载                                                                                                                                         |
| `--offline`                                         | 只有 manifest 走缓存; 缓存中没有的 tgz, git 包与 tarball url 依赖仍会联网                      | 完全不联网(含测速): manifest 或 tgz 不在缓存时立即失败, 不重试; git 包与 tarball url 依赖直接报错; 不能与 `--no-cache`, 或不带 `--cache-strict` 的 `--production` 同用       |
| registry token                                      | 附加到所有请求                                                                                 | 只附加到与 registry 同 host 的请求                                                                                                                                           |
| `np-x uninstall` 后的提升链接                       | 保留, 被卸载的包仍可被 require                                                                 | 移除不再被任何 `package.json` 声明, 也不被 `.store` 中其他包依赖的提升链接                                                                                                   |
| `np-x uninstall` 的返回时机                         | 可能在 `package.json` 写回前返回                                                               | 写回完成后返回                                                                                                                                                               |
| `--lockfile-path` 加载失败                          | 告警后改为联网解析                                                                             | 报错退出; workspace 下暂不支持, 直接报错                                                                                                                                     |
| 在 `npm run` / `npx` 下安装需要 prepare 的 git 依赖 | 继承 `npm_config_allow_scripts`, 被 npm 12 以 `EALLOWSCRIPTS` 拒绝                             | 正常安装: 不再调用 `npm install`; 失败时错误信息附带子进程 stderr                                                                                                            |
| git 依赖                                            | 经 pacote 获取: 托管仓库优先下载 codeload tarball, 需要构建时调用 `npm install` 后执行 prepare | 直接调用 git CLI 克隆(本机需要 git); 有 prepare 等脚本时用 np 自身安装依赖(含 devDependencies, 不执行依赖的安装脚本)再执行 prepare; 按 npm 的 `files`, `.npmignore` 规则打包 |
| `--tarball-url-mapping`                             | 声称也改写重定向地址, 但 urllib 3/4 不支持 `formatRedirectUrl`                                 | 只改写首个请求地址                                                                                                                                                           |
| npm `strict-ssl`                                    | 读取后传给 urllib, 但 urllib 3/4 不认, 不生效                                                  | 不再读取, HTTPS 证书始终校验                                                                                                                                                 |
| 未写版本或写 range 时选择版本                       | 取 latest 或范围内最高版本, 不看 `engines`                                                     | 与 npm 一致, 优先选 `engines.node` 兼容当前 Node.js 的版本, 例如 Node 18 下 `np -g npm` 装 npm 10; 显式 tag(`foo@latest`)与精确版本照旧                                      |
| tarball 完整性校验                                  | 只校验 `dist.shasum`(sha1); 只有 `--lockfile-path` 时校验 sha512                               | 与 npm 一致按 `dist.integrity` 中最强的算法校验(通常是 sha512), 没有 integrity 时才退回 sha1                                                                                 |
| 缺失的 peerDependencies                             | 只告警                                                                                         | 与 npm 7+ 一致自动安装为该包的依赖, 失败时按可选依赖跳过并告警(npm 直接报错); 祖先已声明不兼容版本时只告警; `--legacy-peer-deps` 恢复只告警                                                |

### 移除的参数与配置

| 项                                                                         | 上游 8.0.1                                          | easy-np                                                                                |
| -------------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `-c`, `--china`, `npm_china`                                               | 切换到 npmmirror 与二进制镜像                       | 移除, 由自动切换取代                                                                   |
| `--custom-china-mirror-url`                                                | 替换二进制镜像地址                                  | 移除                                                                                   |
| `--prune`, `config.npminstall.prune`, `env:production` / `env:development` | 解压时按固定名单跳过文件                            | 移除: 名单含 `tsconfig.json`, `LICENSE`, `images/` 等, 会静默破坏 `@tsconfig/*` 这类包 |
| `--proxy`, `npm_proxy`, `npm_config_proxy`                                 | 声明支持, 但 urllib 3/4 不认 `proxy` 参数, 实际直连 | 移除                                                                                   |
| `--force-link-latest`                                                      | 见「提升链接的版本」                                | 移除, 始终链接最高版本                                                                 |
| `--disable-fallback-store`                                                 | 关闭 `.store/node_modules` 回退链接                 | 移除, 回退链接始终建立                                                                 |
| `np-x uninstall --ignore-scripts`                                          | 声明但无作用                                        | 移除                                                                                   |

## 安装范围

| 命令              | 安装内容                                                                           |
| ----------------- | ---------------------------------------------------------------------------------- |
| `np`              | 根 `package.json` 的全部依赖; workspace 模式下另含全部 workspace                   |
| `np <pkg>`        | 只安装 `<pkg>` 并写入 `package.json`; 不刷新其余已声明依赖, 不执行根包生命周期脚本 |
| `np -w <name>`    | 只安装指定 workspace, 不含根包自身依赖                                             |
| `np --workspaces` | 安装全部 workspace, 不含根包自身依赖, 与 `npm install --workspaces` 一致           |

## workspace

- 按依赖关系拓扑排序后依次安装与执行生命周期脚本; 有循环依赖时保持 glob 顺序并告警.
- 依赖名与某个 workspace 同名时总是链接本地 workspace; 版本不满足声明范围时只告警.
- `np-x update -w <name>` 只清理该 workspace 的 `node_modules`.
- `--lockfile-path` 不支持 workspace, 会直接报错.

## node_modules 布局

- 包实体位于 `node_modules/.store/<name>@<version>/node_modules/<name>`; 每个包的最高版本另链接到 `node_modules/.store/node_modules`, 供 peerDependencies 回退解析.
- 根目录只放直接依赖与被提升的包.
- 完整安装会用本次结果替换上次的提升链接, 可能降级; `np <pkg>`, `-w`, `--workspaces` 只升级不降级.

## 已知安全风险

为支持 Node 16 而保留的依赖, 以下公告未修复:

- urllib 3 依赖的 undici 5: 公告集中在 WebSocket, fetch, Cookie, multipart 与 retry 拦截器, np 不经过这些路径; 请求走私一类需要恶意 registry 或代理配合.
- node-gyp 10 经 make-fetch-happen / cacache 引入的 tar 6 与 http-cache-semantics: 只在依赖的安装脚本调用 node-gyp 下载 Node.js 头文件时使用; np 自身解压 tarball 使用顶层 tar 7.
- globby 依赖的 braces / micromatch: 深度嵌套的匹配模式会耗尽调用栈, np 只用它匹配 `package.json` 中的 workspaces 模式.

## License

MIT, 见 [LICENSE.txt](./LICENSE.txt).
