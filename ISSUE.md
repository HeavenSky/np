# ISSUE

执行中遇到, 尚未定位或修复的问题. 更新于 2026-10-06 20:17 +0800.

## easy-np `test/index.test.js` "should npminstall with options.pkgs" 偶发失败

- 现象: PR #1 的 CI(run 37461164346, 提交 863939f)中 `test-legacy-node (easy-np, 14.18.0)` 全量 400 passing / 1 failing, 失败点 `test/index.test.js:52` `isInstallDone(node_modules/mocha)` 为 false; 日志里 mocha 10.8.2 正常安装, 无报错.
- 复现: 同一提交在本机 node:14.18.0 容器单独跑该文件 3 次均通过, 此前容器全量也通过; 判断为偶发.
- 待验证的猜测: CI 上 8 个 worker 共用测试 HOME 的 tarball 缓存, 不同测试文件并发写同一个 tgz 缓存文件, 读到写了一半的文件导致安装未完成; 或阶段 1 新增的解压前 `installState.reset` 与同一 store 目录的并发安装交错, 留下 `done: false`.
- 下一步: 后续 CI 若再出现, 拉取失败 job 的完整日志对照该包的 store 目录与状态文件写入顺序.
