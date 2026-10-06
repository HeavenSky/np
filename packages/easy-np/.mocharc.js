// mocha 配置: 替代 egg-bin test 的默认行为
'use strict';

const os = require('os');

module.exports = {
  timeout: 2000000,
  // 每个测试文件只能写自己的 fixture 目录或 helper.tmp() 生成的唯一目录, 共用目录会在并行时互相清理
  parallel: true,
  // 用例大多在等网络而不是占 CPU, worker 数取核数两倍(8 ~ 16); 改回默认的核数减一会让 4 核 CI 只剩 3 个 worker, 全量耗时成倍增加
  jobs: Math.min(16, Math.max(8, os.cpus().length * 2)),
  exit: true,
  require: ['test/.mocha-global.js'],
};
