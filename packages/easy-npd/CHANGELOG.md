# Changelog

## 0.0.0 (2026-09-28)

easy-npd 基于 npminstall 6.8.0, 首个版本. 与上游行为差异的对照表见 [README.md](./README.md#与上游-680-的差异).

### 命名

- 包名 `easy-npd`; 命令改为 `np6`, `np6-link`, `np6-uninstall`, `np6-update`; 日志前缀, 缓存根目录 `~/.npminstall_tarball`, 缓存环境变量 `npminstall_cache` 与配置键 `config.npminstall` 保持不变.

### 新功能

- 根目录提升链接始终指向最高版本; 完整安装时依赖变化后重装会更新上次的提升链接; 根 `package.json` 声明的包不覆盖.
- 缓存目录改为 `np-manifests/<name>/<hash>.json`, `np-tgz/<name>/`, `np-tmp/<YYYYMMDD>/`; 旧布局的缓存不再读取, 不再自动清理过期临时目录.
- 全部命令的 `--help` 列出所有支持的参数.

### 修复

- `--lockfile-path` 加载失败时报错退出, 不再静默回退为联网解析.
- 在 `npm run` / `npx` 下安装需要 prepare 的 git 依赖时, 不再因继承 `npm_config_allow_scripts` 被 npm 12 以 `EALLOWSCRIPTS` 拒绝; git 依赖安装失败时报错附带子进程 stderr.
- `np6-uninstall` 等待 `package.json` 写回完成后再返回.

### 移除

- `--prune`, `config.npminstall.prune` 与 `env:production` / `env:development`: 按固定名单跳过解压文件会误删 `tsconfig.json` 等运行时文件.
- `--proxy`, `npm_proxy`, `npm_config_proxy` 与 npm `strict-ssl`: urllib 3 不支持对应参数, 从未生效.
- `--force-link-latest`, `--disable-dedupe` 与 `config.npminstall.disableDedupe`.
- `--tarball-url-mapping` 不再声称改写重定向地址, 只改写首个请求地址.

### 运行环境

- Node.js >= 16.14.0; 依赖调整为 `node-gyp` 10, `tar` 7.
- 开发工具改为 oxlint 与 oxfmt; 测试由 egg-bin 改为直接使用 mocha 11 与 c8.

## [6.8.0](https://github.com/cnpm/npminstall/compare/v6.7.1...v6.8.0) (2023-12-18)


### Features

* add support for process.env.npminstall_cache ([#471](https://github.com/cnpm/npminstall/issues/471)) ([bd2cd34](https://github.com/cnpm/npminstall/commit/bd2cd348723b2fa91e406f9e8cad2fb14e186834))

## [6.7.0](https://github.com/cnpm/npminstall/compare/v6.6.2...v6.7.0) (2023-09-15)


### Features

* add npm package-lock.json support for 6.x ([#463](https://github.com/cnpm/npminstall/issues/463)) ([fecd257](https://github.com/cnpm/npminstall/commit/fecd257a5baa07c2984c9f72087cd3569f495716)), closes [#462](https://github.com/cnpm/npminstall/issues/462)
