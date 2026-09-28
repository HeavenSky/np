# np

本仓库同时维护两个互相独立的 npm 包, 各自安装依赖, 各自测试与发布, 不共享代码. 选用哪个包, 或要在本仓库开发时读本页; 包的用法与和上游的差异见各包自己的 README.

| 包 | 目录 | 上游 | 命令 | 适用场景 |
| --- | --- | --- | --- | --- |
| [`easy-np`](./packages/easy-np/README.md) | `packages/easy-np` | npminstall 8.0.1 | `np`, `np-link`, `np-uninstall`, `np-update` | `.store` 布局, 支持 npm workspaces |
| [`easy-npd`](./packages/easy-npd/README.md) | `packages/easy-npd` | npminstall 6.8.0 | `npd`, `npd-link`, `npd-uninstall`, `npd-update` | `_name@version@name` 扁平布局, 根目录链接每个包的最高版本, 无 workspace |

两个包的命令名互不冲突, 可以同时全局安装.

## 安装

```bash
npm i -g easy-np
npm i -g easy-npd
```

npm 不支持从 git 仓库的子目录安装, `npm i -g github:HeavenSky/np` 这类写法装不到本仓库的包.

## 开发

两个包没有启用 npm workspaces: 它们的依赖版本互相冲突, 且测试本身会检查 `node_modules` 布局, 依赖提升会掩盖漏声明的依赖并干扰测试.

```bash
npm run install:all   # 分别在两个包目录下 npm i
npm run lint
npm run test:np       # 等价于 cd packages/easy-np && npm test
npm run test:npd
```

- 两个包的 `package.json` 脚本名一致: `test`, `test-cov`, `lint`, `fmt`, `fmt:check`.
- 一个包的修复需要同样应用到另一个包时, 在两个目录里分别修改并分别提交, 不抽公共代码.
- 每个包的版本号, `CHANGELOG.md` 与发布相互独立.

## 历史

`packages/easy-np` 的历史延续自 `np` 分支, `packages/easy-npd` 的历史以合并提交的第二个父提交保留自 `npd` 分支. 查看迁入前的历史: `git log np -- <路径>` 或 `git log npd -- <路径>`, 路径为包内相对路径.
