// 从 GitHub 简写, ssh, https 与分支安装 git 依赖, 以及不存在的 ref
'use strict';

const assert = require('assert');
const path = require('path');
const npminstall = require('../support/npminstall');
const helper = require('../support/helper');

describe('test/sources/git.test.js', () => {
  const [tmp, cleanup] = helper.tmp();
  beforeEach(cleanup);
  afterEach(cleanup);

  it('should install github repo `node-modules/pedding` ok', async () => {
    await npminstall({
      root: tmp,
      pkgs: [{ name: null, version: 'node-modules/pedding' }],
    });
    const pkg = await helper.readJSON(path.join(tmp, 'node_modules/pedding/package.json'));
    assert.equal(pkg.name, 'pedding');
    assert(pkg.version !== '0.0.3');
  });

  it('should install github repo `node-modules/pedding#0.0.3` ok', async () => {
    await npminstall({
      root: tmp,
      pkgs: [{ name: null, version: 'node-modules/pedding#0.0.3' }],
    });
    const pkg = await helper.readJSON(path.join(tmp, 'node_modules/pedding/package.json'));
    assert.equal(pkg.name, 'pedding');
    assert.equal(pkg.version, '0.0.3');
  });

  it('should install from git with ssh `git+ssh://git@github.com:node-modules/pedding.git#0.0.2` ok', async () => {
    await npminstall({
      root: tmp,
      pkgs: [{ name: null, version: 'git+ssh://git@github.com:node-modules/pedding.git#0.0.2' }],
    });
    const pkg = await helper.readJSON(path.join(tmp, 'node_modules/pedding/package.json'));
    assert.equal(pkg.name, 'pedding');
    assert.equal(pkg.version, '0.0.2');
  });

  it('should install from git with http `git+https://github.com/node-modules/pedding.git` ok', async () => {
    await npminstall({
      root: tmp,
      pkgs: [{ name: null, version: 'git+https://github.com/node-modules/pedding.git' }],
    });
    const pkg = await helper.readJSON(path.join(tmp, 'node_modules/pedding/package.json'));
    assert.equal(pkg.name, 'pedding');
    assert(pkg.version !== '0.0.3');
  });

  it('should also ok on https://github.com/node-modules/agentkeepalive#2.x', async () => {
    await npminstall({
      root: tmp,
      pkgs: [{ name: null, version: 'git+https://github.com/node-modules/agentkeepalive#2.x' }],
    });

    const pkg = await helper.readJSON(path.join(tmp, 'node_modules/agentkeepalive/package.json'));
    assert.equal(pkg.name, 'agentkeepalive');
  });

  it('should fail on some strange hash', async () => {
    try {
      await npminstall({
        root: tmp,
        pkgs: [{ name: null, version: 'git+https://github.com/mozilla/nunjucks.git#wtf???!!!fail-here,hahaa' }],
      });
    } catch (err) {
      assert(
        /\[@git\+https:\/\/github.com\/mozilla\/nunjucks.git#wtf\?\?\?!!!fail-here,hahaa\] The git reference could not be found/.test(
          err.message
        )
      );
    }
  });
});
