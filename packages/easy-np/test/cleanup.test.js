const assert = require('node:assert');
const path = require('node:path');
const npminstall = require('./npminstall');
const helper = require('./helper');
const { getInstallState } = require('../lib/utils');

describe('test/cleanup.test.js', () => {
  const [tmp, cleanup] = helper.tmp();

  beforeEach(cleanup);
  afterEach(cleanup);

  it('should remove donefile when install failed', async () => {
    let throwError = false;
    try {
      await npminstall({
        root: tmp,
        pkgs: [{ name: 'install-error', version: 'latest' }],
      });
    } catch {
      throwError = true;
    }
    assert(throwError);

    // 子依赖失败不中止安装, install-error 照常链接, 但保留阶段标记, 下次运行经由它找到失败的子依赖
    const state = await getInstallState(path.join(tmp, 'node_modules/install-error'));
    assert.equal(state.stage, 'finish');

    // install again will try to download
    throwError = false;
    try {
      await npminstall({
        root: tmp,
        pkgs: [{ name: 'install-error', version: 'latest' }],
      });
    } catch {
      throwError = true;
    }
    assert.equal(throwError, true);
  });

  it('should remove donefile when execute postinstall script failed', async () => {
    let throwError = false;
    const pkgs = [{ version: '../postinstall-error', type: 'local' }];
    try {
      await npminstall({
        root: tmp,
        pkgs,
      });
    } catch {
      throwError = true;
    }
    assert.equal(throwError, true);

    // install again will try to download
    throwError = false;
    try {
      await npminstall({
        root: tmp,
        pkgs,
      });
    } catch {
      throwError = true;
    }
    assert.equal(throwError, true);
  });
});
