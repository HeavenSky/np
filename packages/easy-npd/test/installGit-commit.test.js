// 按完整与缩写的 commit hash 安装 git 依赖
'use strict';

const assert = require('assert');
const path = require('path');
const npminstall = require('./npminstall');
const helper = require('./helper');

describe('test/installGit-commit.test.js', () => {
  const [tmp, cleanup] = helper.tmp();
  beforeEach(cleanup);
  afterEach(cleanup);

  it('should install from github with commit hash https://github.com/mozilla/nunjucks.git#0f8b21b8df7e8e852b2e1889388653b7075f0d09', async () => {
    await npminstall({
      root: tmp,
      pkgs: [
        { name: null, version: 'git+https://github.com/mozilla/nunjucks.git#0f8b21b8df7e8e852b2e1889388653b7075f0d09' },
      ],
    });

    const pkg = await helper.readJSON(path.join(tmp, 'node_modules/nunjucks/package.json'));
    assert.equal(pkg.name, 'nunjucks');
    assert.equal(pkg.version, '1.2.0');
  });

  it('should also ok on https://github.com/mozilla/nunjucks.git#0f8b21b8d', async () => {
    await npminstall({
      root: tmp,
      pkgs: [{ name: null, version: 'git+https://github.com/mozilla/nunjucks.git#0f8b21b8d' }],
    });

    const pkg = await helper.readJSON(path.join(tmp, 'node_modules/nunjucks/package.json'));
    assert.equal(pkg.name, 'nunjucks');
    assert.equal(pkg.version, '1.2.0');
  });
});
