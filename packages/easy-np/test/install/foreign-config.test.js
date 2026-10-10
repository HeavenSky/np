// 两个入口都兼容读取 .npmrc 的 registry 与 pnpm-workspace.yaml 的 packages
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs/promises');
const coffee = require('coffee');
const helper = require('../support/helper');
const { exists } = require('../../lib/utils');

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
      await coffee.fork(helper.x, ['install'], { cwd: root, env }).debug().expect('code', 0).end();
      assert(await exists(path.join(root, 'node_modules/npmrc-only-hello/package.json')));
    });
  });

  it('should read workspaces from pnpm-workspace.yaml with both entries', async () => {
    await writeJSON('package.json', { name: 'app', version: '1.0.0', private: true });
    await fs.writeFile(path.join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n  - '!packages/skip'\n");
    for (const name of ['a', 'skip']) {
      await fs.mkdir(path.join(root, 'packages', name), { recursive: true });
      await writeJSON(`packages/${name}/package.json`, { name, version: '1.0.0', dependencies: { ms: '2.1.3' } });
    }

    for (const [bin, args] of [
      [helper.npminstall, []],
      [helper.x, ['install']],
    ]) {
      await fs.rm(path.join(root, 'node_modules'), { recursive: true, force: true });
      await coffee.fork(bin, args, { cwd: root }).debug().expect('code', 0).end();
      assert(await exists(path.join(root, 'node_modules/a/package.json')));
      assert(await exists(path.join(root, 'packages/a/node_modules/ms/package.json')));
      assert(!(await exists(path.join(root, 'node_modules/skip'))));
    }
  });
});
