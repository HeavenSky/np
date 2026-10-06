const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs/promises');
const coffee = require('coffee');
const helper = require('./helper');

describe('test/prune.test.js', () => {
  const [tmp, cleanup] = helper.tmp();
  const store = path.join(tmp, 'node_modules');
  const x = path.join(__dirname, '..', 'bin', 'x.js');
  const writePkg = dependencies =>
    fs.writeFile(path.join(tmp, 'package.json'), JSON.stringify({ name: 'root', version: '1.0.0', dependencies }));
  const run = (bin, args) => coffee.fork(bin, args, { cwd: tmp, env: { ...process.env, np_lockfile: 'false' } });
  const storeEntries = async () => (await fs.readdir(store)).filter(name => name.startsWith('_')).sort();

  beforeEach(cleanup);
  afterEach(cleanup);

  it('should remove versions left by upgrades only when asked', async () => {
    await writePkg({ debug: '4.3.4', pedding: '1.1.0' });
    await run(helper.npminstall, []).expect('code', 0).end();
    await writePkg({ debug: '3.2.7' });
    await run(helper.npminstall, []).expect('code', 0).end();
    await run(x, ['uninstall', 'pedding']).expect('code', 0).end();
    // 重装不删除旧版本; npd-x uninstall 自己会删除被卸载的版本目录
    const before = await storeEntries();
    assert(before.includes('_debug@4.3.4@debug'));

    await run(x, ['prune', '--dry-run']).expect('code', 0).expect('stdout', /would remove _debug@4\.3\.4@debug/).end();
    assert.deepEqual(await storeEntries(), before);

    await run(x, ['prune']).expect('code', 0).expect('stdout', /removed _debug@4\.3\.4@debug/).end();
    const after = await storeEntries();
    assert.deepEqual(after, ['_debug@3.2.7@debug', '_ms@2.1.3@ms']);
    await run(helper.npminstall, []).expect('code', 0).end();
    assert.equal(require(path.join(tmp, 'node_modules/debug/package.json')).version, '3.2.7');
  });
});
