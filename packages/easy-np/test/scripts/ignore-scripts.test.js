const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs/promises');
const npminstall = require('../support/npminstall');
const helper = require('../support/helper');
const { exists } = require('../../lib/utils');

describe('test/scripts/ignore-scripts.test.js', () => {
  const root = helper.fixtures('ignore-scripts');
  const cleanup = helper.cleanup(root);

  beforeEach(cleanup);
  afterEach(cleanup);

  it('should ignore scripts', async () => {
    await npminstall({
      root,
      ignoreScripts: true,
    });

    const dirs = await fs.readdir(path.join(root, 'node_modules'));
    assert.deepEqual(dirs.sort(), ['.store', '.package_versions.json', '.tmp', 'pkg'].sort());
    const files = await fs.readdir(path.join(root, 'node_modules/pkg'));
    assert.deepEqual(files, ['index.js', 'package.json']);
  });

  describe('binding.gyp', () => {
    const [tmp, cleanupTmp] = helper.tmp();

    beforeEach(cleanupTmp);
    afterEach(cleanupTmp);

    it('should not build the root or dependencies', async () => {
      await fs.mkdir(path.join(tmp, 'dep'), { recursive: true });
      await fs.writeFile(
        path.join(tmp, 'package.json'),
        JSON.stringify({ name: 'app', version: '1.0.0', dependencies: { dep: 'file:./dep' } })
      );
      await fs.writeFile(path.join(tmp, 'dep/package.json'), JSON.stringify({ name: 'dep', version: '1.0.0' }));
      for (const dir of [tmp, path.join(tmp, 'dep')]) {
        await fs.writeFile(path.join(dir, 'binding.gyp'), '{ this is not a valid gyp file');
      }
      await npminstall({ root: tmp, ignoreScripts: true });
      assert(await exists(path.join(tmp, 'node_modules/dep/binding.gyp')));
      assert.equal(await exists(path.join(tmp, 'build')), false);
      assert.equal(await exists(path.join(tmp, 'node_modules/dep/build')), false);
    });
  });
});
