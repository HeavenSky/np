const mm = require('mm');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs/promises');
const coffee = require('coffee');
const semver = require('semver');
const npminstall = require('../support/npminstall');
const helper = require('../support/helper');
const utils = require('../../lib/utils');

describe('test/sources/local.test.js', () => {
  const root = helper.fixtures('local');
  const cleanup = helper.cleanup(root);

  beforeEach(cleanup);
  afterEach(cleanup);

  it('should install local folder ok', async () => {
    await npminstall({
      root,
      pkgs: [{ name: 'test', version: 'file:pkg' }],
    });
    const pkg = await helper.readJSON(path.join(root, 'node_modules/pkg/package.json'));
    assert.equal(pkg.name, 'pkg');
  });

  it('should install local folder with copy ok', async () => {
    mm.error(utils, 'spawnWithTimeout');
    await npminstall({
      root,
      pkgs: [{ name: 'test', version: 'file:pkg' }],
    });
    const pkg = await helper.readJSON(path.join(root, 'node_modules/pkg/package.json'));
    assert.equal(pkg.name, 'pkg');
  });

  it('should install local folder with relative path ok', async () => {
    await npminstall({
      root,
      pkgs: [{ name: 'test', version: './pkg' }],
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
      pkgs: [{ name: 'test', version: 'file:pkg-link' }],
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

  it('should copy a local folder by npm pack rules without npm pack when scripts are ignored', async () => {
    const [tmp, tmpCleanup] = helper.tmp();
    await tmpCleanup();
    const commands = [];
    const unexpected = async command => {
      commands.push(command);
      throw new Error(`unexpected command: ${command}`);
    };
    mm(utils, 'exec', unexpected);
    mm(utils, 'spawnWithTimeout', unexpected);
    try {
      const dep = path.join(tmp, 'dep');
      const app = path.join(tmp, 'app');
      const marker = path.join(tmp, 'prepack.marker');
      await fs.mkdir(path.join(dep, 'lib'), { recursive: true });
      await fs.mkdir(app, { recursive: true });
      await fs.writeFile(
        path.join(dep, 'package.json'),
        JSON.stringify({
          name: 'dep',
          version: '1.0.0',
          files: ['lib'],
          scripts: { prepack: `node -e "require('fs').writeFileSync('${marker.replace(/\\/g, '/')}', '')"` },
        })
      );
      await fs.writeFile(path.join(dep, 'lib/index.js'), '');
      await fs.writeFile(path.join(dep, 'secret.txt'), '');
      await fs.writeFile(path.join(app, 'package.json'), JSON.stringify({ name: 'app', version: '1.0.0' }));
      await npminstall({ root: app, ignoreScripts: true, pkgs: [{ name: null, version: `file:${dep}` }] });
      const files = (await fs.readdir(path.join(app, 'node_modules/dep'))).sort();
      assert.deepEqual(files, ['lib', 'package.json']);
      assert.deepEqual(commands, []);
      assert.equal(await utils.exists(marker), false);
    } finally {
      mm.restore();
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('should pack a trusted local folder with npm pack when prepack prints more than 1 MB', async () => {
    const npmVersion = (await utils.exec('npm --version', { timeout: 30000 })).stdout.trim();
    if (!semver.gte(npmVersion, '7.18.0')) return;
    const [tmp, tmpCleanup] = helper.tmp();
    await tmpCleanup();
    try {
      const dep = path.join(tmp, 'dep');
      const app = path.join(tmp, 'app');
      await fs.mkdir(dep, { recursive: true });
      await fs.mkdir(app, { recursive: true });
      await fs.writeFile(
        path.join(dep, 'package.json'),
        JSON.stringify({
          name: 'dep',
          version: '1.0.0',
          files: ['index.js', 'built.js'],
          scripts: {
            prepack: `node -e "process.stdout.write('x'.repeat(2 * 1024 * 1024)); require('fs').writeFileSync('built.js', '')"`,
          },
        })
      );
      await fs.writeFile(path.join(dep, 'index.js'), '');
      await fs.writeFile(path.join(app, 'package.json'), JSON.stringify({ name: 'app', version: '1.0.0' }));
      await npminstall({ root: app, pkgs: [{ name: null, version: `file:${dep}` }] });
      const files = (await fs.readdir(path.join(app, 'node_modules/dep'))).sort();
      assert.deepEqual(files, ['built.js', 'index.js', 'package.json']);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('should reject the removed --root', async () => {
    await coffee
      .fork(helper.npminstall, ['--root=not-exists'])
      .expect('code', 1)
      .expect('stderr', /--root has been removed/)
      .end();
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
        pkgs: [{ name: 'test', version: 'file:pkg' }],
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
});
