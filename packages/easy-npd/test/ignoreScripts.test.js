'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs/promises');
const npminstall = require('./npminstall');
const helper = require('./helper');

describe('test/ignoreScripts.test.js', () => {
  const root = helper.fixtures('ignore-scripts');
  const cleanup = helper.cleanup(root);

  beforeEach(cleanup);
  afterEach(cleanup);

  it('should ignore scripts', async () => {
    await npminstall({
      root,
      ignoreScripts: true,
    });

    const dirs = (await fs.readdir(path.join(root, 'node_modules'))).map(dir =>
      dir.replace(/\+file\.[0-9a-f]{8}@/, '+file.*@')
    );
    assert.deepEqual(
      dirs.sort(),
      ['_pkg@1.0.0+file.*@pkg', '.npd-state.json', '.package_versions.json', '.tmp', 'pkg'].sort()
    );
    const files = await fs.readdir(path.join(root, 'node_modules/pkg'));
    assert.deepEqual(files, ['index.js', 'package.json']);
  });

  describe('binding.gyp', () => {
    const [tmp, cleanupTmp] = helper.tmp();

    beforeEach(cleanupTmp);
    afterEach(cleanupTmp);

    it('should not build binding.gyp of the root and dependencies', async () => {
      // 故意写错的 binding.gyp: 执行 node-gyp 就会安装失败
      await fs.writeFile(path.join(tmp, 'binding.gyp'), '{ invalid');
      await fs.writeFile(
        path.join(tmp, 'package.json'),
        JSON.stringify({ name: 'gyp-root', version: '1.0.0', dependencies: { 'gyp-dep': 'file:./dep' } })
      );
      await fs.mkdir(path.join(tmp, 'dep'));
      await fs.writeFile(path.join(tmp, 'dep/binding.gyp'), '{ invalid');
      await fs.writeFile(path.join(tmp, 'dep/package.json'), JSON.stringify({ name: 'gyp-dep', version: '1.0.0' }));

      await npminstall({ root: tmp, ignoreScripts: true, console: { info() {}, log() {}, warn() {}, error() {} } });
      assert.deepEqual((await fs.readdir(path.join(tmp, 'node_modules/gyp-dep'))).sort(), [
        'binding.gyp',
        'package.json',
      ]);
      await assert.rejects(fs.access(path.join(tmp, 'build')));
    });
  });
});
