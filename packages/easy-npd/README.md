# easy-npd

[cnpm/npminstall](https://github.com/cnpm/npminstall) 6.8.0 的 fork, 提供 `npd`, `npd-link`, `npd-uninstall`, `npd-update` 四个命令, 分别对应上游的 `npminstall`, `npmlink`, `npmuninstall`, `npmupdate`. 使用 `npd` 或需要判断它与上游的行为差异时读本页; 未提到的用法(含作为库调用, `--flatten`, resolutions)同上游 [6.x README](https://github.com/cnpm/npminstall/blob/6.x/README.md), 相对上游的全部变更见 [CHANGELOG.md](./CHANGELOG.md).

## 安装

需要 Node.js >= 16.14.0; 编译原生模块时需要 Python 3.

```bash
npm i -g easy-npd
```

未发布的代码: 在本仓库 `packages/easy-npd` 下 `npm pack`, 再 `npm i -g ./easy-npd-<version>.tgz`.

全局命令 `npd` 与 npm 包 [`npd`](https://www.npmjs.com/package/npd)(Node Packages Deployer)同名: 全局已装其中一个时再装另一个会报 `EEXIST`, 加 `--force` 才覆盖; 作为项目依赖时互不影响.

全部参数见 `npd --help`, 其余三个命令同样支持 `--help`.

## 主要差异

- 根目录提升链接始终指向依赖树中的最高版本, 根 `package.json` 声明的包不覆盖; 完整安装会把上次的提升链接替换为本次结果, 可能降级.
- `npd-uninstall` 后移除不再被根 `package.json` 声明, 也不被其他 `_name@version@name` 引用的提升链接.
- 缓存目录 `~/.np_tarball`, 环境变量 `np_cache`, 与 easy-np 共用; 安装完成标记 `__npd_done`, 由上游装出的 `node_modules` 需删除后重装.
- `.cnpmrc` 的 registry 用户名密码只发给与 registry 同 host 的请求, `always-auth` 也不例外.
- 移除 `--prune`, `--proxy`, `--force-link-latest`, `--disable-dedupe` 等参数; 完整清单见 CHANGELOG.

## 安装范围

| 命令        | 安装内容                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------ |
| `npd`       | 根 `package.json` 的全部依赖, 并执行根包的生命周期脚本                                                 |
| `npd <pkg>` | 只安装 `<pkg>` 并写入 `package.json`(`--no-save` 不写入); 不刷新其余已声明依赖, 不执行根包生命周期脚本 |

## node_modules 布局

包实体位于 `node_modules/_<name>@<version>@<name>`, 依赖链接在各自的 `node_modules` 下; 每个包的最高版本另链接到根 `node_modules/<name>`.

## 已知安全风险

为支持 Node 16 而保留的依赖, 以下公告未修复:

- urllib 3 依赖的 undici 5: 公告集中在 WebSocket, fetch, Cookie 与 retry 拦截器, npd 不经过这些路径; 请求走私一类需要恶意 registry 或代理配合.
- pacote 15 内嵌的 tar 6: 只在安装 git 依赖时由 pacote 调用; npd 自身解压 tarball 使用顶层 tar 7.
- pacote `addGitSha` DoS 与 sigstore 签名约束失效: 只涉及 git 依赖与签名校验, npd 不启用签名校验.

## 待办规划

- [ ] 回收卸载或重装后不再被任何链接引用的 `node_modules/_name@version@name` 目录.

## License

MIT, 见 [LICENSE.txt](./LICENSE.txt).
