const path = require('node:path');
const coffee = require('coffee');
const assertFile = require('assert-file');
const helper = require('../support/helper');

describe('test/resolution/fallback-store.test.js', () => {
  const cwd = helper.fixtures('install-disable-fallback-store');
  const cleanup = helper.cleanup(cwd);

  beforeEach(cleanup);

  it('should always link fallback store', async () => {
    await coffee.fork(helper.npminstall, [], { cwd }).debug().expect('code', 0).end();
    assertFile(path.join(cwd, 'node_modules/urllib/package.json'));
    assertFile(path.join(cwd, 'node_modules/.store/node_modules'));
    assertFile(path.join(cwd, 'node_modules/.store/node_modules/undici'));
    assertFile.fail(path.join(cwd, 'node_modules/.store/node_modules/urllib'));
  });
});
