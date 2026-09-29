# Changelog

easy-np 基于 [cnpm/npminstall](https://github.com/cnpm/npminstall) 8.0.1, 上游历史版本见 [npminstall CHANGELOG](https://github.com/cnpm/npminstall/blob/master/CHANGELOG.md).

## 0.0.0 (2026-09-28)

首个版本, 相对 npminstall 8.0.1 的全部变更如下.

### 命名

- 包名 `easy-np`; 命令 `np`, `np-link`, `np-uninstall`, `np-update`; User-Agent 为 `easy-np/<version>`.
- 默认缓存目录 `~/.np_tarball`, 缓存环境变量 `np_cache`, `package.json` 配置键 `config.np`, 安装完成标记 `__np_done`; 由 npminstall 装出的 `node_modules` 需删除后重装.

### 新功能

- 自动在 npmmirror 与 npmjs 之间切换: 每次运行先测速决定先后, manifest, tgz 与依赖安装脚本失败时交替换源, 最多 4 次; 镜像缺版本时向官方源重拉; 私有源与单独指定 registry 的 scope 不切换. `-c` 改为跳过测速, 镜像优先.
- `--refresh-cache`: 忽略并覆盖已有的 manifest 与 tgz 缓存.
- `np-fetch` / `np --fetch-only`: 只下载解压列出的包, 不安装依赖, 不执行脚本, 不链接 bin, 不修改 `package.json`.
- `--dedup`: 把依赖树中每个包的最高版本链接到根 `node_modules`, 即 npminstall@6 的扁平效果.
- `--public-hoist-pattern=<regexp>` 与 `config.np.publicHoistPattern` 指定根目录提升规则, 默认不提升.
- 提升到根目录的包始终取本次安装涉及的全部依赖树中的最高版本, 与 workspace 安装顺序无关; `package.json` 声明的依赖保持声明版本; 部分安装(`np <pkg>`, `-w`, `--workspaces`)只升级不降级.
- 支持 `workspace:*`, `workspace:^`, `workspace:~` 与 `workspace:<range>`.
- `config.np` 在 `np` 与 `np <pkg>` 时都读取.
- manifest 缓存按包名分目录: `np-manifests/<name>/<hash>.json`.

### 修复

- 缓存中的 tgz 损坏时删除并重新下载, 不再每次重试都读到同一个坏文件.
- 流式请求收到 4xx / 5xx 时不再因断开响应流抛出未捕获的 abort 错误.
- 根目录已存在但完成标记为 false 的包(`np-fetch` 解压或上次安装失败留下)不再因版本满足而跳过, 完整安装会重新处理并补齐依赖.
- registry token 只发送给与 registry 同 host 的请求, 不再泄露给备用 registry 与 tarball CDN.
- workspace 按依赖关系拓扑排序安装与执行生命周期脚本.
- 在 workspace 仓库执行 `np -g` 不再删除本地 `node_modules` 下与 workspace 同名的目录.
- `np-update -w <name>` 只清理该 workspace, 不再破坏其他 workspace 共享的 `.store`.
- workspace 下由根包提供的 peerDependencies 不再误报未安装.
- `np-uninstall` 后移除已无人使用的提升链接与 `.store/node_modules` 回退链接.
- workspace 版本不满足声明范围时告警; 依赖指向本地 workspace 时日志给出真实目录.
- `--lockfile-path` 加载失败时报错退出, 不再静默回退为联网解析; workspace 下暂不支持并直接报错.
- 在 `npm run` / `npx` 下安装需要 prepare 的 git 依赖时, 不再因继承 `npm_config_allow_scripts` 被 npm 12 以 `EALLOWSCRIPTS` 拒绝; git 依赖安装失败时报错附带子进程 stderr.
- `np-uninstall` 等待 `package.json` 写回完成后再返回.

### 移除

- `--prune` 与 `config.np.prune`: 按固定名单跳过解压文件会误删 `tsconfig.json` 等运行时文件.
- `--proxy`, `npm_proxy`, `npm_config_proxy` 与 npm `strict-ssl`: urllib 不支持对应参数, 从未生效.
- `--force-link-latest`, `--disable-fallback-store`, `np-uninstall --ignore-scripts`.
- `config.npminstall.env:production` / `env:development`, `.npmrc` 的 `np-public-hoist-pattern`.
- `--tarball-url-mapping` 不再声称改写重定向地址, 只改写首个请求地址.

### 运行环境

- Node.js >= 16.14.0; 依赖调整为 `@npmcli/arborist` 6, `pacote` 15, `node-gyp` 10, `urllib` 3, `tar` 7.
- 开发工具改为 oxlint 与 oxfmt; 测试由 egg-bin 改为直接使用 mocha 11 与 c8.
