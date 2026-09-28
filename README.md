# np

[cnpm/npminstall](https://github.com/cnpm/npminstall) 8.0.1 的 fork. 使用 `np` 命令, 或需要判断它与上游行为差异时读本页.

## 运行要求

- Node.js >= 16.14.0
- 编译原生模块时需要 Python 3, 由 node-gyp 10 调用

## 安装

```bash
npm i -g github:HeavenSky/np#np
```

作为依赖引用:

```json
{ "dependencies": { "np": "github:HeavenSky/np#np" } }
```

## 命令

| 命令 | 上游对应 |
| --- | --- |
| `np` | `npminstall` |
| `np-link` | `npmlink` |
| `np-uninstall` | `npmuninstall` |
| `np-update` | `npmupdate` |

全部参数见 `np --help`.

## 与上游的差异

| 项 | 上游 8.0.1 | 本 fork |
| --- | --- | --- |
| `--dedup` | 无 | 把每个包的最新版本链接到 `<root>/node_modules`, 即 npminstall@6 的扁平效果; 优先级高于 `--public-hoist-pattern` |
| 根目录提升 | 固定提升名称匹配 `/(eslint\|prettier\|babel)/i` 的包 | 默认不提升; 用 `--public-hoist-pattern=<regexp>` 或 `package.json` 的 `config.np.publicHoistPattern` 指定, 命令行优先 |
| `--disable-fallback-store` | 可关闭 `.store/node_modules` 回退链接 | 移除, 回退链接始终建立 |
| `--force-link-latest` | 显式开启才用更高版本覆盖根目录已有链接 | 移除, 提升时始终链接最高版本 |
| `--proxy`, `npm_proxy`, `npm_config_proxy` | 声明支持, 但 urllib 3/4 不认 `proxy` 参数, 实际直连 | 移除 |
| npm `strict-ssl` | 读取后作为 `rejectUnauthorized` 传给 `HttpClient.request`, urllib 3/4 均不认, 不生效 | 不再读取, HTTPS 证书始终校验 |
| `--tarball-url-mapping` | 声明也改写重定向地址, 但 urllib 3/4 不支持 `formatRedirectUrl` | 只改写首个请求地址 |
| `np-uninstall --ignore-scripts` | 声明但无作用 | 移除 |
| 缓存目录 | `~/.npminstall_tarball` 下的 `manifests/` 与按包名拆分的多级 tarball 目录 | `~/.np_tarball` 下的 `np-manifests/`, `np-tgz/<name>/`, `np-tmp/<YYYYMMDD>/`; 不再自动清理过期临时目录 |
| 缓存目录环境变量 | `npminstall_cache` | `np_cache`; `npm_config_cache` 两边都认 |
| `package.json` 配置 | `config.npminstall` 的 `prune`, `env:production.prune`, `env:development.prune`, 只在不带包名安装时读取 | `config.np` 的 `publicHoistPattern`, `np` 与 `np <pkg>` 都读取; 移除 `prune` 与 `env:*` |
| `--prune` | 解压时按固定名单跳过文件 | 移除; 名单含 `tsconfig.json`, `LICENSE`, `images/` 等, 会静默破坏 `@tsconfig/*` 这类包 |
| 安装完成标记 | 包内 `package.json` 的 `__npminstall_done` | `__np_done`; 由上游装出的 `node_modules` 会被视为未完成, 切换时先删除 `node_modules` |
| registry token | 附加到所有请求 | 只附加到与 registry 同 host 的请求 |

## 安装范围

| 命令 | 安装内容 |
| --- | --- |
| `np` | 根 `package.json` 的全部依赖; workspace 模式下另含全部 workspace |
| `np <pkg>` | 只安装 `<pkg>` 并写入 `package.json`; 不刷新其余已声明依赖, 不执行根包生命周期脚本 |
| `np -w <name>` | 只安装指定 workspace, 不含根包自身依赖 |
| `np --workspaces` | 安装全部 workspace, 不含根包自身依赖, 与 `npm install --workspaces` 一致 |

## workspace

- workspace 按依赖关系拓扑排序后依次安装与执行生命周期脚本, 存在循环依赖的 workspace 保持 glob 顺序并告警.
- 依赖名命中 workspace 时总是链接本地 workspace; 本地版本不满足声明范围时告警, 不改装 registry 同名包.
- 支持 `workspace:*`, `workspace:^`, `workspace:~` 与 `workspace:<range>`; 找不到同名 workspace 时报错.
- peerDependencies 校验在全部 workspace 与根包安装完成后统一执行.
- `np-update -w <name>` 只清理该 workspace 的 `node_modules`, 保留根目录与共享的 `.store`.
- `np-uninstall` 之后, 不再被任何 `package.json` 声明且不被 `.store` 中其他包依赖的提升链接会被移除.
- `--lockfile-path` 不支持 workspace, 会直接报错.

## node_modules 布局

- 包实体位于 `node_modules/.store/<name>@<version>/node_modules/<name>`, 依赖以同级符号链接放在同一 `node_modules` 下.
- 每个包的最新版本链接到 `node_modules/.store/node_modules`, 供 peerDependencies 回退解析.
- 根目录只放直接依赖与被提升的包.
- 被提升的包取本次安装涉及的全部依赖树(workspace 模式下含所有被安装的 workspace 包)中的最高版本, 与安装顺序无关; 完整安装(不带包名, 不带 `-w` / `--workspaces`)时指向 `.store` 的旧链接会被替换为本次结果, 可能降级; 部分安装只会升级已有链接, 不会降级.
- 根目录 `package.json` 声明且本次模式会安装的依赖(production 下不含 devDependencies)保持声明版本, `np <pkg>` 只装部分包时同样生效; workspace 包自身的链接不被覆盖; 其余不指向 `.store` 的目录或链接在版本低于待提升版本时被覆盖.
- `.store/node_modules` 下的回退链接同样在已有版本更低时更新.
- 本次安装未涉及的包名保留上次的链接.

## resolutions

支持 yarn 的 [selective version resolutions](https://classic.yarnpkg.com/en/docs/selective-version-resolutions) 语法, 也支持 npm alias 作为目标版本; 写法见 `test/fixtures/resolutions/package.json` 与 `test/fixtures/resolutions-alias/package.json`.

## 已知安全风险

为支持 Node 16 而保留的依赖, 以下公告未修复:

- urllib 3 依赖的 undici 5: 公告集中在 WebSocket, fetch, Cookie 与 retry 拦截器, np 不经过这些路径; 请求走私一类需要恶意 registry 或代理配合.
- pacote 15 内嵌的 tar 6: 只在安装 git 依赖时由 pacote 调用; np 自身解压 tarball 使用顶层 tar 7.
- pacote `addGitSha` DoS 与 sigstore 签名约束失效: 只涉及 git 依赖与签名校验, np 不启用签名校验.

## License

MIT, 版权归属见 [LICENSE.txt](./LICENSE.txt).
