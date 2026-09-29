# easy-np

[cnpm/npminstall](https://github.com/cnpm/npminstall) 8.0.1 的 fork, 提供 `np`, `np-link`, `np-uninstall`, `np-update` 四个命令, 分别对应上游的 `npminstall`, `npmlink`, `npmuninstall`, `npmupdate`. 使用 `np` 或需要判断它与上游的行为差异时读本页; 未提到的用法同上游 [README](https://github.com/cnpm/npminstall/blob/master/README.md), 相对上游的全部变更见 [CHANGELOG.md](./CHANGELOG.md).

## 安装

需要 Node.js >= 16.14.0; 编译原生模块时需要 Python 3.

```bash
npm i -g easy-np
```

未发布的代码: 在本仓库 `packages/easy-np` 下 `npm pack`, 再 `npm i -g ./easy-np-<version>.tgz`.

全局命令 `np` 与 npm 包 [`np`](https://www.npmjs.com/package/np)(sindresorhus 的发布工具)同名: 全局已装其中一个时再装另一个会报 `EEXIST`, 加 `--force` 才覆盖; 作为项目依赖时互不影响.

全部参数见 `np --help`.

## 主要差异

- `--dedup` 把每个包的最高版本链接到根 `node_modules`, 即 npminstall@6 的扁平效果.
- 根目录默认不提升任何包; 用 `--public-hoist-pattern=<regexp>` 或 `package.json` 的 `config.np.publicHoistPattern` 指定, 命令行优先.
- 缓存目录 `~/.np_tarball`, 环境变量 `np_cache`, 与 easy-npd 共用; 安装完成标记 `__np_done`, 由上游装出的 `node_modules` 需删除后重装.
- registry token 只发给与 registry 同 host 的请求.
- 移除 `--prune`, `--proxy`, `--force-link-latest`, `--disable-fallback-store` 等参数; 完整清单见 CHANGELOG.

## 安装范围

| 命令              | 安装内容                                                                           |
| ----------------- | ---------------------------------------------------------------------------------- |
| `np`              | 根 `package.json` 的全部依赖; workspace 模式下另含全部 workspace                   |
| `np <pkg>`        | 只安装 `<pkg>` 并写入 `package.json`; 不刷新其余已声明依赖, 不执行根包生命周期脚本 |
| `np -w <name>`    | 只安装指定 workspace, 不含根包自身依赖                                             |
| `np --workspaces` | 安装全部 workspace, 不含根包自身依赖, 与 `npm install --workspaces` 一致           |

## workspace

- 按依赖关系拓扑排序后依次安装与执行生命周期脚本; 循环依赖保持 glob 顺序并告警.
- 依赖名命中 workspace 时总是链接本地 workspace, 版本不满足声明范围时只告警.
- 支持 `workspace:*`, `workspace:^`, `workspace:~` 与 `workspace:<range>`.
- `np-update -w <name>` 只清理该 workspace 的 `node_modules`.
- `--lockfile-path` 不支持 workspace, 会直接报错.

## node_modules 布局

- 包实体位于 `node_modules/.store/<name>@<version>/node_modules/<name>`; 每个包的最新版本另链接到 `node_modules/.store/node_modules`, 供 peerDependencies 回退解析.
- 根目录只放直接依赖与被提升的包; 被提升的包取本次安装涉及的全部依赖树中的最高版本, 根 `package.json` 声明的依赖保持声明版本.
- 完整安装会把上次的提升链接替换为本次结果, 可能降级; `np <pkg>`, `-w`, `--workspaces` 只升级不降级.
- `np-uninstall` 后移除不再被任何 `package.json` 声明, 也不被 `.store` 中其他包依赖的提升链接.

## 已知安全风险

为支持 Node 16 而保留的依赖, 以下公告未修复:

- urllib 3 依赖的 undici 5: 公告集中在 WebSocket, fetch, Cookie 与 retry 拦截器, np 不经过这些路径; 请求走私一类需要恶意 registry 或代理配合.
- pacote 15 内嵌的 tar 6: 只在安装 git 依赖时由 pacote 调用; np 自身解压 tarball 使用顶层 tar 7.
- pacote `addGitSha` DoS 与 sigstore 签名约束失效: 只涉及 git 依赖与签名校验, np 不启用签名校验.

## 待办规划

- [ ] `--lockfile-path` 支持 workspace, 使各 workspace 按 lockfile 还原各自版本, 与 `npm ci` 一致.
- [ ] 回收 `.store` 中卸载或重装后不再被任何链接引用的 `<name>@<version>` 目录.

## License

MIT, 见 [LICENSE.txt](./LICENSE.txt).
