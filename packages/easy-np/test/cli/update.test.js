const path = require('node:path');
const coffee = require('coffee');
const assertFile = require('assert-file');
const helper = require('../support/helper');

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
    assertFile(path.join(cwd, 'node_modules/pedding'));
    assertFile(path.join(cwd, 'node_modules/pkg'));
  });

  it('should update --clean-only', async () => {
    await coffee
      .fork(npmupdate, ['update', '--clean-only'], {
        cwd,
        stdio: 'pipe',
      })
      .debug()
      .end();
    assertFile.fail(path.join(cwd, 'node_modules/pedding'));
    assertFile.fail(path.join(cwd, 'node_modules/pkg'));
  });

  it('should update pedding ok', async () => {
    await coffee
      .fork(npmupdate, ['update', 'pedding'], {
        cwd,
        stdio: 'pipe',
      })
      .debug()
      .end();
    assertFile(path.join(cwd, 'node_modules/pedding'));
    assertFile(path.join(cwd, 'node_modules/pkg'));
  });
});
