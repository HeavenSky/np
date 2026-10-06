'use strict';

const npminstall = require('../support/npminstall');
const helper = require('../support/helper');

describe('test/deps/peer-warning.test.js', () => {
  const root = helper.fixtures('peerDependencies');
  const cleanup = helper.cleanup(root);

  beforeEach(cleanup);
  afterEach(cleanup);

  it('should show peerDependencies warning message', async () => {
    // ignore windows
    if (process.platform === 'win32') return;
    await npminstall({
      root,
      registry: 'https://registry.npmjs.com',
      env: {
        NODE_OPTIONS: '--max_old_space_size=4096',
      },
    });
  });
});
