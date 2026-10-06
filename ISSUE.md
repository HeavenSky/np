# ISSUE

执行中遇到, 尚未定位或修复的问题. 更新于 2026-10-06 21:06 +0800.

## easy-np `test/index.test.js` "should npminstall with options.pkgs" 在 CI 上偶发失败

- 现象: PR #1 连续两次 CI 失败于同一断言 `isInstallDone(node_modules/mocha)` 为 false: run 37461164346(863939f)在 Node 14.18.0, run 37465442677(c44906e)在 Node 16.x; 其余 Node 版本与 Windows 同次通过. 该用例在测试进程内调用 `npminstall()`, 安装日志不进 CI 输出.
- 已排除:
  - 状态写入未 await: `setInstallDone` / `setInstallStage` 等调用点全部 await.
  - 同一次安装内同一 store 目录被并发 reset: `download/npm.js` 按 `download:name@version` 去重.
  - 网络失败: 两次日志里 mocha 无下载失败或重试.
  - 同一 worker 内 `get.test.js` 重新加载 `np_config` 污染配置: `--jobs 1` 顺序跑 get 再跑 index 通过.
- 复现尝试: 本机 Node 14.18 容器单文件 3 次通过; node:16-bullseye `--cpus=2`(16 个 worker)全量 3 轮 1248 个用例次全部通过.
- 当前处理: 该用例失败时报出 `node_modules/mocha` 的 realpath, 状态记录与 package.json 是否存在; 下次 CI 失败后按这三项定位.
