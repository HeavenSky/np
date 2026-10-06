# TODO

本仓库两个包的未决事项. 更新于 2026-10-04 22:02 +0800.

## 待单独开任务

### 依赖生命周期脚本的默认策略(下次讨论)

现状: 两个包默认执行全部依赖的 preinstall / install / postinstall, 没有白名单; 只有 `--ignore-scripts` 一刀切.

主流工具(2026-10 调研):

| 工具 | 默认 | 放行配置 | 未放行时 |
| --- | --- | --- | --- |
| npm 12 | 不执行依赖脚本, 根项目照常执行 | 根 `package.json` 的 `allowScripts`(包名或精确版本, 值 true / false); `npm approve-scripts` | 跳过并列出; `strict-allow-scripts=true` 时报错 |
| pnpm 11 / 12 | 不执行 | `pnpm-workspace.yaml` 的 `allowBuilds`; `pnpm approve-builds` | 默认报错 `ERR_PNPM_IGNORED_BUILDS`(`strictDepBuilds`) |
| yarn 4.14+ | 不执行 | `.yarnrc.yml` 的 `enableScripts`, `dependenciesMeta.<pkg>.built` | 告警 YN0004 |
| bun | 只执行内置信任列表 | `package.json` 的 `trustedDependencies`(覆盖默认列表) | 告警并提示 `bun pm untrusted` |

推荐: 沿用 npm 12 的根 `package.json` `allowScripts` 字段, 同一份配置对 npm 12 与 np / npd 都生效. 分两步落地: 先默认照常执行, 结束时列出不在 `allowScripts` 中却执行了脚本的包; 再改为默认跳过, 提供 `np-x approve-scripts` 与严格模式. 有 `binding.gyp` 的隐式 node-gyp 构建与 git 依赖的 prepare 同样纳入. 被跳过的原生模块要到运行时才报错, 结束时的列表要给出重跑命令.

### 代理支持(待调研修复方案)

`--proxy` 与 `npm_config_proxy` 因 urllib 3 不支持已移除, 企业内网没有可用的代理配置. 候选: undici 的 `ProxyAgent` / `EnvHttpProxyAgent` 读取 `HTTPS_PROXY` / `NO_PROXY`; 需核实 urllib 3 能否透传 dispatcher, 以及二进制下载与 git 依赖是否走同一代理.

### 低版本 Node.js: 降级兜底并告警(方向已定, 待实施)

原则: 不提高 `engines` 下限; 低版本 Node 上按能力降级或改用兜底实现, 接受一定风险与简化功能, 但每次运行用一条告警说明降级了什么, 以及升级到哪个 Node 版本可以恢复.

设计草案:

- 运行时能力表(新增 `lib/runtime.js`): 启动时按 `process.versions.node` 算出各能力用哪种实现, 其余代码只查这张表, 不各自判断版本.
- HTTP 客户端: 同时声明 `urllib` 4(需 Node >= 18.19)与别名依赖 `urllib3: npm:urllib@^3`, 按能力表懒加载. 低版本用 urllib 3, 并对带认证的请求关闭自动重定向, 自行跟随, 跨域时去掉 `Authorization`, 补上 urllib 3 的凭据泄露问题.
- node-gyp 等只支持新 Node 的依赖: 同样用别名依赖并存新旧版本, 低版本用旧版, 安装脚本里调用的 node-gyp 路径按能力表注入.
- 告警: 每次运行只打印一条 `np WARN Node vX: <降级项列表>, upgrade to Node >= <版本> to restore`; 降级项来自能力表, 避免散落在各处的告警文案; 提供环境变量关闭(名称待定).
- README 增加一张"Node 版本 × 能力"表, 写明各版本下的降级项与已知风险, 替代现在的「已知安全风险」段落.
- 测试: CI 增加 Node 16 / 18 矩阵, 断言降级路径可用且告警内容正确.

## 功能待办

- easy-np: `--lockfile-path` 支持 workspace, 使各 workspace 按 lockfile 还原各自版本, 与 `npm ci` 一致.
- easy-np: 回收 `.store` 中卸载或重装后不再被任何链接引用的 `<name>@<version>` 目录.
- easy-npd: 回收卸载或重装后不再被任何链接引用的 `node_modules/_name@version@name` 目录.

## 已知不足

- `np-lock.json` 只锁定 registry 包, git, 本地路径与 tarball url 依赖每次重新获取; workspace 下的锁文件读写只有单仓用例覆盖.
