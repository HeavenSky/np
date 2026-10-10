// 两个入口都兼容读取 .npmrc 的 registry
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs/promises');
const coffee = require('coffee');
const helper = require('../support/helper');
const { exists } = require('../../lib/utils');

const x = path.join(__dirname, '../..', 'bin', 'x.js');

describe('test/install/foreign-config.test.js', () => {
  const [tmp, cleanup] = helper.tmp();
  const root = path.join(tmp, 'app');
  const writeJSON = (file, data) => fs.writeFile(path.join(root, file), JSON.stringify(data));

  beforeEach(async () => {
    await cleanup();
    await fs.mkdir(root, { recursive: true });
  });
  after(cleanup);

  describe('registry in .npmrc', () => {
    let registry;
    before(async () => {
      registry = helper.createRegistry('registry', []);
      await new Promise(resolve => registry.server.listen(0, '127.0.0.1', resolve));
      registry.prefix = `http://127.0.0.1:${registry.server.address().port}/`;
    });
    after(() => registry.server.close());

    it('should install from the registry of .npmrc with both entries', async () => {
      const tarball = await helper.packTarball(tmp, { name: 'npmrc-only-hello', version: '1.0.0' });
      registry.packages = { 'npmrc-only-hello': { '1.0.0': tarball } };
      await writeJSON('package.json', { name: 'app', version: '1.0.0', dependencies: { 'npmrc-only-hello': '1.0.0' } });
      await fs.writeFile(path.join(root, '.npmrc'), `registry=${registry.prefix}\n`);
      const env = { ...process.env, np_cache: path.join(tmp, 'cache') };

      await coffee.fork(helper.npminstall, [], { cwd: root, env }).debug().expect('code', 0).end();
      assert(await exists(path.join(root, 'node_modules/npmrc-only-hello/package.json')));
      await fs.rm(path.join(root, 'node_modules'), { recursive: true, force: true });
      await coffee.fork(x, ['install'], { cwd: root, env }).debug().expect('code', 0).end();
      assert(await exists(path.join(root, 'node_modules/npmrc-only-hello/package.json')));
    });
  });
});
