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

  // 本地包的 store 目录名带来源标识: pkg@1.0.0+file.<hash>; 卸载后不再被引用的版本目录被回收
  async function assertStoreDirRemoved() {
    const entries = await fs.readdir(path.join(root, 'node_modules/.store'));
    assert(!entries.some(name => /^pkg@1\.0\.0\+file\.[a-f0-9]{8}$/.test(name)), entries.join(', '));
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
    await assertStoreDirRemoved();
  });

  it('should also remove the package from <type>Dependencies with --write=<type>', async () => {
    const pkgFile = path.join(root, 'package.json');
    const before = JSON.parse(await fs.readFile(pkgFile));
    await fs.writeFile(pkgFile, JSON.stringify({ ...before, clientDependencies: { pkg: '1.0.0', other: '1.0.0' } }));
    await coffee
      .fork(npmuninstall, ['uninstall', 'pkg@1.0.0', '--write=client'], { cwd: root, stdio: 'pipe' })
      .debug()
      .expect('code', 0)
      .end();

    assertFile.fail(path.join(root, 'node_modules/pkg'));
    await assertStoreDirRemoved();
    const pkg = JSON.parse(await fs.readFile(pkgFile));
    assert(!pkg.dependencies.pkg);
    assert.deepEqual(pkg.clientDependencies, { other: '1.0.0' });

    await coffee
      .fork(npmuninstall, ['uninstall', 'koa', '--save'], { cwd: root, stdio: 'pipe' })
      .expect('code', 1)
      .expect('stderr', /--save has been removed/)
      .end();
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
