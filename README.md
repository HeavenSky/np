# np

本仓库维护两个互相独立的 npm 包, 均 fork 自 [cnpm/npminstall](https://github.com/cnpm/npminstall), 各自安装依赖, 测试与发布, 不共享代码. 选用哪个包, 或要在本仓库开发时读本页; 用法见各包 README.

| 包                                          | 上游 npminstall | 命令                                                          | 适用场景                                                  |
| ------------------------------------------- | --------------- | ------------------------------------------------------------- | --------------------------------------------------------- |
| [`easy-np`](./packages/easy-np/README.md)   | 8.0.1           | `np`, `np-fetch`, `np-link`, `np-uninstall`, `np-update`      | `.store` 布局, 支持 npm workspaces                        |
| [`easy-npd`](./packages/easy-npd/README.md) | 6.8.0           | `npd`, `npd-fetch`, `npd-link`, `npd-uninstall`, `npd-update` | `_name@version@name` 扁平布局, 根目录链接每个包的最高版本 |

两个包的命令名互不冲突, 可以同时全局安装: `npm i -g easy-np easy-npd`; npm 不支持从 git 仓库子目录安装.

## 共用缓存与配置

两个包读取同一份用户配置 `~/.nprc`(registry, scope registry 与认证).

两个包共用磁盘缓存 `~/.np_tarball`, 由 `np_cache` 或 `npm_config_cache` 改写; 目录下的 `np-manifests/<name>/<md5(manifest url)>.json`(公共源统一按官方源的 manifest 地址) 与 `np-tgz/<name>/<version>-<shasum>.tgz` 两边写法相同, 可互相复用. 修改任一个包的缓存路径, 文件名或 manifest 缓存的 JSON 结构时 MUST 同步修改另一个包, 否则两者会静默读到对方写入的不兼容缓存.

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
