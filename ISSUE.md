# ISSUE

执行中遇到, 尚未定位或修复的问题. 更新于 2026-10-06 21:28 +0800.

## easy-np `test/unit/utils.test.js` trackChildProcess SIGTERM 用例偶发失败

- 现象: 本机 Node 26 一次全量(16 个 worker)中失败: driver 进程直接被 SIGTERM 结束(`{ exitCode: null, exitSignal: 'SIGTERM' }`), 而不是由 `trackChildProcess` 注册的处理函数清理后以 143 退出.
- 复现: 之后单独运行与两次全量均通过; PR #1 的三次 CI 均未出现.
- 待查: driver 在 spawn 之后同步调用 `trackChildProcess(child.pid)`, 孙进程写 pid 文件更晚, 理论上信号到达时处理函数已注册; 需排查 `child.pid` 为空(spawn 失败时 track 不注册)或注册时机.
