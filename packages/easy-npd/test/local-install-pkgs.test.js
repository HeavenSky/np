'use strict';

const assert = require('assert');
const fs = require('fs/promises');
const path = require('path');
const coffee = require('coffee');
const helper = require('./helper');

describe('test/local-install-pkgs.test.js', () => {
  const cwd = helper.fixtures('local-install-pkgs');
  const cleanupModules = helper.cleanup(cwd);
  const restorePkg = helper.restoreFile(path.join(cwd, 'package.json'));
  async function cleanup() {
    await cleanupModules();
    await restorePkg();
  }

  beforeEach(cleanup);
  afterEach(cleanup);

  it('should install pkg and dont link latestVersions', async () => {
    await coffee.fork(helper.npminstall, [ 'koa' ], { cwd })
      .debug()
      .expect('code', 0)
      .notExpect('stdout', /Linked \d+ latest versions/)
      .end();
    let names = await fs.readdir(path.join(cwd, 'node_modules'));
    names = names.filter(n => !/^[\.\_]/.test(n));
    assert(names.length > 10);
    assert(names.includes('koa'));
    assert(names.includes('accepts'));
  });
});
