'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs/promises');
const npminstall = require('./npminstall');
const utils = require('../lib/utils');
const helper = require('./helper');

describe('test/flow-bin.test.js', () => {
  const [tmp, cleanup] = helper.tmp();

  beforeEach(cleanup);
  afterEach(cleanup);

  it('should install flow-bin from china mirror', async () => {
    if (!process.env.local) return;
    const registry = process.env.local ? 'https://registry.npmmirror.com' : 'https://registry.npmjs.com';
    const binaryMirrors = await utils.getBinaryMirrors(registry);
    await npminstall({
      root: tmp,
      pkgs: [{ name: 'flow-bin' }],
      binaryMirrors,
    });
  });

  it('should install cypress from china mirror', async () => {
    if (process.platform === 'win32') return;
    const registry = process.env.local ? 'https://registry.npmmirror.com' : 'https://registry.npmjs.com';
    const binaryMirrors = await utils.getBinaryMirrors(registry);
    await npminstall({
      root: tmp,
      // download.js 的改写只匹配 9.x 的写法, 更新的版本由 CYPRESS_DOWNLOAD_PATH_TEMPLATE 环境变量走镜像
      pkgs: [{ name: 'cypress', version: '9.7.0' }],
      binaryMirrors,
      // 只验证镜像改写 download.js, 不下载上百 MB 的 cypress 二进制
      env: { CYPRESS_INSTALL_BINARY: '0' },
    });
    const content = await fs.readFile(path.join(tmp, 'node_modules/cypress/lib/tasks/download.js'), 'utf8');
    assert(content.includes(binaryMirrors.cypress.host), 'download.js should use the binary mirror');
  });
});
