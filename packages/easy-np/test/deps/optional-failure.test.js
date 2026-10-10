const coffee = require('coffee');
const helper = require('../support/helper');

describe('test/deps/optional-failure.test.js', () => {
  const cwd = helper.fixtures('sub-module-optional-dep-install-fails');
  const cleanup = helper.cleanup(cwd);

  beforeEach(cleanup);
  afterEach(cleanup);

  it('should install success when optionalDependencies fails', async () => {
    await coffee.fork(helper.npminstall, ['--detail'], { cwd }).debug().expect('code', 0).end();
  });
});
