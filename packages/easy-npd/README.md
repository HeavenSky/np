# easy-npd

[cnpm/npminstall](https://github.com/cnpm/npminstall) 6.8.0 的 fork, npm 包名 `easy-npd`, 提供 `npd` 系列命令. 使用 `npd` 命令, 或需要判断它与上游 6.8.0 的行为差异时读本页; 版本变更见 [CHANGELOG.md](./CHANGELOG.md).

## 运行要求

- Node.js >= 16.14.0
- 编译原生模块时需要 Python 3, 由 node-gyp 10 调用

## 安装

```bash
npm i -g easy-npd
```

作为依赖引用:

```json
{ "dependencies": { "easy-npd": "^0.0.0" } }
```

安装未发布的最新代码: 在本仓库的 `packages/easy-npd` 下执行 `npm pack`, 再 `npm i -g ./easy-npd-<version>.tgz`; npm 不支持从 git 仓库子目录安装.

全局命令 `npd` 与 npm 包 [`npd`](https://www.npmjs.com/package/npd)("Node Packages Deployer", 提供 `npd` 与 `npdg`)的命令同名: 已全局安装其中一个时, 再全局安装另一个会报 `EEXIST: file already exists` 并拒绝安装, 加 `--force` 才会覆盖; 作为项目依赖安装时各自位于 `node_modules/.bin`, 互不影响.

## 命令

| 命令            | 上游对应       |
| --------------- | -------------- |
| `npd`           | `npminstall`   |
| `npd-link`      | `npmlink`      |
| `npd-uninstall` | `npmuninstall` |
| `npd-update`    | `npmupdate`    |

全部参数见 `npd --help`, 其余三个命令同样支持 `--help`.

## 与上游 6.8.0 的差异

| 项                                                                         | 上游 6.8.0                                                                                                                    | 本补丁版                                                                                                                                           |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 包名与命令名                                                               | 包名 `npminstall`; 命令 `npminstall`, `npmlink`, `npmuninstall`, `npmupdate`                                                  | 包名 `easy-npd`; 命令 `npd`, `npd-link`, `npd-uninstall`, `npd-update`                                                                             |
| 缓存目录布局                                                               | `~/.npminstall_tarball` 下的 `manifests/<h>/<h>/<h>/`, 按包名拆分的多级 tarball 目录, `.tmp/YYYY/MM/DD`; 自动清理过期临时目录 | `~/.npd_tarball` 下的 `np-manifests/<name>/<hash>.json`, `np-tgz/<name>/`, `np-tmp/<YYYYMMDD>/`; 不再自动清理过期临时目录, 旧布局的缓存不再读取    |
| 缓存目录环境变量                                                           | `npminstall_cache`                                                                                                            | `npd_cache`; `npm_config_cache` 两边都认                                                                                                           |
| User-Agent, 日志前缀, debug 名空间                                         | `npminstall`                                                                                                                  | User-Agent 为 `easy-npd/<version>`, 日志前缀与 debug 名空间为 `npd`                                                                                |
| 安装完成标记                                                               | 包内 `package.json` 的 `__npminstall_done`                                                                                    | `__npd_done`; 由上游装出的 `node_modules` 会被视为未完成, 切换时先删除 `node_modules`                                                              |
| 根目录提升链接                                                             | 已存在即跳过, 依赖变化后重装不会更新; `--force-link-latest` 才用更高版本覆盖                                                  | 始终链接最高版本: 更高版本覆盖已有链接; 完整安装(不带包名)时上次的提升链接替换为本次依赖树中的最高版本, 可能降级; 根 `package.json` 声明的包不覆盖 |
| `--force-link-latest`                                                      | 见上                                                                                                                          | 移除                                                                                                                                               |
| `--disable-dedupe`, `config.npminstall.disableDedupe`                      | 关闭根目录扁平链接                                                                                                            | 移除                                                                                                                                               |
| `--prune`, `config.npminstall.prune`, `env:production` / `env:development` | 解压时按固定名单跳过文件                                                                                                      | 移除; 名单含 `tsconfig.json`, `LICENSE`, `images/` 等, 会静默破坏 `@tsconfig/*` 这类包                                                             |
| `--proxy`, `npm_proxy`, `npm_config_proxy`                                 | 声明支持, 但 urllib 3 不认 `proxy` 参数, 实际直连                                                                             | 移除                                                                                                                                               |
| npm `strict-ssl`                                                           | 读取后作为 `rejectUnauthorized` 传入, urllib 3 不认, 不生效                                                                   | 不再读取, HTTPS 证书始终校验                                                                                                                       |
| `--tarball-url-mapping`                                                    | 声称也改写重定向地址, 但 urllib 3 不支持 `formatRedirectUrl`                                                                  | 只改写首个请求地址                                                                                                                                 |
| `--lockfile-path` 加载失败                                                 | 告警后联网解析, 退出码 0                                                                                                      | 报错退出                                                                                                                                           |
| 在 `npm run` / `npx` 下安装需要 prepare 的 git 依赖                        | 继承 `npm_config_allow_scripts`, 被 npm 12 以 `EALLOWSCRIPTS` 拒绝                                                            | 正常安装; 失败时错误信息附带子进程 stderr                                                                                                          |
| `npd-uninstall`                                                            | 可能在 `package.json` 写回前返回                                                                                              | 写回完成后返回                                                                                                                                     |
| `npd-uninstall` 后被卸载包的依赖                                           | 根目录提升链接保留, 仍可被 require                                                                                            | 移除不再被根 `package.json` 声明, 也不被其他 `_name@version@name` 引用的提升链接                                                                   |
| `.cnpmrc` 的 registry 用户名密码                                           | 按子串匹配 registry 地址附加, `always-auth` 时附加到所有请求                                                                  | 只附加到与 registry 同 host 的请求, `always-auth` 也不例外                                                                                         |
| 依赖                                                                       | node-gyp 9, tar 6                                                                                                             | node-gyp 10, tar 7                                                                                                                                 |
| 开发工具                                                                   | eslint, egg-bin                                                                                                               | oxlint, oxfmt, mocha 11, c8                                                                                                                        |

## 安装范围

| 命令        | 安装内容                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------ |
| `npd`       | 根 `package.json` 的全部依赖, 并执行根包的生命周期脚本                                                 |
| `npd <pkg>` | 只安装 `<pkg>` 并写入 `package.json`(`--no-save` 不写入); 不刷新其余已声明依赖, 不执行根包生命周期脚本 |

## Use as Lib

### Install

```bash
$ npm install easy-npd --save
```

### Usage

```js
const npminstall = require('easy-npd');

(async () => {
  await npminstall({
    // install root dir
    root: process.cwd(),
    // optional packages need to install, default is package.json's dependencies and devDependencies
    // pkgs: [
    //   { name: 'foo', version: '~1.0.0' },
    // ],
    // install to specific directory, default to root
    // targetDir: '/home/admin/.global/lib',
    // link bin to specific directory (for global install)
    // binDir: '/home/admin/.global/bin',
    // registry, default is https://registry.npmjs.org
    // registry: 'https://registry.npmjs.org',
    // debug: false,
    // storeDir: root + 'node_modules',
    // ignoreScripts: true, // ignore pre/post install scripts, default is `false`
    // forbiddenLicenses: forbit install packages which used these licenses
  });
})().catch(err => {
  console.error(err);
});
```

## Support Features

- [x] all types of npm package
  - [x] a) a folder containing a program described by a package.json file (`npm install file:eslint-rule`)
  - [x] b) a gzipped tarball containing (a) (`npm install ./rule.tgz`)
  - [x] c) a url that resolves to (b) (`npm install https://github.com/indexzero/forever/tarball/v0.5.6`)
  - [x] d) a <name>@<version> that is published on the registry with (c)
  - [x] e) a <name>@<tag> (see npm-dist-tag) that points to (d)
  - [x] f) a <name> that has a "latest" tag satisfying (e)
  - [x] g) a <git remote url> that resolves to (a) (`npm install git://github.com/timaschew/cogent#fix-redirects`)
- [x] All platform support
- [x] global install (`-g, --global`)
- [x] `preinstall`, `install`, `postinstall` scripts
- [x] node-gyp@10, only support Python@3
  - [x] node-pre-gyp
- [x] bin (yo@1.6.0, fsevents@1.0.6)
- [x] scoped package
- [x] bundleDependencies / bundledDependencies (node-pre-gyp@0.6.19, fsevents@1.0.6)
- [x] optionalDependencies (pm2@1.0.0)
- [x] peerDependencies (co-defer@1.0.0, co-mocha@1.1.2, estraverse-fb@1.3.1)
- [x] deprecate message
- [x] `--production` mode
- [x] `save`, `save-dev`, `save-optional`
- [x] support `ignore-scripts`
- [x] uninstall
- [x] resolutions
- [x] [npm alias](https://github.com/npm/rfcs/blob/latest/implemented/0001-package-aliases.md)

## Different with NPM

This project is inspired by [pnpm](https://github.com/pnpm/pnpm), and has a similar store structure like pnpm. You can read [pnpm vs npm](https://github.com/pnpm/pnpm/blob/master/docs/pnpm-vs-npm.md) to see the different with npm.

### Limitations

- You can't install from [shrinkwrap](https://docs.npmjs.com/cli/shrinkwrap)(and don't want to support for now).
- Peer dependencies are a little trickier to deal with(see rule 1 below).
- You can't publish npm modules with bundleDependencies managed by npminstall(because of rule 2 below).
- `npminstall` will collect all postinstall scripts, and execute them until all dependencies installed.
- If last install failed, better to cleanup node_modules directory before retry.

## `node_modules` directory

Two rules:

1. The latest version of modules will link at `options.storeDir`'s `node_modules`, except packages declared in the root `package.json`.
2. Module's dependencies will link at module's `node_modules`.

e.g.:

- app: `{ "dependencies": { "debug": "2.2.0" } }` (root)
- debug@2.2.0: `{ "dependencies": { "ms": "0.7.1" } }`

```bash
app/
├── package.json
└── node_modules
    ├── _debug@2.2.0@debug
    │   ├── node_modules
    │   │   └── ms -> ../../_ms@0.7.1@ms
    ├── _ms0.7.1@ms
    ├── debug -> _debug@2.2.0@debug
    └── ms -> _ms@0.7.1@ms # for peerDependencies
```

### flattened vs nested

npminstall will always try to install the maximal matched version of semver:

```
root/
  koa@1.1.0
  mod/
    koa@~1.1.0
# will install two different version of koa when use npminstall.
```

you can enable flatten mode by `--flatten` flag, in this mod, npminstall will try to use ancestors' dependencies to minimize the dependence-tree.

```
root/
  koa@1.1.0
  mod/
    koa@~1.1.0

root/
  koa@1.1.0
  mod/
    koa@^1.1.0
# both the same version: 1.1.0

root/
  koa@~1.1.0
  mod/
    koa@^1.1.0
# both the same version: 1.1.2

root/
  mod/
    koa@^1.1.0
  moe/
    koa@~1.1.0
# two different versions
```

**npminstall will always treat `n.x` and `n.m.x` as flattened**

```
root/
  koa@1.1.0
  mod/
    koa@1.1.x
both the same version: 1.1.0

root/
  koa@~1.1.0
  mod/
    koa@1.x
both the same version: 1.1.2
```

## Resolutions

support [selective version resolutions](https://yarnpkg.com/en/docs/selective-version-resolutions) like yarn. which lets you define custom package versions inside your dependencies through the resolutions field in your `package.json` file.

resolutions also supports [npm alias)(https://docs.npmjs.com/cli/v7/commands/npm-install). It's a workaround feature to fix some archived/inactive/ package by uploading your own bug-fixed version to npm registry.

see use case at [unittest package.json](./test/fixtures/resolutions-alias/package.json).

## Benchmarks

https://github.com/cnpm/npminstall-benchmark

### cnpmjs.org install

- npminstall@1.2.0
- pnpm@0.18.0
- npm@2.14.12

| cli                   | real      | user      | sys      |
| --------------------- | --------- | --------- | -------- |
| npminstall            | 0m10.908s | 0m8.733s  | 0m4.282s |
| npminstall with cache | 0m8.815s  | 0m7.492s  | 0m3.644s |
| npminstall --no-cache | 0m10.279s | 0m8.255s  | 0m3.932s |
| pnpm                  | 0m13.509s | 0m11.650s | 0m4.443s |
| npm                   | 0m28.171s | 0m26.085s | 0m8.219s |
| npm with cache        | 0m20.939s | 0m19.415s | 0m6.302s |

### pnpm benchmark

see https://github.com/pnpm/pnpm#benchmark

```bash
npminstall babel-preset-es2015 browserify chalk debug minimist mkdirp
    real	0m8.929s       user	0m5.606s       sys	0m2.913s
```

```bash
pnpm i babel-preset-es2015 browserify chalk debug minimist mkdirp
    real	0m12.998s      user	0m8.653s       sys	0m3.362s
```

```bash
npm i babel-preset-es2015 browserify chalk debug minimist mkdirp
    real	1m4.729s       user	0m55.589s      sys	0m23.135s
```

## 已知安全风险

为支持 Node 16 而保留的依赖, 以下公告未修复:

- urllib 3 依赖的 undici 5: 公告集中在 WebSocket, fetch, Cookie 与 retry 拦截器, npd 不经过这些路径; 请求走私一类需要恶意 registry 或代理配合.
- pacote 15 内嵌的 tar 6: 只在安装 git 依赖时由 pacote 调用; npd 自身解压 tarball 使用顶层 tar 7.
- pacote `addGitSha` DoS 与 sigstore 签名约束失效: 只涉及 git 依赖与签名校验, npd 不启用签名校验.

## 待办规划

- [ ] 回收无用的包实体: 卸载与重装后不再被任何链接引用的 `node_modules/_name@version@name` 目录目前不会删除, 需要一个基于引用扫描的清理命令或安装后自动回收.

## License

MIT, 版权归属见 [LICENSE.txt](./LICENSE.txt).
