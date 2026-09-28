// mocha 配置: 替代 egg-bin test 的默认行为
'use strict';

module.exports = {
  timeout: 2000000,
  // 用例共用 fixture 目录, 并行会互相清理对方的 node_modules
  parallel: false,
  exit: true,
};
