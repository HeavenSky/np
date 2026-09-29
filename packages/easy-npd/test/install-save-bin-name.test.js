'use strict';

const assert = require('assert');
const path = require('path');
const coffee = require('coffee');
const helper = require('./helper');
const { exists } = require('../lib/utils');

describe('test/install-save-bin-name.test.js', () => {
  const root = helper.fixtures('same-bin-name');
  const cleanupModules = helper.cleanup(root);
  const restorePkg = helper.restoreFile(path.join(root, 'package.json'));
  async function cleanup() {
    await cleanupModules();
    await restorePkg();
  }

  beforeEach(cleanup);
  afterEach(cleanup);

  it('should install work', async () => {
    await coffee
      .fork(helper.npminstall, ['webpack-parallel-uglify-plugin@1.0.0'], {
        cwd: root,
      })
      .debug()
      .expect('code', 0)
      .end();

    assert(await exists(path.join(root, 'node_modules/webpack-parallel-uglify-plugin/node_modules/.bin/uglifyjs')));
  });
});
