const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs/promises');
const coffee = require('coffee');
const assertFile = require('assert-file');
const helper = require('../support/helper');
const { rimraf } = require('../../lib/utils');

describe('test/cli/uninstall.test.js', () => {
  const npmuninstall = path.join(__dirname, '../../bin/x.js');
  const root = helper.fixtures('uninstall');
  const cleanupModules = helper.cleanup(root);

  async function cleanup() {
    await cleanupModules();
    await rimraf(path.join(root, 'package.json'));
  }

  beforeEach(async () => {
    await cleanup();
    const content = await fs.readFile(path.join(root, 'package.json.template'));
    await fs.writeFile(path.join(root, 'package.json'), content);
    await coffee
      .fork(helper.npminstall, [], {
        cwd: root,
        stdio: 'pipe',
      })
      .end();
  });
  afterEach(cleanup);

  // 本地包的 store 目录名带来源标识: pkg@1.0.0+file.<hash>
  async function assertStoreDir() {
    const entries = await fs.readdir(path.join(root, 'node_modules/.store'));
    const entry = entries.find(name => /^pkg@1\.0\.0\+file\.[a-f0-9]{8}$/.test(name));
    assert(entry, entries.join(', '));
    assertFile(path.join(root, 'node_modules/.store', entry, 'node_modules/pkg'));
  }

  it('should uninstall ok', async () => {
    await coffee
      .fork(npmuninstall, ['uninstall', 'koa', 'pkg@1.0.0'], {
        cwd: root,
        stdio: 'pipe',
      })
      .end();
    assertFile.fail(path.join(root, 'node_modules/koa'));
    assertFile.fail(path.join(root, 'node_modules/pkg'));
    // dont remove real dir
    await assertStoreDir();
  });

  it('should uninstall --save', async () => {
    await coffee
      .fork(npmuninstall, ['uninstall', 'pkg@1.0.0', '--save'], {
        cwd: root,
        stdio: 'pipe',
      })
      .debug()
      .expect('code', 0)
      .end();

    assertFile.fail(path.join(root, 'node_modules/pkg'));
    // dont remove real dir
    await assertStoreDir();
    const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json')));
    assert(!pkg.dependencies.pkg);
  });

  it('should prune package.json by default', async () => {
    await coffee
      .fork(npmuninstall, ['uninstall', 'pkg@1.0.0'], {
        cwd: root,
        stdio: 'pipe',
      })
      .end();
    const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json')));
    const depKeys = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
    depKeys.forEach(key => assert(!pkg[key].pkg));
  });
});
