'use strict';

const assert = require('assert');
const path = require('path');
const coffee = require('coffee');
const fs = require('fs/promises');
const helper = require('../support/helper');
const { realpathSync } = require('fs');
const { rimraf, existsSync, fileSource } = require('../../lib/utils');

describe('test/cli/uninstall.test.js', () => {
  const npmuninstall = path.join(__dirname, '../../bin/x.js');
  const root = helper.fixtures('uninstall');
  const cleanupModules = helper.cleanup(root);
  // 本地目录依赖的 store 目录名带源目录路径的摘要
  const storeName = `_pkg@1.0.0+${fileSource(realpathSync(path.join(root, 'pkg')))}@pkg`;

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

  it('should uninstall ok', async () => {
    await coffee
      .fork(npmuninstall, ['uninstall', 'koa', 'pkg@1.0.0'], {
        cwd: root,
        stdio: 'pipe',
      })
      .end();
    assert(!existsSync(path.join(root, 'node_modules/koa')));
    assert(!existsSync(path.join(root, 'node_modules/pkg')));
    assert(!existsSync(path.join(root, `node_modules/${storeName}`)));
  });

  it('should drop the install state of the removed package', async () => {
    const stateKeys = async () =>
      Object.keys(JSON.parse(await fs.readFile(path.join(root, 'node_modules/.npd-state.json'), 'utf8')).packages);
    assert((await stateKeys()).includes(storeName));
    await coffee.fork(npmuninstall, ['uninstall', 'pkg@1.0.0'], { cwd: root, stdio: 'pipe' }).expect('code', 0).end();
    assert(!(await stateKeys()).includes(storeName));
  });

  it('should uninstall --write=prod', async () => {
    await coffee
      .fork(npmuninstall, ['uninstall', 'pkg@1.0.0', '--write=prod'], {
        cwd: root,
        stdio: 'pipe',
      })
      .end();

    assert(!existsSync(path.join(root, `node_modules/${storeName}`)));
    const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json')));
    assert(!pkg.dependencies.pkg);
  });

  it('should uninstall --write=dev', async () => {
    await coffee
      .fork(npmuninstall, ['uninstall', 'pkg@1.0.0', '--write=dev'], {
        cwd: root,
        stdio: 'pipe',
      })
      .end();

    assert(!existsSync(path.join(path.join(root, 'node_modules/pkg'))));
    assert(!existsSync(path.join(path.join(root, `node_modules/${storeName}`))));
    const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json')));
    assert(!pkg.devDependencies.pkg);
  });

  it('should uninstall --write=optional', async () => {
    await coffee
      .fork(npmuninstall, ['uninstall', 'pkg@1.0.0', '--write=optional'], {
        cwd: root,
        stdio: 'pipe',
      })
      .end();

    assert(!existsSync(path.join(path.join(root, 'node_modules/pkg'))));
    assert(!existsSync(path.join(path.join(root, `node_modules/${storeName}`))));
    const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json')));
    assert(!pkg.optionalDependencies.pkg);
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

  it('should not uninstall when version not match', async () => {
    await coffee
      .fork(npmuninstall, ['uninstall', 'pkg@1.0.1', '--write=optional'], {
        cwd: root,
        stdio: 'pipe',
      })
      .end();

    assert(existsSync(path.join(root, 'node_modules/pkg')));
    assert(existsSync(path.join(root, `node_modules/${storeName}`)));
  });

  it('should not uninstall when name not match', async () => {
    await coffee
      .fork(npmuninstall, ['uninstall', 'pkg1@1.0.0', '--write=optional'], {
        cwd: root,
        stdio: 'pipe',
      })
      .end();

    assert(existsSync(path.join(root, `node_modules/${storeName}`)));
  });
});
