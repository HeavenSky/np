# TODO

本仓库两个包的未决事项. 更新于 2026-10-06 19:45 +0800. 除注明外两个包都有.

## allowScripts

- `np -g <pkg>` / `npd -g <pkg>`: 被装的包自己是根, 它声明的 `file:` 依赖仍按受信本地依赖执行脚本, 全局根包的身份也取自包内 package.json.
- git 依赖只因 prepare / build 被跳过时, 结束提示给出的 `x approve-scripts <name>` 报 "no installed version": `listInstalledWithScripts` 只认 preinstall / install / postinstall.
- git / url / 本地包按自称的 name@version 进 store, 可以占住同名 registry 包的目录, 污染之后的 registry 安装.

## np-lock.json

- 同一 git / url 依赖的新内容版本号不变时, store 已完成就保留旧内容, 锁文件却记新的 commit / integrity.
- 命令行不带版本的 alias(`np x@npm:foo`): `keyOf` 算出 `foo@latest`, 安装时实际用的键是 `foo`, 不复用旧锁对它不生效.
- 在 workspace 根目录, easy-np 按完整安装写锁(含全部成员), easy-npd 不支持 workspaces, 完整安装会删掉成员的条目, 之后 `np --frozen-lockfile` 失败.
- `_resolved` 会把带 token 的 git URL 写进 np-lock.json.

## node-gyp 按需安装

- 并发首次安装, 换 spec 或安装失败后, `np-node-gyp/` / `npd-node-gyp/` 下不再被指针引用的 `<version>-<uuid>` 目录不会自动清理.
- 失败提示里设置 `npm_config_node_gyp` 的示例只有 POSIX shell 写法; Windows 未实测.

## 命令行与配置

- 字符串参数重复传入会变成数组(`--root`, `--proxy`, `--cafile`, `--lockfile-path` 等), `path.resolve` 收到数组直接抛错; 目前只有 registry 取 `[0]`.
- `--cafile` 相对路径原样导出给子进程, git clone 与 git 构建的子安装工作目录不同, 读不到证书.
- 命令行 `--strict-ssl` 只影响本进程的请求; 环境里已有 `npm_config_strict_ssl=false` 时, 子进程(node-gyp 等)仍继承 false.
- 日志脱敏不覆盖 URL 查询串里的 token(`?token=`).
- Node 14 自带的 npm 6 不支持 `npm pack --pack-destination`, 本地目录依赖先报 `npm ERR! ENOLOCAL` 再退回复制, 安装仍成功.
