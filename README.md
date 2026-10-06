# np

本仓库维护两个互相独立的 npm 包, 均 fork 自 [cnpm/npminstall](https://github.com/cnpm/npminstall), 各自安装依赖, 测试与发布, 不共享代码. 选用哪个包, 或要在本仓库开发时读本页; 用法见各包 README.

| 包                                          | 上游 npminstall | 命令                     | 适用场景                                                  |
| ------------------------------------------- | --------------- | ------------------------ | --------------------------------------------------------- |
| [`easy-np`](./packages/easy-np/README.md)   | 8.0.1           | `np`, `np-x <command>`   | `.store` 布局, 支持 npm workspaces                        |
| [`easy-npd`](./packages/easy-npd/README.md) | 6.8.0           | `npd`, `npd-x <command>` | `_name@version@name` 扁平布局, 根目录链接每个包的最高版本 |

各包 README 分「新增功能」与「与上游的差异」两部分说明相对 npminstall 的变化. 两个包的命令名互不冲突, 可以同时全局安装: `npm i -g easy-np easy-npd`; npm 不支持从 git 仓库子目录安装.

## 共用缓存与配置

- 用户配置: 两个包读取同一份 `~/.nprc`(registry, scope registry 与认证).
- 磁盘缓存: 两个包共用 `~/.np_tarball`, 可用 `np_cache` 或 `npm_config_cache` 改写. 用其中一个装过的包, 另一个安装时直接命中缓存.
- 缓存文件: manifest 存为 `np-manifests/<name>/<md5(manifest url)>.json`, 公共源统一按官方源的 manifest 地址计算; tgz 存为 `np-tgz/<name>/<version>-<shasum>.tgz`.
- 测速缓存: 公共源测速结果存为 `~/.np_tarball/np-probe.json`, 两个包共用.
- node-gyp: 两个包都不自带 node-gyp, 首次编译原生模块时按当前 Node.js 版本安装到 `~/.np_tarball/np-node-gyp`(easy-np)与 `~/.np_tarball/npd-node-gyp`(easy-npd), 两者各自独立, 不互相读取.
- 锁文件: 两个包读写项目根目录同一份 `np-lock.json`, 格式见各包 `lib/np_lock.js`.
- 同步修改: 改任一个包的缓存路径, 文件名, manifest 缓存, 测速缓存或 `np-lock.json` 的 JSON 结构时, MUST 同步修改另一个包; 否则两者会静默读到对方写入的不兼容文件.

## 开发

两个包不启用 npm workspaces: 依赖版本互相冲突, 且测试会检查 `node_modules` 布局, 依赖提升会掩盖漏声明的依赖.

```bash
npm run install:all   # 分别在两个包目录下 npm i
npm run lint
npm run test:np
npm run test:npd
```

- 两个包的脚本名一致: `test`, `test-cov`, `lint`, `fmt`, `fmt:check`.
- 一个修复要同时用到两个包时, 分别修改并分别提交, 不抽公共代码.
- 版本号, `CHANGELOG.md` 与发布各自独立.

## 历史

合仓前的历史: `packages/easy-np` 用 `git log 6339a73^ -- <包内路径>`, `packages/easy-npd` 用 `git log 775ef57^2 -- <包内路径>`.
