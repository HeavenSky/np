// --dedup 提升到根目录的同名包取本次安装内的最高版本, 根目录直接依赖保持声明版本
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs/promises');
const coffee = require('coffee');
const helper = require('./helper');

describe('test/install-dedup-latest.test.js', () => {
  const [ tmp, cleanup ] = helper.tmp();

  beforeEach(cleanup);
  afterEach(cleanup);

  async function writeJSON(file, data) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(data));
  }

  async function version(name) {
    return (await helper.readJSON(path.join(tmp, 'node_modules', name, 'package.json'))).version;
  }

  function install(args = []) {
    return coffee.fork(helper.npminstall, [ '--dedup', ...args ], { cwd: tmp })
      .debug()
      .expect('code', 0)
      .end();
  }

  it('should relink hoisted package to the latest version on reinstall', async () => {
    const pkgFile = path.join(tmp, 'package.json');
    await writeJSON(pkgFile, { name: 'r', version: '1.0.0', dependencies: { debug: '2.6.9' } });
    await install();
    assert.equal(await version('ms'), '2.0.0');

    await writeJSON(pkgFile, { name: 'r', version: '1.0.0', dependencies: { debug: '2.6.9', koa: '2.15.3' } });
    await install();
    assert.equal(await version('ms'), '2.1.3');
    assert.equal(await version('debug'), '2.6.9');
  });

  for (const workspaces of [[ 'packages/a', 'packages/b' ], [ 'packages/b', 'packages/a' ]]) {
    it(`should hoist the latest version regardless of workspace order ${workspaces.join(',')}`, async () => {
      await writeJSON(path.join(tmp, 'package.json'), { name: 'w', version: '1.0.0', private: true, workspaces });
      await writeJSON(path.join(tmp, 'packages/a/package.json'), { name: 'a', version: '1.0.0', dependencies: { debug: '2.6.9' } });
      await writeJSON(path.join(tmp, 'packages/b/package.json'), { name: 'b', version: '1.0.0', dependencies: { debug: '4.4.3' } });
      await install();
      assert.equal(await version('ms'), '2.1.3');
      assert.equal(await version('debug'), '4.4.3');
    });
  }

  it('should keep workspace root dependency version', async () => {
    await writeJSON(path.join(tmp, 'package.json'), {
      name: 'w', version: '1.0.0', private: true, workspaces: [ 'packages/b' ], dependencies: { ms: '2.0.0' },
    });
    await writeJSON(path.join(tmp, 'packages/b/package.json'), { name: 'b', version: '1.0.0', dependencies: { debug: '4.4.3' } });
    await install();
    assert.equal(await version('ms'), '2.0.0');
    await install([ '-w', 'b' ]);
    assert.equal(await version('ms'), '2.0.0');
    assert.equal(await fs.readlink(path.join(tmp, 'node_modules/b')), '../packages/b');
  });
});
