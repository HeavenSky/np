'use strict';

const assert = require('assert');
const path = require('path');
const npminstall = require('../support/npminstall');
const helper = require('../support/helper');
const { exists } = require('../../lib/utils');

describe('test/scripts/env-npm-execpath.test.js', () => {
  const [tmp, cleanup] = helper.tmp();

  beforeEach(cleanup);
  afterEach(cleanup);

  it('should node-gyp work fine', async () => {
    await npminstall({
      root: tmp,
      pkgs: [{ name: 'dtrace-provider' }],
    });
    assert(await exists(path.join(tmp, 'node_modules/dtrace-provider')));
  });
});
