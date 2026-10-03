const assert = require('node:assert');
const path = require('node:path');
const npminstall = require('./npminstall');
const helper = require('./helper');
const utils = require('../lib/utils');

describe('test/installScope.test.js', () => {
  const [tmp, cleanup] = helper.tmp();

  beforeEach(cleanup);
  afterEach(cleanup);

  it('should install scope package with version', async () => {
    await npminstall({
      root: tmp,
      pkgs: [{ name: '@rstacruz/tap-spec', version: '4.1.1' }],
    });
    const pkg = await helper.readJSON(path.join(tmp, 'node_modules/@rstacruz/tap-spec/package.json'));
    assert(pkg.version === '4.1.1');
  });

  it('should install scope package with version not exist throw err', async () => {
    try {
      await npminstall({
        root: tmp,
        pkgs: [{ name: '@rstacruz/tap-spec', version: '3.0.0' }],
      });
      throw new Error('should not excute here');
    } catch (err) {
      // 失败的包不中止安装, 结束时汇总抛出; 原始错误在 err.failures 中
      assert.equal(err.code, utils.INSTALL_FAILURES_CODE, err.message);
      assert.equal(err.failures.length, 1);
      assert.equal(
        err.failures[0].error.message,
        "[@rstacruz/tap-spec@3.0.0] Can't find package @rstacruz/tap-spec's version: 3.0.0"
      );
    }
  });

  it('should install scope package with range', async () => {
    await npminstall({
      root: tmp,
      pkgs: [{ name: '@rstacruz/tap-spec', version: '~4.1.0' }],
    });
    const pkg = await helper.readJSON(path.join(tmp, 'node_modules/@rstacruz/tap-spec/package.json'));
    assert(pkg.version === '4.1.1');
  });
});
