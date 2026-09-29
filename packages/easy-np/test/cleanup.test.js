const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs/promises');
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

    const dirs = await fs.readdir(path.join(tmp, 'node_modules'));
    assert.deepEqual(dirs, ['.store']);

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
