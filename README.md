# np

本仓库维护两个互相独立的 npm 包安装工具, 各自安装依赖, 测试与发布, 不共享代码. 选用哪个包, 或要在本仓库开发时读本页; 命令与参数见各包 README.

| 包                                          | 命令                     | 适用场景                                                  |
| ------------------------------------------- | ------------------------ | --------------------------------------------------------- |
| [`easy-np`](./packages/easy-np/README.md)   | `np`, `np-x <command>`   | `.store` 布局, 支持 npm workspaces                        |
| [`easy-npd`](./packages/easy-npd/README.md) | `npd`, `npd-x <command>` | `_name@version@name` 扁平布局, 根目录链接每个包的最高版本 |

`np-x install` / `npd-x install` 贴近 npm 与 pnpm: 默认读写 `np-lock.json`, 依赖脚本按 `allowScripts` 放行, 兼容读取 `.npmrc`, `pnpm-workspace.yaml` 与 `package.json` 的 `pnpm` 字段. `np` / `npd` 与之完全相同, 只是固定补上 `--no-lockfile --dangerously-allow-all-scripts`, 这两个参数只能在命令行覆盖. 两个包的命令名互不冲突, 可以同时全局安装: `npm i -g easy-np easy-npd`; npm 不支持从 git 仓库子目录安装.

两个包的代码分别起源于 [cnpm/npminstall](https://github.com/cnpm/npminstall) 8.0.1(easy-np)与 6.8.0(easy-npd); 与 npminstall 的差异与移除项见各包 README.

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

- 两个包的脚本名一致: `test`, `test-cov`, `lint`(带 `--fix`), `lint:check`, `fmt`(带 `--write`), `fmt:check`.
- 测试按功能放在 `test/<目录>/` 下一层, 支持文件在 `test/support/`; package.json 与 CI 的 mocha spec 写作 `test/*/*.test.js`, 不能写成 `test/**`: fixtures 中依赖包自带的 `*.test.js` 会被当作用例; spec 也不能放进 `.mocharc.js`, 否则命令行指定单个文件时会与它合并成全量.
- 一个修复要同时用到两个包时, 分别修改并分别提交, 不抽公共代码.
- 版本号, `CHANGELOG.md` 与发布各自独立.

## 发布

推送 `<包名>@<版本>` 形式的 tag 后, `.github/workflows/release.yml` 校验 tag 与 `package.json` 的 `version` 一致, 等待同一提交在 main 上的 CI 通过(不重复跑 lint 与单测, CI 未通过或该提交没推到 main 时不发布), 发布到 npm 并以 CHANGELOG 中该版本的段落创建 GitHub Release; 带 `-` 的预发布版本发布到 dist-tag `next`.

```bash
# 先改好 version 与 CHANGELOG 并提交
git tag easy-np@0.0.5
git push origin main easy-np@0.0.5
```

npm 登录走 Trusted Publishing, 不需要 `NPM_TOKEN`: 每个包需在 npmjs.com 的 Settings → Trusted Publisher 中登记一次 GitHub Actions, 仓库 `HeavenSky/np`, 工作流 `release.yml`.

## 历史

合仓前的历史: `packages/easy-np` 用 `git log 6339a73^ -- <包内路径>`, `packages/easy-npd` 用 `git log 775ef57^2 -- <包内路径>`.
