'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs/promises');
const utils = require('../lib/utils');
const npminstall = require('./npminstall');
const helper = require('./helper');

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

    let done = await utils.isInstallDone(
      path.join(tmp, 'node_modules/_install-error@1.0.1@install-error/package.json')
    );
    assert.equal(done, false);
    // 子依赖失败不中止安装, install-error 照常链接, 但保留阶段标记, 下次运行经由它找到失败的子依赖
    const dirs = await fs.readdir(path.join(tmp, 'node_modules'));
    assert.deepEqual(dirs.sort(), ['_install-error@1.0.1@install-error', 'install-error']);
    const pkg = await utils.readJSON(path.join(tmp, 'node_modules/_install-error@1.0.1@install-error/package.json'));
    assert(pkg.__npd_stage);

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
    done = await utils.isInstallDone(
      path.join(tmp, 'node_modules/_install-error@1.0.1@install-error/.npminstall.done')
    );
    assert.equal(done, false);
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

    let done = await utils.isInstallDone(
      path.join(tmp, 'node_modules/_postinstall-error@1.0.0@postinstall-error/.npminstall.done')
    );
    assert.equal(done, false);

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
    done = await utils.isInstallDone(
      path.join(tmp, 'node_modules/_postinstall-error@1.0.0@postinstall-error/.npminstall.done')
    );
    assert.equal(done, false);
  });
});
