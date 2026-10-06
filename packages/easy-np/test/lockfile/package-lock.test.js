const coffee = require('coffee');
const path = require('node:path');
const assert = require('node:assert');
const fs = require('node:fs/promises');
const { lockfileConverter } = require('../../lib/lockfile_resolver');
const Nested = require('../../lib/nested');
const helper = require('../support/helper');

describe('test/lockfile/package-lock.test.js', () => {
  const cwd = helper.fixtures('lockfile');
  const lockfile = require(path.join(cwd, 'package-lock.json'));
  const nested = new Nested([]);
  const cleanup = helper.cleanup(cwd);

  beforeEach(cleanup);
  afterEach(cleanup);

  // the Windows path sucks, shamefully skip these tests
  if (process.platform !== 'win32') {
    it('should install successfully', async () => {
      await coffee
        .fork(helper.npminstall, ['--lockfile-path', path.join(cwd, 'package-lock.json')], { cwd })
        .debug()
        .expect('code', 0)
        .notExpect('stdout', "TypeError: Cannot read properties of undefined (reading 'ignoreOptionalDependencies')")
        .end();
      assert.strictEqual(
        await fs.readlink(path.join(cwd, 'node_modules', 'lodash.has3'), 'utf8'),
        '.store/lodash.has@3.2.1/node_modules/lodash.has'
      );
      assert.strictEqual(
        await fs.readlink(path.join(cwd, 'node_modules', 'lodash.has'), 'utf8'),
        '.store/lodash.has@4.0.0/node_modules/lodash.has'
      );
    });

    it('should convert package-lock.json to .dependencies-tree.json successfully', () => {
      const dependenciesTree = lockfileConverter(
        lockfile,
        {
          ignoreOptionalDependencies: true,
        },
        nested
      );

      assert.strictEqual(Object.keys(dependenciesTree).length, 29);
    });
  }

  describe('workspaces', () => {
    const [root, cleanupRoot] = helper.tmp();
    const lockfileData = {
      name: 'root',
      lockfileVersion: 3,
      packages: {
        '': { name: 'root', workspaces: ['packages/*'] },
        'node_modules/a': { resolved: 'packages/a', link: true },
        'node_modules/ms': {
          version: '2.1.1',
          resolved: 'https://registry.npmjs.org/ms/-/ms-2.1.1.tgz',
          integrity: 'sha512-tgp+dl5cGk28utYktBsrFqA7HKgrhgPsg6Z/EfhWI4gl1Hwq8B/GmY/0oXZ6nF8hDVesS/FpnYaD/kOWhYQvyg==',
        },
        'packages/a': { name: 'a', version: '1.0.0', dependencies: { ms: '^2.1.1' } },
      },
    };

    beforeEach(async () => {
      await cleanupRoot();
      await fs.mkdir(path.join(root, 'packages/a'), { recursive: true });
      await fs.writeFile(
        path.join(root, 'package.json'),
        JSON.stringify({ name: 'root', version: '1.0.0', workspaces: ['packages/*'] })
      );
      await fs.writeFile(
        path.join(root, 'packages/a/package.json'),
        JSON.stringify({ name: 'a', version: '1.0.0', dependencies: { ms: '^2.1.1' } })
      );
      await fs.writeFile(path.join(root, 'package-lock.json'), JSON.stringify(lockfileData));
    });
    after(cleanupRoot);

    it('should resolve workspace dependencies from the hoisted node_modules', () => {
      const tree = lockfileConverter(lockfileData, { ignoreOptionalDependencies: true }, nested);
      assert.deepEqual(Object.keys(tree), ['ms@^2.1.1']);
      assert.equal(tree['ms@^2.1.1'].version, '2.1.1');
    });

    if (process.platform !== 'win32') {
      it('should install every workspace with the locked versions', async () => {
        await coffee
          .fork(helper.npminstall, ['--lockfile-path', path.join(root, 'package-lock.json')], { cwd: root })
          .debug()
          .expect('code', 0)
          .end();
        const msDir = await fs.realpath(path.join(root, 'packages/a/node_modules/ms'));
        assert.equal((await helper.readJSON(path.join(msDir, 'package.json'))).version, '2.1.1');
      });
    }

    it('should keep the first locked version and report conflicts', () => {
      const conflicts = [];
      const data = JSON.parse(JSON.stringify(lockfileData));
      data.packages['packages/b'] = { name: 'b', version: '1.0.0', dependencies: { ms: '^2.1.1' } };
      data.packages['packages/b/node_modules/ms'] = { version: '2.1.3', resolved: 'x', integrity: 'y' };
      const tree = lockfileConverter(
        data,
        { ignoreOptionalDependencies: true, onConflict: (...args) => conflicts.push(args) },
        nested
      );
      assert.equal(tree['ms@^2.1.1'].version, '2.1.1');
      assert.deepEqual(conflicts, [['ms@^2.1.1', '2.1.1', '2.1.3']]);
    });
  });
});
