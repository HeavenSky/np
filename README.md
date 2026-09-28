# npminstall 6.8.0 (np 补丁版)

[cnpm/npminstall](https://github.com/cnpm/npminstall) 6.8.0 的补丁版, 包名仍为 `npminstall`, 命令改名为 `np6` 系列. 使用 `np6` 命令, 或需要判断它与上游 6.8.0 的行为差异时读本页; 版本变更见 [CHANGELOG.md](./CHANGELOG.md).

## 运行要求

- Node.js >= 16.14.0
- 编译原生模块时需要 Python 3, 由 node-gyp 10 调用

## 安装

```bash
npm i -g github:HeavenSky/np#np-6.8.0
```

包名与 npm 上的 `npminstall` 相同, 全局安装会替换已全局安装的 `npminstall`, 此后 `npminstall` 系列命令不再可用.

## 命令

| 命令            | 上游对应       |
| --------------- | -------------- |
| `np6`           | `npminstall`   |
| `np6-link`      | `npmlink`      |
| `np6-uninstall` | `npmuninstall` |
| `np6-update`    | `npmupdate`    |

全部参数见 `np6 --help`, 其余三个命令同样支持 `--help`.

## 与上游 6.8.0 的差异

| 项 | 上游 6.8.0 | 本补丁版 |
| --- | --- | --- |
| 命令名 | `npminstall`, `npmlink`, `npmuninstall`, `npmupdate` | `np6`, `np6-link`, `np6-uninstall`, `np6-update` |
| 缓存目录布局 | `~/.npminstall_tarball` 下的 `manifests/<h>/<h>/<h>/`, 按包名拆分的多级 tarball 目录, `.tmp/YYYY/MM/DD`; 自动清理过期临时目录 | 同一根目录下的 `np-manifests/<name>/<hash>.json`, `np-tgz/<name>/`, `np-tmp/<YYYYMMDD>/`; 不再自动清理过期临时目录, 旧布局的缓存不再读取 |
| 根目录提升链接 | 已存在即跳过, 依赖变化后重装不会更新; `--force-link-latest` 才用更高版本覆盖 | 始终链接最高版本: 更高版本覆盖已有链接; 完整安装(不带包名)时上次的提升链接替换为本次依赖树中的最高版本, 可能降级; 根 `package.json` 声明的包不覆盖 |
| `--force-link-latest` | 见上 | 移除 |
| `--disable-dedupe`, `config.npminstall.disableDedupe` | 关闭根目录扁平链接 | 移除 |
| `--prune`, `config.npminstall.prune`, `env:production` / `env:development` | 解压时按固定名单跳过文件 | 移除; 名单含 `tsconfig.json`, `LICENSE`, `images/` 等, 会静默破坏 `@tsconfig/*` 这类包 |
| `--proxy`, `npm_proxy`, `npm_config_proxy` | 声明支持, 但 urllib 3 不认 `proxy` 参数, 实际直连 | 移除 |
| npm `strict-ssl` | 读取后作为 `rejectUnauthorized` 传入, urllib 3 不认, 不生效 | 不再读取, HTTPS 证书始终校验 |
| `--tarball-url-mapping` | 声称也改写重定向地址, 但 urllib 3 不支持 `formatRedirectUrl` | 只改写首个请求地址 |
| `--lockfile-path` 加载失败 | 告警后联网解析, 退出码 0 | 报错退出 |
| 在 `npm run` / `npx` 下安装需要 prepare 的 git 依赖 | 继承 `npm_config_allow_scripts`, 被 npm 12 以 `EALLOWSCRIPTS` 拒绝 | 正常安装; 失败时错误信息附带子进程 stderr |
| `np6-uninstall` | 可能在 `package.json` 写回前返回 | 写回完成后返回 |
| 依赖 | node-gyp 9, tar 6 | node-gyp 10, tar 7 |
| 开发工具 | eslint, egg-bin | oxlint, oxfmt, mocha 11, c8 |

## Use as Lib

### Install

```bash
$ npm install github:HeavenSky/np#np-6.8.0 --save
```

### Usage

```js
const npminstall = require('npminstall');

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

cli | real | user | sys
--- | ---  | ---  | ---
npminstall | 0m10.908s | 0m8.733s | 0m4.282s
npminstall with cache | 0m8.815s | 0m7.492s | 0m3.644s
npminstall --no-cache | 0m10.279s | 0m8.255s | 0m3.932s
pnpm | 0m13.509s | 0m11.650s | 0m4.443s
npm | 0m28.171s | 0m26.085s | 0m8.219s
npm with cache | 0m20.939s | 0m19.415s | 0m6.302s

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

## License

[MIT](LICENSE.txt)
<!-- GITCONTRIBUTOR_START -->

## Contributors

|[<img src="https://avatars.githubusercontent.com/u/156269?v=4" width="100px;"/><br/><sub><b>fengmk2</b></sub>](https://github.com/fengmk2)<br/>|[<img src="https://avatars.githubusercontent.com/u/985607?v=4" width="100px;"/><br/><sub><b>dead-horse</b></sub>](https://github.com/dead-horse)<br/>|[<img src="https://avatars.githubusercontent.com/u/4635838?v=4" width="100px;"/><br/><sub><b>gemwuu</b></sub>](https://github.com/gemwuu)<br/>|[<img src="https://avatars.githubusercontent.com/u/6897780?v=4" width="100px;"/><br/><sub><b>killagu</b></sub>](https://github.com/killagu)<br/>|[<img src="https://avatars.githubusercontent.com/u/543405?v=4" width="100px;"/><br/><sub><b>ibigbug</b></sub>](https://github.com/ibigbug)<br/>|[<img src="https://avatars.githubusercontent.com/u/6828924?v=4" width="100px;"/><br/><sub><b>vagusX</b></sub>](https://github.com/vagusX)<br/>|
| :---: | :---: | :---: | :---: | :---: | :---: |
|[<img src="https://avatars.githubusercontent.com/u/507615?v=4" width="100px;"/><br/><sub><b>afc163</b></sub>](https://github.com/afc163)<br/>|[<img src="https://avatars.githubusercontent.com/u/465125?v=4" width="100px;"/><br/><sub><b>yesmeck</b></sub>](https://github.com/yesmeck)<br/>|[<img src="https://avatars.githubusercontent.com/u/360661?v=4" width="100px;"/><br/><sub><b>popomore</b></sub>](https://github.com/popomore)<br/>|[<img src="https://avatars.githubusercontent.com/u/319494?v=4" width="100px;"/><br/><sub><b>we11adam</b></sub>](https://github.com/we11adam)<br/>|[<img src="https://avatars.githubusercontent.com/u/7463687?v=4" width="100px;"/><br/><sub><b>whatwewant</b></sub>](https://github.com/whatwewant)<br/>|[<img src="https://avatars.githubusercontent.com/u/18736572?v=4" width="100px;"/><br/><sub><b>emma-owen</b></sub>](https://github.com/emma-owen)<br/>|
|[<img src="https://avatars.githubusercontent.com/u/7336582?v=4" width="100px;"/><br/><sub><b>weihong1028</b></sub>](https://github.com/weihong1028)<br/>|[<img src="https://avatars.githubusercontent.com/u/49113249?v=4" width="100px;"/><br/><sub><b>HomyeeKing</b></sub>](https://github.com/HomyeeKing)<br/>|[<img src="https://avatars.githubusercontent.com/u/2972143?v=4" width="100px;"/><br/><sub><b>nightink</b></sub>](https://github.com/nightink)<br/>|[<img src="https://avatars.githubusercontent.com/u/2842176?v=4" width="100px;"/><br/><sub><b>XadillaX</b></sub>](https://github.com/XadillaX)<br/>|[<img src="https://avatars.githubusercontent.com/u/1195765?v=4" width="100px;"/><br/><sub><b>LeoYuan</b></sub>](https://github.com/LeoYuan)<br/>|[<img src="https://avatars.githubusercontent.com/u/13602053?v=4" width="100px;"/><br/><sub><b>cnlon</b></sub>](https://github.com/cnlon)<br/>|
|[<img src="https://avatars.githubusercontent.com/u/6613538?v=4" width="100px;"/><br/><sub><b>Moudicat</b></sub>](https://github.com/Moudicat)<br/>|[<img src="https://avatars.githubusercontent.com/u/6753092?v=4" width="100px;"/><br/><sub><b>hanzhao</b></sub>](https://github.com/hanzhao)<br/>|[<img src="https://avatars.githubusercontent.com/u/431376?v=4" width="100px;"/><br/><sub><b>marcbachmann</b></sub>](https://github.com/marcbachmann)<br/>|[<img src="https://avatars.githubusercontent.com/u/19733683?v=4" width="100px;"/><br/><sub><b>snyk-bot</b></sub>](https://github.com/snyk-bot)<br/>|[<img src="https://avatars.githubusercontent.com/u/11251401?v=4" width="100px;"/><br/><sub><b>Solais</b></sub>](https://github.com/Solais)<br/>|[<img src="https://avatars.githubusercontent.com/u/958063?v=4" width="100px;"/><br/><sub><b>thonatos</b></sub>](https://github.com/thonatos)<br/>|
|[<img src="https://avatars.githubusercontent.com/u/227713?v=4" width="100px;"/><br/><sub><b>atian25</b></sub>](https://github.com/atian25)<br/>|[<img src="https://avatars.githubusercontent.com/u/3364271?v=4" width="100px;"/><br/><sub><b>tommytroylin</b></sub>](https://github.com/tommytroylin)<br/>|[<img src="https://avatars.githubusercontent.com/u/3922719?v=4" width="100px;"/><br/><sub><b>wssgcg1213</b></sub>](https://github.com/wssgcg1213)<br/>|[<img src="https://avatars.githubusercontent.com/u/4136679?v=4" width="100px;"/><br/><sub><b>yibn2008</b></sub>](https://github.com/yibn2008)<br/>|[<img src="https://avatars.githubusercontent.com/u/29791463?v=4" width="100px;"/><br/><sub><b>fossabot</b></sub>](https://github.com/fossabot)<br/>|[<img src="https://avatars.githubusercontent.com/u/1908773?v=4" width="100px;"/><br/><sub><b>hugohua</b></sub>](https://github.com/hugohua)<br/>|
[<img src="https://avatars.githubusercontent.com/u/19908330?v=4" width="100px;"/><br/><sub><b>hyj1991</b></sub>](https://github.com/hyj1991)<br/>|[<img src="https://avatars.githubusercontent.com/u/13431452?v=4" width="100px;"/><br/><sub><b>givingwu</b></sub>](https://github.com/givingwu)<br/>|[<img src="https://avatars.githubusercontent.com/u/1196941?v=4" width="100px;"/><br/><sub><b>Abreto</b></sub>](https://github.com/Abreto)<br/>

This project follows the git-contributor [spec](https://github.com/xudafeng/git-contributor), auto updated at `Wed Nov 09 2022 14:41:07 GMT+0800`.

<!-- GITCONTRIBUTOR_END -->
