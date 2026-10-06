# TODO

本仓库两个包的未决事项. 更新于 2026-10-06 20:40 +0800. 除注明外两个包都有.

## 安装与 store

- 依赖声明从 git / `file:` 改回 registry 版本时, 已装版本满足声明范围就保留旧链接, 不会换成 registry 包.
- 升级到带来源后缀的 store 目录后, 执行 `x prune` 之前, 旧版本留下的无后缀 git / url / 本地目录仍可能被同名同版本的 registry 依赖复用.
- 本地目录依赖内容变了但版本号与路径不变时, 复用已完成的 store 目录, 不会重新复制; easy-npd README 仍写"每次按目录当前内容安装".
- 全局安装时跳过列表末尾提示的 `x approve-scripts ... && x rebuild ...` 不支持 `-g`, 照做会失败.

## 子进程与网络

- `cli/install.js` 的 `getVersionSavePrefix` 调用 `npm config get save-prefix` 没有超时.
- 受信本地目录的 `npm pack` 沿用 `exec` 默认 1 MB 输出上限, prepack 输出超限时失败并回退到复制(产物里没有构建结果); 超时只结束 shell, 不结束整个进程树.
- 命令行 `--strict-ssl` 不会清掉环境里已有的 `GIT_SSL_NO_VERIFY=true`, git 仍不校验证书.
- 日志脱敏的查询参数匹配区分大小写, `Token=` 之类不会被遮住.

## 平台

- node-gyp 安装失败提示里设置 `npm_config_node_gyp` 的示例只有 POSIX shell 写法.
