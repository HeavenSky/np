const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs/promises');
const coffee = require('coffee');
const helper = require('./helper');

describe('test/prune.test.js', () => {
  const [tmp, cleanup] = helper.tmp();
  const store = path.join(tmp, 'node_modules/.store');
  const x = path.join(__dirname, '..', 'bin', 'x.js');
  const writePkg = dependencies =>
    fs.writeFile(path.join(tmp, 'package.json'), JSON.stringify({ name: 'root', version: '1.0.0', dependencies }));
  const run = (bin, args) => coffee.fork(bin, args, { cwd: tmp, env: { ...process.env, np_lockfile: 'false' } });
  const storeEntries = async () => (await fs.readdir(store)).filter(name => name.includes('@')).sort();

  beforeEach(cleanup);
  afterEach(cleanup);

  it('should remove versions left by upgrades and uninstalls only when asked', async () => {
    await writePkg({ debug: '4.3.4', pedding: '1.1.0' });
    await run(helper.npminstall, []).expect('code', 0).end();
    await writePkg({ debug: '3.2.7' });
    await run(helper.npminstall, []).expect('code', 0).end();
    await run(x, ['uninstall', 'pedding']).expect('code', 0).end();
    // 安装与卸载本身不删除旧版本
    const before = await storeEntries();
    assert(before.includes('debug@4.3.4'));
    assert(before.includes('pedding@1.1.0'));

    await run(x, ['prune', '--dry-run']).expect('code', 0).expect('stdout', /would remove debug@4\.3\.4/).end();
    assert.deepEqual(await storeEntries(), before);

    await run(x, ['prune']).expect('code', 0).expect('stdout', /removed debug@4\.3\.4/).end();
    const after = await storeEntries();
    assert.deepEqual(after, ['debug@3.2.7', 'ms@2.1.3']);
    // 回退目录不留指向已删除版本的链接
    for (const name of await fs.readdir(path.join(store, 'node_modules'))) {
      await fs.stat(path.join(store, 'node_modules', name));
    }
    await run(helper.npminstall, []).expect('code', 0).end();
    assert.equal(require(path.join(tmp, 'node_modules/debug/package.json')).version, '3.2.7');
  });
});
