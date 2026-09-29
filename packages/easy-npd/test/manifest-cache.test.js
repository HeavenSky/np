'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs/promises');
const coffee = require('coffee');
const helper = require('./helper');

describe('test/manifest-cache.test.js', () => {
  const [tmp, cleanup] = helper.tmp();
  const cacheDir = path.join(tmp, '.cache');
  const env = Object.assign({}, process.env, { npd_cache: cacheDir });

  beforeEach(async () => {
    await cleanup();
    await fs.writeFile(path.join(tmp, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }));
  });
  afterEach(cleanup);

  async function listCacheFiles(name) {
    const files = await fs.readdir(path.join(cacheDir, 'np-manifests', name));
    return files.filter(file => file.endsWith('.json'));
  }

  it('should group manifest cache files by package name', async () => {
    await coffee
      .fork(helper.npminstall, ['ms@2.1.3', '@tsconfig/node18@18.2.4'], { cwd: tmp, env })
      .debug()
      .expect('code', 0)
      .end();
    assert.equal((await listCacheFiles('ms')).length, 1);
    assert.equal((await listCacheFiles('@tsconfig/node18')).length, 1);

    await fs.rm(path.join(tmp, 'node_modules'), { recursive: true, force: true });
    await coffee
      .fork(helper.npminstall, ['ms@2.1.3', '@tsconfig/node18@18.2.4'], { cwd: tmp, env })
      .debug()
      .expect('code', 0)
      .expect('stderr', /manifests cache hit 2/)
      .end();
  });
});
