// mocha 全局 fixture: 全部用例结束后在主进程清理 helper.tmp() 生成的临时目录
'use strict';

const fs = require('fs/promises');
const path = require('path');

const fixtures = path.join(__dirname, 'fixtures');

exports.mochaGlobalTeardown = async () => {
  const names = await fs.readdir(fixtures);
  await Promise.all(
    names.filter(name => name.startsWith('.tmp_')).map(name => fs.rm(path.join(fixtures, name), { recursive: true, force: true }))
  );
};
