# easy-np

npm 包安装工具: 依赖装在 `node_modules/.store` 中再链接到各自的 `node_modules`, 支持 npm workspaces, 公共源自动测速切换, 失败后从断点继续. 提供两个入口: `np-x` 贴近 npm / pnpm; `np` 等同 `np-x install --no-lockfile --dangerously-allow-all-scripts`, 保持 npminstall 的默认习惯. 代码起源于 cnpm/npminstall, 见「来源」; 按版本列出的变更见 [CHANGELOG.md](./CHANGELOG.md).

## 安装

需要 Node.js >= 14.18.0; 编译原生模块时需要 Python 3 与 C/C++ 编译工具链. node-gyp 不随包安装, 见「Node.js 版本与能力」.

```bash
npm i -g easy-np
```

- 安装未发布的代码: 在本仓库 `packages/easy-np` 下执行 `npm pack`, 再 `npm i -g ./easy-np-<version>.tgz`.
- 命令重名: 全局命令 `np` 与 npm 包 [`np`](https://www.npmjs.com/package/np)(sindresorhus 的发布工具)同名. 全局已装其中一个时再装另一个会报 `EEXIST`, 加 `--force` 才覆盖; 作为项目依赖时互不影响.

## 两个入口

`np` 就是 `np-x install` 加上 `--no-lockfile --dangerously-allow-all-scripts`, 其余行为完全相同. 这两个参数视同在命令行传入, 环境变量与配置文件(`np_lockfile`, `config.np.lockfile`, `npm_config_*`, `~/.nprc`, `.npmrc`, pnpm 设置)都不能改变它们, 只能在命令行用 `--lockfile` / `--frozen-lockfile` 与 `--no-dangerously-allow-all-scripts` 覆盖.

| 默认行为       | `np`     | `np-x install`                                 |
| -------------- | -------- | ---------------------------------------------- |
| `np-lock.json` | 不读写   | 读写                                           |
| 依赖的安装脚本 | 全部执行 | 按 `allowScripts` 放行, 见「依赖安装脚本放行」 |

在 `np-x` 执行的安装脚本里再调用 `np`(含经 `npm_execpath`)时按 `np-x install` 处理, 不补上这两个参数.

## 命令

来源列: `npminstall` 表示 npminstall 已有, `新增` 表示本仓新增, `改名` / `改义` 表示本仓改了名称或含义.

| 命令                   | 别名            | 作用                                                         | 来源                    |
| ---------------------- | --------------- | ------------------------------------------------------------ | ----------------------- |
| `np` / `np-x install`  | `i`, `add`      | 安装依赖                                                     | 改名, 原 `npminstall`   |
| `np-x uninstall`       | `remove`, `rm`  | 卸载包, 移除不再被使用的提升链接, 并回收不再被引用的包版本   | 改名, 原 `npmuninstall` |
| `np-x update`          | `up`, `upgrade` | 删除 `node_modules` 后重装, 忽略 `np-lock.json` 的锁定版本   | 改名, 原 `npmupdate`    |
| `np-x link`            | `ln`            | 链接本地目录; 不带参数时把当前包安装并链接到全局             | 改名, 原 `npmlink`      |
| `np-x fetch`           | 无              | 只下载并解压指定的包, 不安装依赖, 不执行脚本; 不支持 git 包  | 新增                    |
| `np-x rebuild`         | 无              | 重跑已安装依赖的 preinstall / install / postinstall          | 新增                    |
| `np-x approve-scripts` | `approve`       | 把依赖写入 `package.json` 的 `allowScripts`, 放行其安装脚本  | 新增                    |
| `np-x deny-scripts`    | `deny`          | 在 `allowScripts` 中写入拒绝条目, 并删除同一包已有的放行条目 | 新增                    |
| `np-x prune`           | 无              | 删除 `node_modules/.store` 中不再被任何链接引用的包版本      | 新增                    |
| `np-x help <command>`  | 无              | 显示子命令的帮助, 同 `np-x <command> -h`                     | 新增                    |

- 全部命令都支持 `-v, --version` 与 `-h, --help`; `np-x -h` 列出全部子命令.
- 在 workspace 目录中运行 `np`, `np-x uninstall`, `np-x update` 时以上层项目为根, 只处理这个 workspace, 与 npm 7+ 一致; `np-x approve-scripts`, `deny-scripts`, `prune` 在 workspace 目录中运行时作用于整个项目.

## install 参数

`np [<pkg> ...] [options]`; `<pkg>` 可写 `<name>[@<tag|version|range>]`, `<alias>@npm:<name>`, 本地目录, tarball 文件, tarball url, git url 或 `<user>/<repo>`. 不带 `<pkg>` 时安装 `package.json` 的依赖; 带 `<pkg>` 时只安装并保存这些包, 不刷新其余依赖, 不执行根包生命周期脚本.

### 依赖类型

`<type>` 对应根 `package.json` 的字段: `prod` 是 `dependencies`, `dev`, `optional`, `peer` 是对应的 `*Dependencies`, 其他类型是 `<type>Dependencies`(如 cnpm 的 `client`, `build`, `isomorphic`). 下表参数都接受任意类型.

| 参数                                            | 含义                                                            | 来源                                      |
| ----------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------- |
| `--only=<type>[,...]`                           | 只安装这些字段                                                  | 新增                                      |
| `--include=<type>[,...]`                        | 另外安装这些字段                                                | 新增                                      |
| `--omit=<type>[,...]`, `--exclude=<type>[,...]` | 跳过这些字段                                                    | 新增                                      |
| `--prod`                                        | 同 `--only=prod`                                                | 新增                                      |
| `--production`                                  | 同 `NODE_ENV=production`                                        | 改义: 不再关闭磁盘缓存, 不再强制详细日志  |
| `--write=<type>`                                | 带 `<pkg>` 时保存到该字段而不是 `dependencies`, 只接受 `=` 写法 | 新增, 取代 `-D`, `-O`, `--save-*`         |
| `--write-exact`                                 | 保存精确版本而不是 `^` 范围                                     | 改名, 原 `-E`, `--save-exact`             |
| `--no-save`, `--no-write`                       | 不修改 `package.json`                                           | `--no-save` npminstall, `--no-write` 新增 |
| `--engine-strict`                               | 拒绝 `engines.node` 不兼容当前 Node.js 的包                     | npminstall                                |

- 不传 `--only` 时安装 `prod`, `dev`, `optional`; `--production` 或 `NODE_ENV=production` 追加 `--omit=dev`; `--omit=optional` 同时跳过整棵树的可选依赖, `--omit=peer` 停止自动安装缺失的 peerDependencies.
- `--only` 只按列出的字段安装, 不附带其他逻辑; 依赖树内的包自己的可选依赖与缺失的 peer 照常安装.
- 同时出现在 `--include` 与 `--omit` 中的类型照常安装; 自定义类型在根项目与各 workspace 的 `package.json` 中都没有对应字段时报错; 不传 `--only` 时未安装的非标准字段会告警.

### 锁文件

| 参数                          | 含义                                                                             | 来源                       |
| ----------------------------- | -------------------------------------------------------------------------------- | -------------------------- |
| `--lockfile`, `--no-lockfile` | 读写 `np-lock.json` 与否, 默认开; `np` 固定补上 `--no-lockfile`                  | 新增                       |
| `--frozen-lockfile`           | 只按 `np-lock.json` 安装, 缺少条目时报错, 不写回; 不能与包名同用                 | 新增                       |
| `--from-package-lock=<file>`  | 按 package-lock.json(lockfileVersion >= 2)中锁定的版本安装, 其中的可选依赖被忽略 | 改名, 原 `--lockfile-path` |

### 安装脚本

| 参数                              | 含义                                                                              | 来源       |
| --------------------------------- | --------------------------------------------------------------------------------- | ---------- |
| `--ignore-scripts`                | 不执行任何安装脚本, 也不构建 git 依赖与根项目的 `binding.gyp`                     | npminstall |
| `--allow-scripts=<pkg>[,<pkg>]`   | 放行这些依赖的安装脚本, 覆盖 `allowScripts`; 主要用于 `-g`                        | 新增       |
| `--strict-allow-scripts`          | 有未审核的依赖脚本时以非 0 退出                                                   | 新增       |
| `--dangerously-allow-all-scripts` | 忽略 `allowScripts`, 执行全部依赖脚本; 默认关, `np` 固定补上, 加 `--no-` 前缀关闭 | 新增       |
| `--foreground-scripts`            | 显示依赖安装脚本的输出, 默认在后台执行; 根项目与本地目录依赖的脚本总是显示        | npminstall |

### registry 与网络

| 参数                                         | 含义                                                                                                                                | 来源                                             |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `-r, --registry=<url>`                       | 指定源, 未传时依次取 `npm_registry`, `~/.nprc`, `.npmrc` / `npm_config_registry`; 5 个公共源仍自动测速切换, 其他源关闭切换             | npminstall                                       |
| `--probe-cache=<minutes>`                    | 复用上次测速结果的时长, 默认 5, `0` 每次测速                                                                                        | 新增                                             |
| `--proxy=<url>`, `--https-proxy=<url>`       | http / https 代理, 同时传给安装脚本, node-gyp 与 git                                                                                | `--proxy` 改义: 修复为生效; `--https-proxy` 新增 |
| `--noproxy=<host>[,<host>]`                  | 不走代理的 host                                                                                                                     | 新增                                             |
| `--cafile=<file>`                            | https 请求使用的 CA 证书, 相对路径按当前目录解析                                                                                    | 新增                                             |
| `--strict-ssl`, `--no-strict-ssl`            | 是否校验证书, 默认校验; `--strict-ssl` 覆盖环境中继承的 `npm_config_strict_ssl=false`                                               | 改义: 修复为生效                                 |
| `--registry-only`                            | 有包来自 git 或远程 url 时失败                                                                                                      | npminstall                                       |
| `--forbidden-licenses=<license>[,<license>]` | 有包使用这些许可证时失败                                                                                                            | npminstall                                       |

### 缓存

| 参数               | 含义                                                                 | 来源                         |
| ------------------ | -------------------------------------------------------------------- | ---------------------------- |
| `--offline`        | 只读磁盘缓存, 不发任何请求(含测速); 不支持 git 包与 tarball url 依赖 | 改义: 原来缓存缺失时仍会联网 |
| `--prefer-offline` | 有缓存的 manifest 不联网校验, 缓存缺失的包才联网                     | 新增                         |
| `--refresh-cache`  | 忽略已有的 manifest 与 tgz 缓存, 重新下载并覆盖                      | 新增                         |
| `--no-cache`       | 不使用磁盘缓存与测速缓存; 不能与 `--offline` 同用                    | npminstall                   |

### workspace 与提升

| 参数                              | 含义                                                                            | 来源                    |
| --------------------------------- | ------------------------------------------------------------------------------- | ----------------------- |
| `--ws, --workspaces`              | 安装全部 workspace, 不含根包自身依赖; 带 `<pkg>` 时加到每个 workspace           | npminstall, `--ws` 新增 |
| `--shamefully-hoist`              | 把每个包的最高版本链接到 `<root>/node_modules`, 优先于 `--public-hoist-pattern` | 改名, 原 `--dedup`      |
| `--public-hoist-pattern=<regexp>` | 把名称匹配的包以最高版本链接到 `<root>/node_modules`                            | 新增                    |

### 全局安装与输出

| 参数             | 含义                                   | 来源       |
| ---------------- | -------------------------------------- | ---------- |
| `-g, --global`   | 安装到全局目录                         | npminstall |
| `--prefix=<dir>` | 全局前缀, 默认 `npm config get prefix` | npminstall |
| `--detail`       | 输出详细日志                           | npminstall |
| `--trace`        | 输出安装过程的内存与 CPU 占用          | npminstall |

## 其他命令的参数

| 命令                                   | 参数                                                                                                                             | 来源                                    |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `np-x uninstall <pkg>[@<version>] ...` | `-g, --global`; `--prefix=<dir>`; `--ws, --workspaces`; `--write=<type>`: 另外从 `<type>Dependencies` 删除, 四个标准字段总是删除 | `--write`, `--ws` 新增, 其余 npminstall |
| `np-x update`                          | `--clean-only`: 只删除 `node_modules` 不重装; 其余 install 参数传给重装                                                          | npminstall                              |
| `np-x link [<folder> ...]`             | `--prefix=<dir>`; 写成 `--name` 或 `--name=value` 的 install 参数传给它执行的安装                                                | npminstall                              |
| `np-x fetch <pkg> ...`                 | `-r, --registry`, 代理与证书参数, `--offline`, `--prefer-offline`, `--refresh-cache`, `--no-cache`                               | 新增                                    |
| `np-x rebuild [<pkg>[@<range>] ...]`   | install 参数(如 `--registry`, `--offline`, `--ignore-scripts`)同样生效                                                           | 新增                                    |
| `np-x approve-scripts <pkg> ...`       | `--all`: 放行全部未审核的包; `--pending`: 只列出; `--no-pin`: 只写包名或不带 commit 的地址                                       | 新增                                    |
| `np-x deny-scripts <pkg> ...`          | `--all`: 拒绝全部未审核的包                                                                                                      | 新增                                    |
| `np-x prune`                           | `--dry-run`: 只列出不删除                                                                                                        | 新增                                    |

## 环境变量与配置

| 环境变量                                                                                                    | 作用                                                                          |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `NODE_ENV=production`                                                                                       | 同 `--production`                                                             |
| `np_lockfile=true\|false`                                                                                   | 开关 `np-lock.json`, 优先于 `config.np.lockfile`                              |
| `np_cache`, `npm_config_cache`                                                                              | 磁盘缓存目录, 默认 `~/.np_tarball`, `np_cache` 优先                           |
| `np_probe_cache`                                                                                            | 同 `--probe-cache`                                                            |
| `np_node_warning=false`                                                                                     | 关闭低版本 Node.js 的降级提示                                                 |
| `npm_registry`                                                                                              | 未传 `--registry` 时使用的源                                                  |
| `npm_config_node_gyp`                                                                                       | 指向已有的 `node-gyp.js`, 不再按需安装                                        |
| `npm_config_proxy`, `npm_config_https_proxy`, `npm_config_noproxy`, `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY` | 未传代理参数时依次读取 `npm_config_*`, `~/.nprc`, `HTTP_PROXY` 等(含小写形式) |
| `npm_config_strict_ssl`, `npm_config_cafile`                                                                | 同 `--strict-ssl`, `--cafile`                                                 |
| `npm_config_dangerously_allow_all_scripts`, `npm_config_strict_allow_scripts`                               | 同对应参数                                                                    |

| 配置位置                                                  | 读取的键                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `~/.nprc`(与 easy-npd 共用)                               | `registry`, `@scope:registry`, `<registry>:username` / `:_password`, `proxy`, `https-proxy`, `noproxy`, `cafile`, `strict-ssl`, `allow-scripts`, `dangerously-allow-all-scripts`, `strict-allow-scripts`                                                                                              |
| 根 `package.json`                                         | 依赖字段, `allowScripts`, `overrides`, `resolutions`, `workspaces`, `config.np.lockfile`, `config.np.publicHoistPattern`                                                                                                                                                                              |
| `.npmrc` 与 `npm_config_*`                                | `<registry>:_authToken`, `prefix`, 经 `npm config get` 读取的 `ignore-scripts`, `save-prefix`, 以及 `registry`, `@scope:registry`, `dangerously-allow-all-scripts`, `strict-allow-scripts`, `lockfile`, `package-lock`, `shamefully-hoist`, `public-hoist-pattern`, `node-linker`, `install-strategy` |
| `pnpm-workspace.yaml`, 其次 `package.json` 的 `pnpm` 字段 | `onlyBuiltDependencies`, `ignoredBuiltDependencies`, `neverBuiltDependencies`, `allowBuilds`, `dangerouslyAllowAllBuilds`, `strictDepBuilds`, `lockfile`, `shamefullyHoist`, `publicHoistPattern`, `nodeLinker`, `packages`(`package.json` 没有 `workspaces` 时作为 workspaces)                       |

`.npmrc` 从当前目录向上查找, 并包含 `~/.npmrc` 与 `npm_config_*` 环境变量; 命令行与 `~/.nprc` 优先于 `.npmrc`. 安装源依次取 `--registry`, `npm_registry`, `~/.nprc`, `.npmrc` / `npm_config_registry`; scope 源依次取 `~/.nprc`, `.npmrc` 的 `@scope:registry`.

## 功能说明

### 自动切换公共源

未指定私有源时, 自动在以下 5 个公共源之间选择: npm(`registry.npmjs.org`), yarn(`registry.yarnpkg.com`), alibaba(`registry.npmmirror.com`), tencent(`mirrors.tencent.com/npm`), huawei(`mirrors.huaweicloud.com/repository/npm`).

- 选源: 每次运行开始时同时请求各源上的同一个小文件, 记住最先返回的 3 个源及先后, 不足 3 个时按上面的顺序补足; 结果保存在 `~/.np_tarball/np-probe.json`(与 easy-npd 共用), 默认 5 分钟内复用.
- 换源重试: manifest 与 tgz 失败时按这 3 个源的先后逐个重试, 最多循环 2 轮, 连同首次最多 6 次.
- 二进制源: 只在 npmmirror 二进制镜像与官方地址之间选择, 同样测速决定先后; 依赖的安装脚本下载二进制文件或 Node.js 头文件失败时两者交替重试, 连同首次最多 4 次. 指定公共源或离线而不测速时, 二进制跟随排第一的源: npm / yarn 走官方地址, 其余走镜像.
- 镜像同步滞后: 镜像的 manifest 里没有要安装的版本时, 改从官方源(npm)获取.
- 指定 5 个公共源之一时它排第一, 其余 2 个仍按测速; 指定私有源时完全关闭切换; 为某个 scope 单独指定 registry 时只关闭这个 scope 的切换. 「指定」包括 `--registry`, `npm_registry`, `~/.nprc` 与 `.npmrc` / `npm_config_registry`, 例如项目 `.npmrc` 写了私有源时两个入口都改从私有源安装.

### 失败后继续

- 一个包失败(下载, 子依赖或脚本失败)不中止整次安装: 其余包照常安装, 结束时列出全部失败的包, 退出码为 1.
- 有依赖失败时跳过根包自身的生命周期脚本, 下次安装成功后再执行.
- 再次运行 `np` 即从断点继续: 不重新下载解压, 已成功的脚本不再执行, 不需要删除 `node_modules`.
- 可选依赖本身或它的子依赖失败时与 npm 一样只跳过, 结束时列出它们和重跑的 `np-x rebuild <pkg>` 命令.
- 多个 workspace, 以及 `np -g` 一次安装多个包时同样适用.

阶段记录在 `node_modules/.store/.np-state.json`, 依次为 `deps`, `preinstall`, `install`, `postinstall`, `finish`; 本次运行没有失败时统一清除. 不修改依赖包自己的 `package.json`. 切换 Node.js 版本后用 `np-x rebuild` 重新编译原生模块; 普通的失败或中断不需要 rebuild.

### 依赖安装脚本放行

适用于 `np-x install`, 以及传了 `--no-dangerously-allow-all-scripts` 的 `np`. 与 npm 12 一致, 依赖的 preinstall / install / postinstall, 有 `binding.gyp` 时的隐式 `node-gyp rebuild`, 以及 git 依赖的构建, 只有在根 `package.json` 的 `allowScripts` 中放行后才执行; 根项目, workspace 以及它们声明的本地目录依赖的脚本照常执行. 未放行的包被跳过, 安装结束时列出它们和放行后重跑的命令.

```json
{
  "allowScripts": {
    "esbuild": true,
    "sharp@0.33.5": true,
    "core-js": false
  }
}
```

- 键写包名(全部版本), `<name>@<精确版本>` 或用 `||` 连接的多个精确版本, git 地址, tarball url; 范围与 dist-tag 告警后忽略. `false` 表示拒绝, 同时命中时拒绝优先.
- 来源只取第一个有配置的: `--allow-scripts` > 根 `package.json` 的 `allowScripts` > pnpm 的构建设置 > `~/.nprc` 的 `allow-scripts`. pnpm 的 `onlyBuiltDependencies` 视为放行, `ignoredBuiltDependencies` 与 `neverBuiltDependencies` 视为拒绝, `allowBuilds` 按布尔值; 只有 `neverBuiltDependencies` 时放行其余全部依赖.
- `--strict-allow-scripts` 与 `--dangerously-allow-all-scripts` 的优先级: 命令行 > `npm_config_*` > `~/.nprc` > `.npmrc` > pnpm 的 `strictDepBuilds` / `dangerouslyAllowAllBuilds` > 默认关; `np` 补上的 `--dangerously-allow-all-scripts` 属于命令行. `--ignore-scripts` 优先于以上全部.
- registry 包按 registry 上的 `name@version` 审核; tarball 内 `package.json` 自称其他包时告警 `manifest mismatch`, 不借用被冒充包的放行.
- registry, git 与 tarball url 包声明的 `file:` 本地依赖跟随声明者是否放行, 只执行 preinstall / install / postinstall, 跳过列表中显示为 `<name>@<spec> (declared by <声明者>)`.
- git 依赖声明了 prepare, build, install 等脚本或 workspaces 时需要构建, 构建前按仓库地址审核; 构建的子安装不执行任何依赖脚本, 嵌套 git 依赖不构建, 不读取克隆仓库自带的 `allowScripts` 与 `~/.nprc`, 不读写 `np-lock.json`.
- 全局安装时被装的包自身的脚本照常执行, 它声明的本地依赖要用 `--allow-scripts=<pkg>` 或 `~/.nprc` 放行被装的包才执行.
- `np-x approve-scripts <pkg>` 按已安装版本写入 `<pkg>@<version>`(git 依赖写地址与 commit, tarball url 依赖写 url, 都去掉凭据), 之后运行 `np-x rebuild <pkg>` 执行脚本; git 依赖在获取时构建, 放行后按提示删除它的 `.store` 目录再运行 `np`. `np-x deny-scripts` 与 npm 一致写不带版本的 `false` 条目. 首次写入 `allowScripts` 时先并入 pnpm 的构建设置.

### `np-lock.json`

- 启用时安装成功后在项目根目录(workspace 为 workspace 根)写入 `np-lock.json`, 记录每个依赖声明(`name@spec`)解析出的版本, 再次安装直接复用; 与 easy-npd 读写同一份文件.
- 开关取第一个有配置的: `--lockfile` / `--no-lockfile` > `--frozen-lockfile`(视为开启) > `np_lockfile` > `config.np.lockfile` > pnpm 与 `.npmrc` 的 `lockfile`, `package-lock` > 默认开; `np` 补上的 `--no-lockfile` 属于命令行.
- 完整安装只保留本次用到的条目; 带 `<pkg>`, 在 workspace 目录中, `--workspaces`, `--only`, `--omit` 与跳过了非标准字段的安装只追加.
- 已安装版本与锁定版本不同时直接换成锁定版本; `np-x update` 忽略锁定版本, 按范围重新解析并写回.
- `np <pkg>` 按保存进 `package.json` 的声明记录; 命令行显式写的 tag 与 `*`(含不写版本)每次重新解析.
- 项目已有其他包管理器的锁文件且没有 `np-lock.json` 时不生成; `--from-package-lock` 与 `-g` 时不读写.
- git 依赖锁定 commit, tarball url 依赖锁定 sha512 integrity, 本地目录依赖不锁定; URL 中的凭据不写进锁文件.

### workspace

- workspaces 取自 `package.json` 的 `workspaces`, 没有时取 `pnpm-workspace.yaml` 的 `packages`(支持 `!` 排除).
- 按依赖关系拓扑排序后依次安装与执行生命周期脚本; 有循环依赖时保持 glob 顺序并告警.
- 依赖名与某个 workspace 同名时总是链接本地 workspace; 支持 `workspace:*`, `workspace:^`, `workspace:~` 与 `workspace:<range>`.
- `--from-package-lock` 读取 npm 生成的 workspace lockfile, 各 workspace 按其中锁定的版本安装.

### 根目录提升

默认不提升间接依赖. `--shamefully-hoist` 提升全部包的最高版本(npminstall@6 的扁平效果); `--public-hoist-pattern` 或 `config.np.publicHoistPattern` 按正则提升; 两者都未指定时读取 pnpm 与 `.npmrc` 的 `shamefullyHoist`, `nodeLinker: hoisted` 与 npm 的 `install-strategy=hoisted`(均等同 `--shamefully-hoist`), 以及 `publicHoistPattern`(pnpm 的 glob, `!` 开头为排除). 完整安装会用本次结果替换上次的提升链接, 可能降级; 部分安装只升级不降级.

### npm `overrides`

支持根 `package.json` 的 `overrides`(workspace 下只读 workspace 根): 包名, `name@<range>` 选择器, 嵌套对象, `.` 与 `$name` 引用; 不改写根 `package.json` 的直接依赖. 同时存在 `resolutions` 时 `overrides` 优先.

### 缓存与布局

- 与 easy-npd 共用 `~/.nprc` 与磁盘缓存 `~/.np_tarball`; 各公共源共用同一份缓存, 换源不重复下载.
- 后台执行的依赖脚本失败时, 命令与完整输出写入缓存目录下的 `np-script-logs/<时间>-<name>@<version>-<随机串>.log`, 报错末尾给出路径; `--no-cache` 时写入 `np_cache`, `npm_config_cache` 或 `~/.np_tarball`; 超过 7 天的日志在下次写入时删除.
- 包实体位于 `node_modules/.store/<name>@<version>/node_modules/<name>`, 每个包的最高版本另链接到 `node_modules/.store/node_modules` 供 peer 回退解析; 根目录只放直接依赖与被提升的包.
- git, tarball url 与本地包在版本号后附加来源标识(`+git.<commit>`, `+url.<hash>`, `+file.<hash>`), 不占用同名同版本 registry 包的目录.
- 升级后旧版本留在 `.store`, 由 `np-x prune` 回收; `np-x uninstall` 结束时自动回收不再被任何链接引用的版本.

## 与 npminstall 的行为差异

npminstall 已有的功能中, 行为不同且对使用有影响的项:

| 项                             | npminstall                                                       | easy-np                                                                                                      |
| ------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 安装失败                       | 停在第一个错误                                                   | 继续安装其余包, 再次运行从断点继续                                                                           |
| 提升到根目录的包               | 固定提升名称匹配 eslint, prettier, babel 的包                    | 默认不提升, 见「根目录提升」                                                                                 |
| 提升链接的版本                 | 已有链接时保留                                                   | 始终取本次依赖树中的最高版本; 根 `package.json` 声明的依赖保持声明版本                                       |
| 缺失的 peerDependencies        | 只告警                                                           | 与 npm 7+ 一致自动安装, 失败时按可选依赖跳过                                                                 |
| 版本选择                       | 不看 `engines`                                                   | 与 npm 一致优先选 `engines.node` 兼容的版本                                                                  |
| tarball 完整性校验             | 只校验 sha1                                                      | 按 `dist.integrity` 中最强的算法校验                                                                         |
| registry 凭据                  | `.nprc` 用户名密码按子串匹配附加, `always-auth` 时附加到所有请求 | `.npmrc` 的 `_authToken` 与 `.nprc` 的用户名密码都只附加到与 registry 同 host 的请求, `always-auth` 不再生效 |
| `np-x uninstall`               | 保留提升链接; 可能在写回 `package.json` 前返回                   | 移除不再被使用的提升链接; 写回完成后返回                                                                     |
| git 依赖                       | 经 pacote 获取, 构建时调用 `npm install`                         | 直接调用 git CLI(本机需要 git), 用 np 自身安装构建依赖                                                       |
| 本地目录依赖                   | `npm pack`, 失败时复制整个目录                                   | 受信目录在 npm >= 7.18 时用 `npm pack`; 其余按 `files` 与 `.npmignore` 规则复制, 不执行脚本                  |
| 缓存中损坏的 tgz               | 每次重试都读到同一个坏文件                                       | 删除后重新下载                                                                                               |
| 重复传入的单值参数             | 部分取第一个, 部分变成数组后报错                                 | 与 npm 一致取最后一个; `--allow-scripts`, `--only`, `--include`, `--omit` 合并全部取值                       |
| `--from-package-lock` 加载失败 | 告警后改为联网解析                                               | 报错退出                                                                                                     |

## 弃用或移除的 npminstall 命令, 参数与特性

传入已移除的命令行参数时报错并提示替代写法; 已移除的环境变量与 `package.json` 配置(如 `npm_china`, `config.npminstall.*`)不再读取, 不会报错.

| 项                                                                         | 原含义                              | 现状 / 替代                                                                 |
| -------------------------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------- |
| `npminstall`, `npmuninstall`, `npmupdate`, `npmlink` 命令                  | 各子功能的独立命令                  | 改为 `np` 与 `np-x <command>`                                               |
| `-S/--save`                                                                | 保存到 `dependencies`               | 移除, 默认就保存到 `dependencies`                                           |
| `-D/--save-dev`, `-O/--save-optional`                                      | 保存到对应字段                      | `--write=dev`, `--write=optional`; `np-x uninstall` 同样改用 `--write`      |
| `-E/--save-exact`                                                          | 保存精确版本                        | `--write-exact`                                                             |
| `--client`, `--save-client`, `--save-build`, `--save-isomorphic`           | 安装或保存 cnpm 的三类依赖字段      | `--only`, `--include`, `--write=<type>`; 默认不再安装这三类字段             |
| `--no-optional`, `--legacy-peer-deps`                                      | 跳过可选依赖, 不自动安装 peer       | `--omit=optional`, `--omit=peer`                                            |
| `--production` 关闭磁盘缓存, `--cache-strict`                              | 生产模式默认不用缓存                | 移除, `--production` 照常使用缓存; 不用缓存时传 `--no-cache`                |
| `--root`, `-w`, `--workspace`                                              | 指定项目目录或 workspace            | 移除, 在对应目录中运行                                                      |
| `--dedup`                                                                  | 扁平提升(本仓早期参数)              | 改名 `--shamefully-hoist`                                                   |
| `--lockfile-path`                                                          | 按 package-lock.json 安装           | 改名 `--from-package-lock`                                                  |
| `-d`                                                                       | `--detail` 的简写                   | 移除, 用 `--detail`                                                         |
| `--fetch-only`, `--rebuild`                                                | 安装参数形式的 fetch 与 rebuild     | 移除, 用 `np-x fetch`, `np-x rebuild`                                       |
| `--dependencies-tree`, `--save-dependencies-tree`                          | 按依赖树文件安装, 或保存依赖树      | 移除, 由 `np-lock.json` 取代                                                |
| `--flatten`, `--fix-bug-versions`, `--tarball-url-mapping`                 | 依赖版本修正与 tarball 地址改写     | 移除                                                                        |
| `-c`, `--china`, `npm_china`                                               | 切换到 npmmirror 与二进制镜像       | 移除, 由自动切换取代                                                        |
| `--custom-china-mirror-url`                                                | 替换二进制镜像地址                  | 移除                                                                        |
| `--prune`, `config.npminstall.prune`, `env:production` / `env:development` | 解压时按固定名单跳过文件            | 移除: 名单含 `tsconfig.json`, `LICENSE` 等, 会静默破坏 `@tsconfig/*` 这类包 |
| `--force-link-latest`                                                      | 用更高版本覆盖已有的提升链接        | 移除, 始终链接最高版本                                                      |
| `--disable-fallback-store`                                                 | 关闭 `.store/node_modules` 回退链接 | 移除, 回退链接始终建立                                                      |
| `np-x uninstall --ignore-scripts`                                          | 声明但无作用                        | 移除, 传入时报错; 卸载不执行任何生命周期脚本                                |

## Node.js 版本与能力

低版本 Node.js 上按能力改用兼容的旧实现, 每次运行打印一条 `np WARN Node vX: <降级项>, upgrade to Node >= <版本> to restore`; `np_node_warning=false` 关闭. 版本划分见 `lib/runtime.js` 的 `CAPABILITIES`.

node-gyp 不随包安装: 首次编译原生模块时联网安装兼容当前 Node.js 的版本到 `<缓存目录>/np-node-gyp`(按 Node.js 版本分别安装, 与 easy-npd 各自独立; 不再被引用且超过 1 小时的旧安装目录在下次安装时删除). `npm_config_node_gyp` 指向已有的 `node-gyp.js` 时直接使用; 无法联网时先 `npm i -g node-gyp`, 再把 `npm_config_node_gyp` 设为 `<npm root -g>/node-gyp/bin/node-gyp.js`.

| Node.js                                       | node-gyp(依赖的安装脚本与 `binding.gyp` 构建时按需安装)                                | 已知风险                                                                                            |
| --------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 20.17 ~ 20.x, >= 22.9                         | `node-gyp` 中 `engines.node` 兼容当前 Node.js 的最新版本(>= 12)                        | 无                                                                                                  |
| 16.14 ~ 16.x, 18.x ~ 20.16, 21.x, 22.0 ~ 22.8 | 同上, 实际为 10 或 11: 不识别 Visual Studio 2026                                       | 装到 10 时(16.14 ~ 16.x, 18.0 ~ 18.16)同样经 make-fetch-happen / cacache 引入 tar 6, 见下一行       |
| 14.18 ~ 16.13, 17.x                           | `@electron/node-gyp` 10.2(Electron 维护的 node-gyp 10 分支): 不识别 Visual Studio 2026 | 它经 make-fetch-happen / cacache 引入的 tar 6 有未修复公告, 只在 node-gyp 下载 Node.js 头文件时使用 |

本包顶层的 tar 7 声明需要 Node >= 18, Node 14.18 / 16 上实测可用(低于 16.6 时由 `lib/runtime.js` 补齐缺少的内置方法).

全部版本共有的依赖公告:

- urllib 3 依赖的 undici 5: 公告集中在 WebSocket, fetch, Cookie, multipart 与 retry 拦截器, np 不经过这些路径; 请求走私一类需要恶意 registry 或代理配合. 跨源重定向时 undici 会去掉 `Authorization`, 有用例覆盖.
- globby 依赖的 braces / micromatch: 深度嵌套的匹配模式会耗尽调用栈, np 只用它匹配 `package.json` 中的 workspaces 模式.

## 来源

代码起源于 [cnpm/npminstall](https://github.com/cnpm/npminstall) 8.0.1. 从 npminstall 迁移时注意以下命名与文件位置的变化:

| 项                  | npminstall                                                                   | easy-np                                                                                                 |
| ------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 包名与命令          | 包名 `npminstall`; 命令 `npminstall`, `npmlink`, `npmuninstall`, `npmupdate` | 包名 `easy-np`; 命令 `np` 与 `np-x`                                                                     |
| 用户配置文件        | `~/.cnpmrc`                                                                  | `~/.nprc`, 与 easy-npd 共用                                                                             |
| 缓存目录            | `~/.npminstall_tarball`, 环境变量 `npminstall_cache`                         | `~/.np_tarball`, 环境变量 `np_cache`; `npm_config_cache` 两边都认                                       |
| `package.json` 配置 | `config.npminstall`                                                          | `config.np`                                                                                             |
| 安装完成标记        | 包内 `package.json` 的 `__npminstall_done`                                   | `node_modules/.store/.np-state.json`; npminstall 装出的 `node_modules` 被视为未完成, 切换工具时先删除它 |
| User-Agent          | `npminstall/<version>`                                                       | `easy-np/<version>`                                                                                     |

## License

MIT, 见 [LICENSE.txt](./LICENSE.txt).
