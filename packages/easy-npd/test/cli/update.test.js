'use strict';

const assert = require('assert');
const path = require('path');
const coffee = require('coffee');
const helper = require('../support/helper');
const { exists } = require('../../lib/utils');

describe('test/cli/update.test.js', () => {
  const npmupdate = path.join(__dirname, '../../bin/x.js');
  const cwd = helper.fixtures('update');
  const cleanup = helper.cleanup(cwd);

  beforeEach(async () => {
    await cleanup();
    await coffee
      .fork(helper.npminstall, [], {
        cwd,
        stdio: 'pipe',
      })
      .debug()
      .end();
  });
  afterEach(cleanup);

  it('should update ok', async () => {
    await coffee
      .fork(npmupdate, ['update'], {
        cwd,
        stdio: 'pipe',
      })
      .debug()
      .end();
    assert(await exists(path.join(cwd, 'node_modules/pedding')));
    assert(await exists(path.join(cwd, 'node_modules/pkg')));
  });

  it('should update pedding ok', async () => {
    await coffee
      .fork(npmupdate, ['update', 'pedding'], {
        cwd,
        stdio: 'pipe',
      })
      .debug()
      .end();
    assert(await exists(path.join(cwd, 'node_modules/pedding')));
    assert(await exists(path.join(cwd, 'node_modules/pkg')));
  });
});
