// mocha 配置: 替代 egg-bin test 的默认行为
'use strict';

module.exports = {
  timeout: 2000000,
  // 每个测试文件只能写自己的 fixture 目录或 helper.tmp() 生成的唯一目录, 共用目录会在并行时互相清理
  parallel: true,
  exit: true,
  require: ['test/.mocha-global.js'],
};
