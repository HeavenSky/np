const assert = require('node:assert');
const path = require('node:path');
const npminstall = require('../support/npminstall');
const helper = require('../support/helper');
const { exists } = require('../../lib/utils');

describe('test/install/css-loader.test.js', () => {
  const tmp = helper.fixtures('css-loader-example2');
  it('should work on css-loader', async () => {
    // ignore windows
    if (process.platform === 'win32') return;
    await npminstall({
      root: tmp,
      registry: 'https://registry.npmjs.com',
      env: {
        NODE_OPTIONS: '--max_old_space_size=4096',
      },
    });
    assert(await exists(path.join(tmp, 'node_modules/css-loader')));
  });
});
