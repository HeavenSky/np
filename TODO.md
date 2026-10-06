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

## 功能待办

- easy-np: `--lockfile-path` 支持 workspace, 使各 workspace 按 lockfile 还原各自版本, 与 `npm ci` 一致.
- easy-np: 回收 `.store` 中卸载或重装后不再被任何链接引用的 `<name>@<version>` 目录.
- easy-npd: 回收卸载或重装后不再被任何链接引用的 `node_modules/_name@version@name` 目录.

## 已知不足

- `np-lock.json` 只锁定 registry 包, git, 本地路径与 tarball url 依赖每次重新获取; workspace 下的锁文件读写只有单仓用例覆盖.
