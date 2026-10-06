'use strict';

const semver = require('semver');
const npminstall = require('../support/npminstall');
const helper = require('../support/helper');

if (semver.satisfies(process.version, '< 12.0.0')) {
  describe('test/registry/node-pre-gyp-mirror.test.js', () => {
    const [tmp, cleanup] = helper.tmp();

    beforeEach(cleanup);
    afterEach(cleanup);

    it('should download from http mirror work fine', async () => {
      await npminstall({
        root: tmp,
        pkgs: [{ name: 'sqlite3', version: '4' }],
        production: true,
        cacheDir: '',
        customBinaryMirrors: {
          sqlite3: {
            host: process.env.CI ? 'https://cnpmjs.org/mirrors' : 'https://npmmirror.com/mirrors',
          },
        },
      });
    });
  });
}
