'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs/promises');
const npminstall = require('./npminstall');
const helper = require('./helper');

describe('test/linkLatestVersion.test.js', () => {
  const root = helper.fixtures('link-latest-version');
  const cleanup = helper.cleanup(root);

  beforeEach(cleanup);
  afterEach(cleanup);

  it('should link latest version to node_modules', async () => {
    const names = ['debug', 'ms', 'iconv-lite', 'utility'];
    await npminstall({
      root,
    });
    const pkg = await helper.readJSON(path.join(root, 'node_modules', 'urllib', 'package.json'));
    assert.equal(pkg.version, '2.7.1');

    const versions = {};
    for (const name of names) {
      const pkg = await helper.readJSON(path.join(root, 'node_modules', name, 'package.json'));
      versions[pkg.name] = pkg.version;
    }

    const pkg2 = await helper.readJSON(path.join(root, 'node_modules', 'iconv-lite', 'package.json'));
    assert.equal(pkg2.name, 'iconv-lite');

    await npminstall({
      root,
      pkgs: [{ name: 'toshihiko', version: '1.0.0-alpha.10' }],
    });

    for (const name of names) {
      const pkg = await helper.readJSON(path.join(root, 'node_modules', name, 'package.json'));
      switch (name) {
        case 'debug':
        case 'iconv-lite':
          assert.strictEqual(pkg.version, versions[pkg.name]);
          break;

        case 'ms':
        case 'utility':
        default:
          assert(pkg.version !== versions[pkg.name]);
          break;
      }
    }
  });

  describe('reinstall', () => {
    const [tmp, cleanupTmp] = helper.tmp();
    beforeEach(cleanupTmp);
    afterEach(cleanupTmp);

    async function writePkg(dependencies) {
      await fs.writeFile(
        path.join(tmp, 'package.json'),
        JSON.stringify({ name: 'demo', version: '1.0.0', dependencies })
      );
    }

    async function readVersion(name) {
      return (await helper.readJSON(path.join(tmp, 'node_modules', name, 'package.json'))).version;
    }

    it('should relink hoisted package after dependencies changed', async () => {
      await writePkg({ debug: '4.3.4' });
      await npminstall({ root: tmp });
      assert.equal(await readVersion('ms'), '2.1.2');

      await writePkg({ debug: '2.6.9' });
      await npminstall({ root: tmp });
      assert.equal(await readVersion('ms'), '2.0.0');
    });

    it('should keep dependencies declared in package.json', async () => {
      await writePkg({ ms: '2.0.0' });
      await npminstall({ root: tmp });
      assert.equal(await readVersion('ms'), '2.0.0');

      await npminstall({ root: tmp, pkgs: [{ name: 'debug', version: '4.3.4' }] });
      assert.equal(await readVersion('ms'), '2.0.0');
      assert.equal(await readVersion('debug'), '4.3.4');
    });
  });
});
