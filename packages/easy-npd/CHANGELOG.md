# Changelog

easy-npd 基于 [cnpm/npminstall](https://github.com/cnpm/npminstall) 6.8.0, 上游历史版本见 [npminstall 6.x CHANGELOG](https://github.com/cnpm/npminstall/blob/6.x/CHANGELOG.md) 与更早的 [History.md](https://github.com/cnpm/npminstall/blob/6.x/History.md).

0.0.0 列出相对 npminstall 6.8.0 的全部变更, 分为「新增功能」与「与 npminstall 6.8.0 的差异」; 之后的版本只列相对上一个版本的变更.

## 0.0.3 (2026-10-06)

### 新增功能

- `np-lock.json`: 安装成功后在项目根目录记录每个依赖声明解析出的版本, 再次安装直接复用; 完整安装删除不再使用的条目, 部分安装只追加; `--frozen-lockfile` 只按锁文件安装, 缺少条目时报错; 已有其他包管理器的锁文件时不生成, `--no-lockfile` 或 `np_lockfile=false` 关闭. 与 easy-np 共用同一份文件.
- 支持 npm `overrides`: 包名, `name@<range>`, 嵌套对象, `.` 与 `$name` 引用; 同时存在 `resolutions` 时 `overrides` 优先.
- 缺失的 peerDependencies 与 npm 7+ 一样自动安装, 失败时按可选依赖跳过并告警; `--legacy-peer-deps` 恢复只告警.
- 公共源测速结果缓存在 `~/.np_tarball/np-probe.json`, 默认 5 分钟内复用; `--probe-cache=<分钟>` 或 `np_probe_cache` 修改, `0` 表示每次都测速.
- 代理: `--proxy`, `--https-proxy`, `--noproxy`, 未传时依次读取 `npm_config_*`, `~/.nprc`, `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY`; 同一份配置传给安装脚本, node-gyp 与 git.
- `--cafile` 指定 CA 证书, `--no-strict-ssl` 关闭证书校验, 同样传给安装脚本与 git.
- `np-lock.json` 锁定 git 依赖解析出的 commit 与 tarball url 依赖的 sha512 integrity: 再次安装直接检出锁定的 commit(不再 `git ls-remote`, 已装时不再克隆), tarball 内容变化时报错; `--frozen-lockfile` 下缺少条目同样报错. 本地目录依赖不锁定.
- `npd-x prune`: 删除不再被任何链接引用的包版本目录, `--dry-run` 只列出; 安装不会自动删除.

### 行为变更

- **依赖的安装脚本默认不执行**: 与 npm 12 一致, 依赖的 preinstall / install / postinstall, `binding.gyp` 隐式构建与 git 依赖的 prepare 只有在根 `package.json` 的 `allowScripts` 中放行后才执行, 结束时列出被跳过的包; 新增 `npd-x approve-scripts`, `npd-x deny-scripts`, `--allow-scripts`, `--strict-allow-scripts`, `--dangerously-allow-all-scripts`(恢复旧行为). 根项目与本地目录依赖不受影响.
- 未写版本或写 range 时与 npm 一致优先选 `engines.node` 兼容当前 Node.js 的版本, 例如 Node 18 下 `npd -g npm` 装 npm 10; 显式 tag 与精确版本不变. 不带版本安装时日志显示 `<name>@*`.
- 未写版本或写 range 时与 npm 一致避开 deprecated 版本: 优先级为未 deprecated > `engines.node` 兼容 > 版本高低; 范围内只有 deprecated 版本时仍选中并告警.
- 安装进度标记改记在 `node_modules/.npd-state.json`, 不再修改依赖包自己的 `package.json`; 之前版本写入的 `__npd_done` / `__npd_stage` 仍能识别, 升级后不必重装.

- git 依赖改为直接调用 git CLI: 托管仓库也走 git 克隆(本机需要 git), 不再下载 codeload tarball; 需要构建时用 npd 自身安装依赖(含 devDependencies, 不执行依赖的安装脚本)再执行 prepare, 不再调用 `npm install`; 按 npm 的 `files`, `.npmignore` 规则打包.

### 修复

- 联网安装按 `dist.integrity` 中最强的算法(通常是 sha512)校验 tarball, 之前只校验 sha1.
- `--save-dependencies-tree` 保存的依赖树补上 `cpu`, `libc`, `bin`, `peerDependenciesMeta`, `bundleDependencies` 等字段, 用它还原时不再在其他平台选错可选依赖.
- git 依赖准备超时结束整个进程树, 不再残留 prepare 脚本启动的进程.
- 同一个 git 仓库在一次安装中只执行一次 `git ls-remote`.
- `package.json` 的 `config.np.lockfile: false` 关闭 `np-lock.json`, 与 easy-np 同一个键.

### 运行环境

- node-gyp 升到 12; Node.js 低于 20.17(以及 21.x, 22.0 ~ 22.8)时改用别名依赖 `node-gyp10`(node-gyp 10), 并在每次运行时打印一条 `npd WARN Node vX: ...` 说明降级项与恢复所需的 Node.js 版本, `np_node_warning=false` 关闭. `engines` 下限仍为 16.14.
- 移除 `pacote` 与 `@npmcli/arborist`, 新增 `npm-packlist` 5.
- `urllib` 范围提到 `^3.27.3`, 保证使用跨源重定向时去掉认证头的 undici.

## 0.0.2 (2026-10-03)

### 新增功能

- 失败后继续: 一个包失败(下载, 子依赖或脚本)不再中止整次安装, 其余包照常安装, 结束时汇总全部失败的包并以退出码 1 结束; 有依赖失败时跳过根包自身的生命周期脚本; 可选依赖或其子依赖失败时与 npm 一样只跳过该可选依赖, 不计入失败. `npd -g` 一次安装多个包时同样适用.
- 断点续装: 每个包的 `package.json` 用 `__npd_stage` 记录安装停在的阶段. 安装失败或被中断后再次运行 `npd`, 各包从停下的阶段继续, 不重新解压, 已成功的脚本不再执行; 不再提示删除 `node_modules`.
- `npd-x rebuild` / `npd --rebuild`: 按依赖顺序重跑全部依赖的 preinstall / install / postinstall, 优先使用磁盘缓存, 缺少的包才联网下载; `npd-x rebuild <pkg>[@<version range>] ...` 只重跑列出的包的这三个脚本.
- 安装结束时列出失败后被跳过的可选依赖, 并给出重跑它们脚本的 `npd-x rebuild <pkg>` 命令.

### 不兼容变更

- 除 `npd` 外的命令合并为 `npd-x <command>`, 子命令与别名: `install`(`i`, `add`), `uninstall`(`un`, `remove`, `rm`, `r`), `update`(`up`, `upgrade`), `link`(`ln`), `fetch`, `rebuild`(`rb`). `npd-x -h` 列出子命令, `npd-x <command> -h` 与 `npd-x help <command>` 显示子命令参数.
- 移除命令 `npd-fetch`, `npd-link`, `npd-uninstall`, `npd-update`, 分别改用 `npd-x fetch`, `npd-x link`, `npd-x uninstall`, `npd-x update`.
- 入口文件 `bin/install.js` 改名为 `bin/i.js`, `bin` 下只保留 `i.js`(`npd`)与 `x.js`(`npd-x`); 用路径直接调用旧入口文件的脚本需改为调用 `npd` / `npd-x`.

### 修复

- 安装失败或被中断时, 已解压但子依赖或脚本还没完成的包不再被标记为完成; 之前再次运行会跳过这些包, 它们的脚本永远不会执行.
- 子依赖的脚本失败后, 再次运行能经由上层包重新找到并执行它; 之前只有根 `package.json` 的直接依赖会重试.
- 从断点继续或 `npd-x rebuild` 时, 安装脚本失败换源重试也能还原被二进制镜像改写过的文件: 改写前的内容保存在包目录的 `.npd-binary-snapshot.json`; 之前快照只在内存中, 进程退出后只能切换环境变量.
- `npd-x update` 重装时不再用环境变量通知 install 忽略包名; 之前重装期间, 依赖脚本里执行的 `npd <pkg>` 会被当作不带包名的安装.
- 根包的脚本失败时, 不再往项目自己的 `package.json` 写入 `__npd_done`.

## 0.0.1 (2026-10-02)

### 修复

- `npd-uninstall` 同时删除命令的 `.cmd` 与 `.ps1` 入口, 由其他工具在 macOS / Linux 上遗留的这两类文件也一并清理; `bin` 字段为字符串时不再按字符下标删除错误的路径.
- `npd -g` 重装或升级已安装的全局包, 以及 `npd-link` 覆盖同名全局包时, 先删除旧版本声明的全部命令入口, 新版本不再提供的命令不再残留.
- 局部安装时依赖换了版本, 旧版本声明而新版本不再声明的命令从 `node_modules/.bin` 删除; 只删确实指向旧版本目录的入口, 其他包的同名命令保留.

## 0.0.0 (2026-09-29)

首个版本.

### 新增功能

- 自动在 npmmirror 与 npmjs 之间切换: 每次运行先测速决定先后; manifest, tgz 与依赖安装脚本失败时交替换源, 最多 4 次; 镜像缺少要安装的版本时改从官方源获取; 私有源与单独指定 registry 的 scope 不切换.
- `--offline`: 只读磁盘缓存, 不发任何网络请求; manifest 或 tgz 不在缓存时立即失败, git 包与 tarball url 依赖直接报错.
- `--refresh-cache`: 忽略并覆盖已有的 manifest 与 tgz 缓存.
- `npd-fetch` / `npd --fetch-only`: 只下载并解压列出的包, 不安装依赖, 不执行脚本, 不链接 bin, 不修改 `package.json`.
- 与 easy-np 共用用户配置 `~/.nprc` 与磁盘缓存 `~/.np_tarball`.
- 全部命令的 `--help` 列出所有支持的参数.

### 与 npminstall 6.8.0 的差异

#### 命名

- 包名 `easy-npd`; 命令 `npd`, `npd-fetch`, `npd-link`, `npd-uninstall`, `npd-update`; User-Agent 为 `easy-npd/<version>`, 日志前缀与 debug 名空间为 `npd`.
- 用户配置文件由 `~/.cnpmrc` 改为 `~/.nprc`.
- 默认缓存目录 `~/.np_tarball`, 缓存环境变量 `np_cache`; 安装完成标记 `__npd_done`, 全局安装的 store 目录 `.<name>_npd`; 由 npminstall 装出的 `node_modules` 需删除后重装.

#### 行为变更

- 根目录提升链接始终指向最高版本; 完整安装时, 依赖变化后重装会更新上次的提升链接; 根 `package.json` 声明的包不覆盖. 上游已存在即跳过.
- 缓存目录改为 `np-manifests/<name>/<hash>.json`, `np-tgz/<name>/`, `np-tmp/<YYYYMMDD>/`; 公共源的 manifest 统一按官方源地址作为缓存键; 旧布局的缓存不再读取, 不再自动清理过期临时目录.

#### 修复

- 缓存中的 tgz 损坏时删除并重新下载, 不再每次重试都读到同一个坏文件.
- 流式请求收到 4xx / 5xx 时, 不再因断开响应流抛出未捕获的 abort 错误.
- 根目录已存在但完成标记为 false 的包(`npd-fetch` 解压或上次安装失败留下)不再因版本满足而跳过, 完整安装会重新处理并补齐依赖.
- `--lockfile-path` 加载失败时报错退出, 不再静默回退为联网解析.
- 在 `npm run` / `npx` 下安装需要 prepare 的 git 依赖时, 不再因继承 `npm_config_allow_scripts` 被 npm 12 以 `EALLOWSCRIPTS` 拒绝; git 依赖安装失败时报错附带子进程 stderr.
- `npd-uninstall` 等待 `package.json` 写回完成后再返回.
- `npd-uninstall` 后移除根 `node_modules` 中已无人使用的提升链接, 被卸载包的依赖不再仍可被 require.
- `.nprc` 中的 registry 用户名密码只发送给与 registry 同 host 的请求, `always-auth` 也不例外, 不再泄露给备用 registry, tarball CDN 与二进制镜像.

#### 移除

- `-c`, `--china` 与 `npm_china`: 由 npmmirror 与 npmjs 的自动切换取代.
- `--custom-china-mirror-url`.
- `--prune`, `config.npminstall.prune` 与 `env:production` / `env:development`: 按固定名单跳过解压文件, 会误删 `tsconfig.json` 等运行时文件.
- `--proxy`, `npm_proxy`, `npm_config_proxy` 与 npm `strict-ssl`: urllib 3 不支持对应参数, 从未生效.
- `--force-link-latest`, `--disable-dedupe` 与 `config.npminstall.disableDedupe`.
- `--tarball-url-mapping` 不再声称改写重定向地址, 只改写首个请求地址.

#### 运行环境

- Node.js >= 16.14.0; 依赖调整为 `node-gyp` 10, `tar` 7.
- 开发工具改为 oxlint 与 oxfmt; 测试由 egg-bin 改为直接使用 mocha 11 与 c8.
