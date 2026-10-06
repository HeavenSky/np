# easy-npd

基于 [cnpm/npminstall](https://github.com/cnpm/npminstall) 6.8.0 的 fork, 使用 `_name@version@name` 扁平布局, 根目录链接每个包的最高版本.

本页只写与上游不同的地方, 分两部分: 「新增功能」是上游没有的能力, 「与上游 6.8.0 的差异」是上游已有功能在本 fork 中的不同行为. 未提到的用法(含作为库调用, `--flatten`, resolutions)同上游 [6.x README](https://github.com/cnpm/npminstall/blob/6.x/README.md); 按版本列出的变更见 [CHANGELOG.md](./CHANGELOG.md).

## 安装

需要 Node.js >= 16.14.0; 编译原生模块时需要 Python 3.

```bash
npm i -g easy-npd
```

- 安装未发布的代码: 在本仓库 `packages/easy-npd` 下执行 `npm pack`, 再 `npm i -g ./easy-npd-<version>.tgz`.
- 命令重名: 全局命令 `npd` 与 npm 包 [`npd`](https://www.npmjs.com/package/npd)(Node Packages Deployer)同名. 全局已装其中一个时再装另一个会报 `EEXIST`, 加 `--force` 才覆盖; 作为项目依赖时互不影响.

## 命令

| 命令                    | 别名                      | 作用                                                | 上游对应       |
| ----------------------- | ------------------------- | --------------------------------------------------- | -------------- |
| `npd` / `npd-x install` | `i`, `add`                | 安装依赖                                            | `npminstall`   |
| `npd-x uninstall`       | `un`, `remove`, `rm`, `r` | 卸载包, 并移除不再被使用的提升链接                  | `npmuninstall` |
| `npd-x update`          | `up`, `upgrade`           | 删除 `node_modules` 后重装                          | `npmupdate`    |
| `npd-x link`            | `ln`                      | 链接本地目录; 不带参数时把当前包安装并链接到全局    | `npmlink`      |
| `npd-x fetch`           | 无                        | 只下载并解压指定的包, 不安装依赖, 不执行脚本        | 无, 新增       |
| `npd-x rebuild`         | `rb`                      | 重跑已安装依赖的 preinstall / install / postinstall | 无, 新增       |
| `npd-x approve-scripts` | 无 | 把依赖写入 `package.json` 的 `allowScripts`, 放行其安装脚本 | 无, 新增 |

- 别名用法如 `npd-x i`, `npd-x rb`. `npd-x -h` 列出全部子命令; `npd-x <command> -h` 或 `npd-x help <command>` 显示子命令的参数.
- `npd --help` 显示安装的全部参数.

## 新增功能

以下能力上游 npminstall 6.8.0 没有.

### 自动切换公共源

不需要再用 `-c` 手动切换: 未指定私有源时, npd 自动在 npmmirror(`registry.npmmirror.com`) 与 npmjs(`registry.npmjs.org`) 之间选择.

- 选源: 每次运行开始时, 同时请求两个源上的同一个小文件, 先返回的源优先.
- 换源重试: manifest, tgz, 以及依赖的安装脚本下载二进制文件或 Node.js 头文件失败时, 按「优先源, 另一个源」交替重试. 连同首次最多 4 次, 每个源 2 次, 不会一直卡在同一个源上.
- 镜像同步滞后: 镜像的 manifest 里没有要安装的版本时, 改从官方源获取.
- `--registry` 指定 npmmirror 或 npmjs: 跳过测速, 以指定的源优先, 失败时仍会换到另一个源.
- `--registry` 指定私有源: 完全关闭自动切换.
- `~/.nprc` 为某个 scope 单独指定 registry: 只关闭这个 scope 的自动切换.
- 测速缓存: 测速结果保存在 `~/.np_tarball/np-probe.json`(与 easy-np 共用), 5 分钟内再次运行直接复用; `--probe-cache=<分钟>` 或环境变量 `np_probe_cache` 修改时长, `0` 表示每次都测速; `--no-cache` 时不读写.

### 失败后继续, 再次运行从断点接着装

- 一个包失败(下载, 子依赖或脚本失败)不再中止整次安装: 其余包照常安装, 结束时列出全部失败的包, 退出码为 1. 输出示例:
  ```
  1 package(s) failed, run npd again to continue from where they stopped:
    - sharp@0.33.0: run install error
  ```
- 有依赖失败时, 跳过根包自身的生命周期脚本(它们通常依赖这些依赖), 下次安装成功后再执行.
- 失败或被中断后, 直接再次运行 `npd` 即可继续: 不重新下载解压, 已成功的脚本不再执行, 不需要删除 `node_modules`.
- 可选依赖本身或它的子依赖失败时, 与 npm 一样只跳过该可选依赖, 不计入失败; 结束时列出失败的可选依赖, 以及重跑它们的 `npd-x rebuild <pkg>` 命令.
- `npd -g` 一次安装多个包时同样适用.

实现方式: 每个依赖包安装停在的阶段记录在 `node_modules/.npd-state.json`(全局安装为 `.<name>_npd/.npd-state.json`), 依次为 `preinstall`, `deps`(安装子依赖), `install`, `postinstall`, `finish`(自身步骤已完成). npd 在全部依赖安装完后才统一执行 install / postinstall, 所以本次运行装过的包要等全部脚本成功后才统一清除阶段; 再次运行时这些包会重新遍历子依赖, 但不重复已成功的脚本. 不修改依赖包自己的 `package.json`; 0.0.2 写在包内 `package.json` 的 `__npd_done` / `__npd_stage` 仍能识别, 升级后不必重装.

### 依赖安装脚本默认不执行: `allowScripts`

与 npm 12 一致, 依赖的 preinstall / install / postinstall, 有 `binding.gyp` 时的隐式 `node-gyp rebuild`, 以及 git 依赖的 prepare, 只有在根 `package.json` 的 `allowScripts` 中放行后才执行; 根项目与本地目录依赖的脚本照常执行. 未放行的包被跳过, 安装结束时列出它们和放行后重跑的命令; 被跳过的原生模块要到运行时才报错.

```json
{
  "allowScripts": {
    "esbuild": true,
    "sharp@0.33.5": true,
    "core-js": false
  }
}
```

- 键写包名(放行全部版本), `<name>@<精确版本>` 或用 `||` 连接的多个精确版本, git 地址, tarball url; `^`, `~` 等范围与 dist-tag 告警后忽略. 值 `false` 表示明确拒绝, 不再出现在跳过列表里, 同时命中时拒绝优先.
- `npd-x approve-scripts <pkg>` 按已安装版本写入 `<pkg>@<version>`, `--no-pin` 只写包名, `--all` 放行全部未审核的包, `--pending` 只列出; 之后运行 `npd-x rebuild <pkg>` 执行脚本. git 依赖放行后要重新安装才会执行 prepare.
- 来源只取第一个有配置的: `--allow-scripts=<pkg>[,<pkg>]`(主要用于 `-g`) > 根 `package.json` 的 `allowScripts` > `~/.nprc` 的 `allow-scripts`.
- `--strict-allow-scripts`: 有未审核的依赖脚本时安装以非 0 退出. `--dangerously-allow-all-scripts`: 忽略 `allowScripts`, 执行全部依赖脚本(0.0.2 及以前的行为). 两者也可写在 `~/.nprc` 或 `npm_config_*` 中. `--ignore-scripts` 优先于以上全部设置.

### `npd-x rebuild`: 重跑安装脚本

| 用法                                        | 作用                                                                                                                                                                |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npd-x rebuild`, 等同 `npd --rebuild`       | 按 `package.json` 重新遍历全部依赖, 按依赖顺序重跑每个依赖的三个安装脚本. 优先用磁盘缓存(manifest 不联网校验, 不测速), 缓存和 `node_modules` 里都没有的包才联网下载 |
| `npd-x rebuild <pkg>[@<version range>] ...` | 只重跑列出的包在 `node_modules` 中全部已安装版本的三个安装脚本, 版本范围用于筛选; 不下载, 不修改依赖与 `package.json`; 不支持 `-g`                                  |

三个安装脚本指 preinstall, install, postinstall. 适用场景:

- 切换 Node.js 版本后, 重新编译原生模块.
- 修复由 easy-npd 0.0.1 及更早版本装出的 `node_modules`: 这些版本会把脚本没跑完的包也标记为完成.

普通的失败或中断不需要 rebuild, 直接再次运行 `npd` 即可.

### `npd-x fetch`: 只下载解压

`npd-x fetch <pkg> [<pkg> ...]`, 等同 `npd --fetch-only`:

- 只下载, 校验并解压列出的包, 链接到 `node_modules/<name>`.
- 不安装依赖, 不执行生命周期脚本, 不链接 bin, 不修改 `package.json`.
- 不支持 git 包(获取 git 包要执行它的 prepare 脚本), 也不支持 `-g`.
- 这些包被标记为未完成, 之后执行完整的 `npd` 时会重新处理并补齐依赖.

### `--offline`: 离线安装

- 只读磁盘缓存, 不发任何网络请求, 包括启动时的测速.
- manifest 或 tgz 不在缓存中时立即失败, 不重试.
- git 包与 tarball url 依赖只能联网获取, 直接报错.
- `binary-mirror-config` 与 `bug-versions` 使用随 npd 安装的版本.
- 不能与 `--no-cache`, 或不带 `--cache-strict` 的 `--production` 同用.

### `np-lock.json`: 锁定版本

- 安装成功后在项目根目录写入 `np-lock.json`, 记录每个依赖声明(`name@spec`)解析出的版本; 再次安装时直接复用, 不再联网解析. 与 easy-np 读写同一份文件.
- 完整安装(`npd` 不带包名)只保留本次用到的条目; `npd <pkg>`, `--production`, `--no-optional` 只追加, 不删除其他条目.
- 已安装的版本与锁定版本不同时重装为锁定版本; `npd-x update` 忽略锁定版本, 按范围重新解析并写回.
- `--frozen-lockfile`: 只按 `np-lock.json` 安装, 有依赖不在锁文件中时报错, 不写回; 用于 CI.
- 项目已有 `package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lock` 或 `bun.lockb` 且没有 `np-lock.json` 时不生成; `--no-lockfile`, 环境变量 `np_lockfile=false` 或 `package.json` 的 `config.np.lockfile: false`(与 easy-np 同一个键)关闭; 使用 `--lockfile-path`, `--dependencies-tree` 或 `-g` 时不读写.
- 只锁定 registry 上的包; git, 本地路径与 tarball url 依赖每次重新获取.

### npm `overrides`

支持根 `package.json` 的 `overrides`: 包名, `name@<range>` 选择器, 嵌套对象(只作用于该包的依赖子树, 可带版本条件), `.` 改写包自身, 以及 `$name` 引用根依赖的版本. 嵌套越深的规则越优先; 与 npm 一样不改写根 `package.json` 的直接依赖. 同时存在 `resolutions` 时 `overrides` 优先.

### 缓存

- 与 easy-np 共用用户配置 `~/.nprc` 和磁盘缓存 `~/.np_tarball`: 用其中一个装过的包, 另一个安装时直接命中缓存.
- npmmirror 与 npmjs 共用同一份缓存, 换源不会重复下载.
- `--refresh-cache`: 忽略已有的 manifest 与 tgz 缓存, 重新下载并覆盖, 用于缓存文件已损坏的情况.

## 与上游 6.8.0 的差异

上游已有的功能在本 fork 中的不同行为.

### 命名与文件位置

| 项                                 | 上游 6.8.0                                                                                              | easy-npd                                                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 包名与命令                         | 包名 `npminstall`; 命令 `npminstall`, `npmlink`, `npmuninstall`, `npmupdate`                            | 包名 `easy-npd`; 命令 `npd` 与 `npd-x`, 见「命令」                                                                                             |
| 用户配置文件                       | `~/.cnpmrc`(registry, scope registry 与认证)                                                            | `~/.nprc`, 与 easy-np 共用                                                                                                                     |
| 缓存目录                           | `~/.npminstall_tarball` 下的 `manifests/<h>/<h>/<h>/`, 按包名拆分的多级 tarball 目录, `.tmp/YYYY/MM/DD` | `~/.np_tarball` 下的 `np-manifests/<name>/<hash>.json`, `np-tgz/<name>/`, `np-tmp/<YYYYMMDD>/`; 旧布局的缓存不再读取; 不再自动清理过期临时目录 |
| 缓存目录环境变量                   | `npminstall_cache`                                                                                      | `np_cache`; `npm_config_cache` 两边都认                                                                                                        |
| 安装完成标记                       | 包内 `package.json` 的 `__npminstall_done`                                                              | 记在 `node_modules/.npd-state.json`, 不修改包内 `package.json`; 上游装出的 `node_modules` 会被视为未完成, 切换工具时先删除 `node_modules`      |
| User-Agent, 日志前缀, debug 名空间 | `npminstall`                                                                                            | User-Agent 为 `easy-npd/<version>`, 日志前缀与 debug 名空间为 `npd`                                                                            |

### 行为变更

| 项                                                  | 上游 6.8.0                                                                                     | easy-npd                                                                                                                                                                      |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 选择 registry                                       | 固定一个 registry; 加 `-c` 才换成 npmmirror 与二进制镜像; 失败只在同一个源上重试               | 自动在 npmmirror 与 npmjs 之间切换, 见「自动切换公共源」                                                                                                                      |
| 安装失败                                            | 停在第一个错误, 提示删除 `node_modules` 后重试                                                 | 继续安装其余包, 再次运行从断点继续, 见「失败后继续」                                                                                                                          |
| 根目录提升链接                                      | 已存在即跳过, 依赖变化后重装也不更新; 加 `--force-link-latest` 才用更高版本覆盖                | 始终链接最高版本; 完整安装(不带包名)时把上次的提升链接替换为本次依赖树中的最高版本, 可能降级; 根 `package.json` 声明的包不覆盖                                                |
| manifest 缓存键                                     | 按请求地址区分                                                                                 | 公共源统一按官方源地址, 两个源共用缓存                                                                                                                                        |
| 缓存中损坏的 tgz                                    | 校验失败后每次重试都读到同一个坏文件                                                           | 校验或解压失败时删除该文件并重新下载                                                                                                                                          |
| `.nprc` 的 registry 用户名密码                      | 按子串匹配 registry 地址附加; `always-auth` 时附加到所有请求                                   | 只附加到与 registry 同 host 的请求, `always-auth` 也不例外                                                                                                                    |
| `npd-x uninstall` 后被卸载包的依赖                  | 根目录提升链接保留, 仍可被 require                                                             | 移除不再被根 `package.json` 声明, 也不被其他 `_name@version@name` 引用的提升链接                                                                                              |
| `npd-x uninstall` 的返回时机                        | 可能在 `package.json` 写回前返回                                                               | 写回完成后返回                                                                                                                                                                |
| `--lockfile-path` 加载失败                          | 告警后改为联网解析, 退出码 0                                                                   | 报错退出                                                                                                                                                                      |
| 在 `npm run` / `npx` 下安装需要 prepare 的 git 依赖 | 继承 `npm_config_allow_scripts`, 被 npm 12 以 `EALLOWSCRIPTS` 拒绝                             | 正常安装: 不再调用 `npm install`; 失败时错误信息附带子进程 stderr                                                                                                             |
| git 依赖                                            | 经 pacote 获取: 托管仓库优先下载 codeload tarball, 需要构建时调用 `npm install` 后执行 prepare | 直接调用 git CLI 克隆(本机需要 git); 有 prepare 等脚本且在 `allowScripts` 中放行时用 npd 自身安装依赖(含 devDependencies, 不执行依赖的安装脚本)再执行 prepare; 按 npm 的 `files`, `.npmignore` 规则打包 |
| `--tarball-url-mapping`                             | 声称也改写重定向地址, 但 urllib 3 不支持 `formatRedirectUrl`                                   | 只改写首个请求地址                                                                                                                                                            |
| npm `strict-ssl`                                    | 读取后作为 `rejectUnauthorized` 传入, 但 urllib 3 不认, 不生效                                 | 读取 `--strict-ssl`, `npm_config_strict_ssl` 与 `~/.nprc`, 为 false 时关闭证书校验; 另支持 `--cafile` 指定 CA 证书; 两者都传给安装脚本与 git |
| `--proxy`, `npm_proxy`, `npm_config_proxy` | 声明支持, 但 urllib 3 不认 `proxy` 参数, 实际直连 | 支持 `--proxy`, `--https-proxy`, `--noproxy`; 未传时依次读取 `npm_config_*`, `~/.nprc`, `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY`; 同时传给安装脚本, node-gyp 与 git; 只支持 http(s) 代理 |
| 依赖                                                | node-gyp 9, tar 6                                                                              | node-gyp 10, tar 7                                                                                                                                                            |
| 未写版本或写 range 时选择版本                       | 取 latest 或范围内最高版本, 不看 `engines`                                                     | 同 npm, 优先选 `engines.node` 兼容当前 Node.js 的版本, 如 Node 18 下 `npd -g npm` 装 npm 10; 显式 tag 与精确版本照旧                                                          |
| tarball 完整性校验                                  | 只校验 `dist.shasum`(sha1); 只有 `--lockfile-path` 时校验 sha512                               | 与 npm 一致按 `dist.integrity` 中最强的算法校验(通常是 sha512), 没有 integrity 时才退回 sha1                                                                                  |
| 缺失的 peerDependencies                             | 只告警                                                                                         | 与 npm 7+ 一致自动安装为该包的依赖, 失败时按可选依赖跳过并告警(npm 直接报错); 祖先已声明不兼容版本时只告警; `--legacy-peer-deps` 恢复只告警                                                 |

### 移除的参数与配置

| 项                                                                         | 上游 6.8.0                                        | easy-npd                                                                               |
| -------------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `-c`, `--china`, `npm_china`                                               | 切换到 npmmirror 与二进制镜像                     | 移除, 由自动切换取代                                                                   |
| `--custom-china-mirror-url`                                                | 替换二进制镜像地址                                | 移除                                                                                   |
| `--prune`, `config.npminstall.prune`, `env:production` / `env:development` | 解压时按固定名单跳过文件                          | 移除: 名单含 `tsconfig.json`, `LICENSE`, `images/` 等, 会静默破坏 `@tsconfig/*` 这类包 |
| `--force-link-latest`                                                      | 见「根目录提升链接」                              | 移除, 始终链接最高版本                                                                 |
| `--disable-dedupe`, `config.npminstall.disableDedupe`                      | 关闭根目录扁平链接                                | 移除                                                                                   |

## 安装范围

| 命令        | 安装内容                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------ |
| `npd`       | 根 `package.json` 的全部依赖, 并执行根包的生命周期脚本                                                 |
| `npd <pkg>` | 只安装 `<pkg>` 并写入 `package.json`(`--no-save` 不写入); 不刷新其余已声明依赖, 不执行根包生命周期脚本 |

## node_modules 布局

包实体位于 `node_modules/_<name>@<version>@<name>`, 依赖链接在各自的 `node_modules` 下; 每个包的最高版本另链接到根 `node_modules/<name>`.

## Node.js 版本与能力

不提高 `engines` 下限: 低版本 Node.js 上按能力改用兼容的旧实现, 每次运行打印一条 `npd WARN Node vX: <降级项>, upgrade to Node >= <版本> to restore`; 环境变量 `np_node_warning=false` 关闭. 版本划分见 `lib/runtime.js` 的 `CAPABILITIES`.

| Node.js | node-gyp(依赖的安装脚本与 `binding.gyp` 构建使用) | 已知风险 |
| --- | --- | --- |
| 20.17 ~ 20.x, >= 22.9 | 12 | 无 |
| 16.14 ~ 20.16, 21.x, 22.0 ~ 22.8 | 10: 较新的 Python 与 Visual Studio 可能不受支持 | node-gyp 10 经 make-fetch-happen / cacache 引入的 tar 6 与 http-cache-semantics 有未修复公告, 只在 node-gyp 下载 Node.js 头文件时使用; 顶层 tar 7 声明需要 Node >= 18, Node 16 上实测可用 |

全部版本共有的依赖公告:

- urllib 3 依赖的 undici 5: 公告集中在 WebSocket, fetch, Cookie, multipart 与 retry 拦截器, npd 不经过这些路径; 请求走私一类需要恶意 registry 或代理配合. 跨源重定向时 undici 会去掉 `Authorization`, 有用例覆盖.

## License

MIT, 见 [LICENSE.txt](./LICENSE.txt).
