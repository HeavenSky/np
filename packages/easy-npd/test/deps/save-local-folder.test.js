'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs/promises');
const coffee = require('coffee');
const helper = require('../support/helper');
const { exists } = require('../../lib/utils');

describe('test/deps/save-local-folder.test.js', () => {
  const [root, cleanup] = helper.tmp();
  const demo = helper.fixtures('demo-install-save-folder');

  beforeEach(cleanup);
  afterEach(cleanup);

  it('should save to dependencies by default', async () => {
    await coffee
      .fork(helper.npminstall, [demo], {
        cwd: root,
      })
      // .debug()
      .end();

    const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json')));
    assert(pkg.dependencies.demo, '^1.0.0');
    assert(await exists(path.join(root, 'node_modules/demo')));
  });

  it('should --write=dev install work', async () => {
    await coffee
      .fork(helper.npminstall, ['--write=dev', demo], {
        cwd: root,
      })
      // .debug()
      .end();

    const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json')));
    assert(pkg.devDependencies.demo, '^1.0.0');
    assert(await exists(path.join(root, 'node_modules/demo')));
  });

  it('should --write=client install work', async () => {
    await coffee
      .fork(helper.npminstall, ['--write=client', demo], {
        cwd: root,
      })
      // .debug()
      .end();

    const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json')));
    assert(pkg.clientDependencies.demo, '^1.0.0');
    assert(await exists(path.join(root, 'node_modules/demo')));
  });

  it('should --write=build --write-exact install work', async () => {
    await coffee
      .fork(helper.npminstall, ['--write=build', '--write-exact', demo], {
        cwd: root,
      })
      // .debug()
      .end();

    const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json')));
    assert.equal(pkg.buildDependencies.demo, '1.0.0');
    assert(await exists(path.join(root, 'node_modules/demo')));
  });

  it('should --write=isomorphic install work', async () => {
    await coffee
      .fork(helper.npminstall, ['--write=isomorphic', demo], {
        cwd: root,
      })
      // .debug()
      .end();

    const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json')));
    assert(pkg.isomorphicDependencies.demo, '^1.0.0');
    assert(await exists(path.join(root, 'node_modules/demo')));
  });
});
