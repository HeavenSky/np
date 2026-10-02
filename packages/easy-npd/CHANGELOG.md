# Changelog

easy-npd 基于 [cnpm/npminstall](https://github.com/cnpm/npminstall) 6.8.0, 上游历史版本见 [npminstall 6.x CHANGELOG](https://github.com/cnpm/npminstall/blob/6.x/CHANGELOG.md) 与更早的 [History.md](https://github.com/cnpm/npminstall/blob/6.x/History.md).

## 0.0.1 (2026-10-02)

### 修复

- `npd-uninstall` 同时删除命令的 `.cmd` 与 `.ps1` 入口, 由其他工具在 macOS / Linux 上遗留的这两类文件也一并清理; 字符串形式的 `bin` 字段不再按字符下标删除错误路径.
- `npd -g` 重装或升级已安装的全局包, 以及 `npd-link` 覆盖同名全局包时, 先删除旧版本声明的全部命令入口, 新版本不再提供的命令不再残留.
- 局部安装时依赖换了版本, 旧版本声明而新版本不再声明的命令从 `node_modules/.bin` 删除; 只删确实指向旧版本目录的入口, 其他包的同名命令保留.

## 0.0.0 (2026-09-29)

首个版本, 相对 npminstall 6.8.0 的全部变更如下.

### 命名

- 用户配置文件由 `~/.cnpmrc` 改为 `~/.nprc`, 两个包共用.
- 包名 `easy-npd`; 命令 `npd`, `npd-fetch`, `npd-link`, `npd-uninstall`, `npd-update`; User-Agent 为 `easy-npd/<version>`, 日志前缀与 debug 名空间为 `npd`.
- 默认缓存目录 `~/.np_tarball`, 缓存环境变量 `np_cache`, 与 easy-np 相同并共用缓存; 安装完成标记 `__npd_done`, 全局安装的 store 目录 `.<name>_npd`; 由 npminstall 装出的 `node_modules` 需删除后重装.

### 新功能

- `--offline`: 只读磁盘缓存, 不发任何网络请求; manifest 或 tgz 不在缓存时立即失败, git 包与 tarball url 依赖直接报错.
- 自动在 npmmirror 与 npmjs 之间切换: 每次运行先测速决定先后, manifest, tgz 与依赖安装脚本失败时交替换源, 最多 4 次; 镜像缺版本时向官方源重拉; 私有源与单独指定 registry 的 scope 不切换.
- `--refresh-cache`: 忽略并覆盖已有的 manifest 与 tgz 缓存.
- `npd-fetch` / `npd --fetch-only`: 只下载解压列出的包, 不安装依赖, 不执行脚本, 不链接 bin, 不修改 `package.json`.
- 根目录提升链接始终指向最高版本; 完整安装时依赖变化后重装会更新上次的提升链接; 根 `package.json` 声明的包不覆盖.
- 缓存目录改为 `np-manifests/<name>/<hash>.json`, `np-tgz/<name>/`, `np-tmp/<YYYYMMDD>/`; 旧布局的缓存不再读取, 不再自动清理过期临时目录.
- 全部命令的 `--help` 列出所有支持的参数.

### 修复

- 缓存中的 tgz 损坏时删除并重新下载, 不再每次重试都读到同一个坏文件.
- 流式请求收到 4xx / 5xx 时不再因断开响应流抛出未捕获的 abort 错误.
- 根目录已存在但完成标记为 false 的包(`npd-fetch` 解压或上次安装失败留下)不再因版本满足而跳过, 完整安装会重新处理并补齐依赖.
- `--lockfile-path` 加载失败时报错退出, 不再静默回退为联网解析.
- 在 `npm run` / `npx` 下安装需要 prepare 的 git 依赖时, 不再因继承 `npm_config_allow_scripts` 被 npm 12 以 `EALLOWSCRIPTS` 拒绝; git 依赖安装失败时报错附带子进程 stderr.
- `npd-uninstall` 等待 `package.json` 写回完成后再返回.
- `npd-uninstall` 后移除根 `node_modules` 中已无人使用的提升链接, 被卸载包的依赖不再仍可被 require.
- `.nprc` 中的 registry 用户名密码只发送给与 registry 同 host 的请求, `always-auth` 也不例外, 不再泄露给备用 registry, tarball CDN 与二进制镜像.

### 移除

- `-c`, `--china` 与 `npm_china`: 由 npmmirror 与 npmjs 的自动切换取代.
- `--custom-china-mirror-url`.
- `--prune`, `config.npminstall.prune` 与 `env:production` / `env:development`: 按固定名单跳过解压文件会误删 `tsconfig.json` 等运行时文件.
- `--proxy`, `npm_proxy`, `npm_config_proxy` 与 npm `strict-ssl`: urllib 3 不支持对应参数, 从未生效.
- `--force-link-latest`, `--disable-dedupe` 与 `config.npminstall.disableDedupe`.
- `--tarball-url-mapping` 不再声称改写重定向地址, 只改写首个请求地址.

### 运行环境

- Node.js >= 16.14.0; 依赖调整为 `node-gyp` 10, `tar` 7.
- 开发工具改为 oxlint 与 oxfmt; 测试由 egg-bin 改为直接使用 mocha 11 与 c8.
