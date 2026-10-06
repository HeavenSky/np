'use strict';

const mm = require('mm');
const assert = require('assert');
const path = require('path');
const fs = require('fs/promises');
const { execSync } = require('child_process');
const semver = require('semver');
const npminstall = require('./npminstall');
const helper = require('./helper');
const utils = require('../lib/utils');

describe('test/installLocal.test.js', () => {
  const root = helper.fixtures('local');
  const cleanup = helper.cleanup(root);

  beforeEach(cleanup);
  afterEach(async () => {
    mm.restore();
    await cleanup();
  });

  it('should install local folder ok', async () => {
    await npminstall({
      root,
      pkgs: [{ name: null, version: 'file:pkg' }],
    });
    const pkg = await helper.readJSON(path.join(root, 'node_modules/pkg/package.json'));
    assert.equal(pkg.name, 'pkg');
  });

  it('should install local folder with copy ok', async () => {
    mm.error(utils, 'exec');
    await npminstall({
      root,
      pkgs: [{ name: null, version: 'file:pkg' }],
    });
    const pkg = await helper.readJSON(path.join(root, 'node_modules/pkg/package.json'));
    assert.equal(pkg.name, 'pkg');
  });

  it('should install local folder with relative path ok', async () => {
    await npminstall({
      root,
      pkgs: [{ name: null, version: './pkg' }],
    });
    const pkg = await helper.readJSON(path.join(root, 'node_modules/pkg/package.json'));
    assert.equal(pkg.name, 'pkg');
  });

  it('should install local link folder ok', async () => {
    if (process.platform === 'win32') {
      return;
    }
    await npminstall({
      root,
      pkgs: [{ name: null, version: 'file:pkg-link' }],
    });
    const pkg = await helper.readJSON(path.join(root, 'node_modules/pkg/package.json'));
    assert.equal(pkg.name, 'pkg');
  });

  it('should install local gzip tarball ok', async () => {
    await npminstall({
      root,
      pkgs: [{ name: null, version: 'file:sequelize.tgz' }],
    });

    const pkg = await helper.readJSON(path.join(root, 'node_modules/sequelize/package.json'));
    assert.equal(pkg.name, 'sequelize');
  });

  it('should install local link gzip tarball ok', async () => {
    if (process.platform === 'win32') {
      return;
    }
    await npminstall({
      root,
      pkgs: [{ name: null, version: 'file:sequelize-link.tgz' }],
    });

    const pkg = await helper.readJSON(path.join(root, 'node_modules/sequelize/package.json'));
    assert.equal(pkg.name, 'sequelize');
  });

  it('should install local naked tarball ok', async () => {
    await npminstall({
      root,
      pkgs: [{ name: null, version: 'file:pkg.tar' }],
    });
    const pkg = await helper.readJSON(path.join(root, 'node_modules/pkg/package.json'));
    assert.equal(pkg.name, 'pkg');
  });

  it('should install local folder without package.json error', async () => {
    try {
      await npminstall({
        root,
        pkgs: [{ name: null, version: 'file:not-pkg' }],
      });
      throw new Error('should not exec');
    } catch (err) {
      assert(err.message.match(/package.json is missing/), err.message);
    }
  });

  it('should install local tarball without package.json error', async () => {
    try {
      await npminstall({
        root,
        pkgs: [{ name: null, version: 'file:not-pkg.tar' }],
      });
      throw new Error('should not exec');
    } catch (err) {
      assert(err.message.match(/package.json is missing/), err.message);
    }
  });

  it('should install local folder without package name error', async () => {
    try {
      await npminstall({
        root,
        pkgs: [{ name: null, version: 'file:pkg-without-name' }],
      });
      throw new Error('should not exec');
    } catch (err) {
      assert(err.message.match(/package.json must contain name/), err.message);
    }
  });

  it('should install local tarball without package name error', async () => {
    try {
      await npminstall({
        root,
        pkgs: [{ name: null, version: 'file:pkg-without-name.tgz' }],
      });
      throw new Error('should not exec');
    } catch (err) {
      assert(err.message.match(/package.json must contain name/), err.message);
    }
  });

  it('should install local alias package ok', async () => {
    await npminstall({
      root,
      pkgs: [
        {
          name: 'lodash.has',
          version: '',
          alias: 'lodash-has',
        },
      ],
    });

    const pkg = await helper.readJSON(path.join(root, 'node_modules/lodash-has/package.json'));
    assert.strictEqual(pkg.name, 'lodash.has');
  });

  it('should install local alias package.json ok', async () => {
    const aliasRoot = path.join(root, 'alias');
    await npminstall({
      root: aliasRoot,
      pkgs: [],
    });

    const pkg1 = await helper.readJSON(path.join(aliasRoot, 'node_modules/lodash-has/package.json'));
    const pkg2 = await helper.readJSON(path.join(aliasRoot, 'node_modules/lodash-has-deprecated/package.json'));
    assert.strictEqual(pkg1.name, 'lodash.has');
    assert.strictEqual(semver.parse(pkg1.version).major, 4);
    assert.strictEqual(pkg2.name, 'lodash.has');
    assert.strictEqual(semver.parse(pkg2.version).major, 3);
  });

  if (process.platform !== 'win32') {
    it('should install the same tarball ok', async () => {
      await npminstall({
        root,
        pkgs: [{ name: null, version: 'file:pkg.tar' }],
      });
      let pkg = await helper.readJSON(path.join(root, 'node_modules/pkg/package.json'));
      assert.equal(pkg.name, 'pkg');
      await npminstall({
        root,
        pkgs: [
          { name: null, version: 'file:pkg.tar' },
          // { name: null, version: 'file:pkg.tar' },
        ],
      });
      pkg = await helper.readJSON(path.join(root, 'node_modules/pkg/package.json'));
      assert.equal(pkg.name, 'pkg');
    });

    it('should install the same local folder ok', async () => {
      await npminstall({
        root,
        pkgs: [{ name: null, version: 'file:pkg' }],
      });
      let pkg = await helper.readJSON(path.join(root, 'node_modules/pkg/package.json'));
      assert.equal(pkg.name, 'pkg');
      await npminstall({
        root,
        pkgs: [
          { name: null, version: 'file:pkg' },
          { name: null, version: 'file:pkg' },
        ],
      });
      pkg = await helper.readJSON(path.join(root, 'node_modules/pkg/package.json'));
      assert.equal(pkg.name, 'pkg');
    });
  }

  describe('scripts of local folders', () => {
    const [tmp, tmpCleanup] = helper.tmp();
    const app = path.join(tmp, 'app');
    const lib = path.join(tmp, 'lib');
    const marker = path.join(tmp, 'prepack');
    const prepacked = () =>
      fs.access(marker).then(
        () => true,
        () => false
      );

    beforeEach(async () => {
      await tmpCleanup();
      await fs.mkdir(app, { recursive: true });
      await fs.mkdir(lib, { recursive: true });
      await fs.writeFile(path.join(app, 'package.json'), JSON.stringify({ name: 'app', version: '1.0.0' }));
      await fs.writeFile(
        path.join(lib, 'package.json'),
        JSON.stringify({
          name: 'lib',
          version: '1.0.0',
          files: ['index.js'],
          scripts: { prepack: `node -e "require('fs').writeFileSync('${marker.replace(/\\/g, '/')}', 'x')"` },
        })
      );
      await fs.writeFile(path.join(lib, 'index.js'), 'module.exports = 1;\n');
      await fs.writeFile(path.join(lib, 'extra.js'), '');
    });
    after(() => fs.rm(tmp, { recursive: true, force: true }));

    const installedFiles = async () => (await fs.readdir(path.join(app, 'node_modules/lib'))).sort();

    it('should pack by files without running prepack when scripts are ignored', async () => {
      await npminstall({ root: app, pkgs: [{ name: null, version: `file:${lib}` }], ignoreScripts: true });
      assert.deepEqual(await installedFiles(), ['index.js', 'package.json']);
      assert.equal(await prepacked(), false);
    });

    it('should pack a trusted local folder with npm pack on npm 7+', async function () {
      const npmVersion = execSync('npm --version', { timeout: 30000 }).toString().trim();
      if (semver.major(npmVersion) < 7) this.skip();
      await npminstall({ root: app, pkgs: [{ name: null, version: `file:${lib}` }] });
      assert.deepEqual(await installedFiles(), ['index.js', 'package.json']);
      assert.equal(await prepacked(), true);
    });
  });
});
