'use strict';

const coffee = require('coffee');
const helper = require('../support/helper');

describe('test/sources/registry-only.test.js', () => {
  const cwd = helper.fixtures('registry-only');
  const cleanup = helper.cleanup(cwd);

  beforeEach(cleanup);
  afterEach(cleanup);

  it('should install fail', () => {
    return coffee
      .fork(helper.npminstall, ['--registry-only'], {
        cwd,
      })
      .debug()
      .expect('stderr', /Only registry packages are allowed/)
      .expect('code', 1)
      .end();
  });
});
