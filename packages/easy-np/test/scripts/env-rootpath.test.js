const coffee = require('coffee');
const helper = require('../support/helper');

describe('test/scripts/env-rootpath.test.js', () => {
  const cwd = helper.fixtures('rootpath');
  const cleanup = helper.cleanup(cwd);

  beforeEach(cleanup);
  afterEach(cleanup);

  it('should run preinstall and postinstall', () => {
    return coffee
      .fork(helper.npminstall, ['--detail'], { cwd })
      .debug()
      .expect('code', 0)
      .expect('stdout', /process.env.INIT_CWD exists/)
      .expect('stdout', /process.env.npm_rootpath exists/)
      .end();
  });
});
