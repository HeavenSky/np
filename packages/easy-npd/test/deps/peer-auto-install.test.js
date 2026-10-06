'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs/promises');
const helper = require('../support/helper');
const { installLocal } = require('../..');

describe('test/deps/peer-auto-install.test.js', () => {
  const [tmp, cleanup] = helper.tmp();
  beforeEach(async () => {
    await cleanup();
    await fs.writeFile(
      path.join(tmp, 'package.json'),
      JSON.stringify({ name: 'root', version: '1.0.0', dependencies: { 'use-sync-external-store': '1.2.0' } })
    );
  });
  afterEach(cleanup);

  // 不用 require.resolve: 它缓存解析结果, 两个用例共用同一目录时会读到上一个用例的结果
  async function findPeer() {
    const dir = await fs.realpath(path.join(tmp, 'node_modules/use-sync-external-store'));
    for (const candidate of [path.join(dir, 'node_modules/react'), path.join(dir, '../react')]) {
      const pkg = await helper.readJSON(path.join(candidate, 'package.json'));
      if (pkg.name) return pkg;
    }
    return null;
  }

  it('should install missing peerDependencies', async () => {
    await installLocal({ root: tmp });
    assert.equal((await findPeer())?.name, 'react');
  });

  it('should not install missing peerDependencies with legacyPeerDeps', async () => {
    await installLocal({ root: tmp, legacyPeerDeps: true });
    assert.equal(await findPeer(), null);
  });
});
