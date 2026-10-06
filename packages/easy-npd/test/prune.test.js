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
  const stateKeys = async () =>
    Object.keys(JSON.parse(await fs.readFile(path.join(store, '.npd-state.json'), 'utf8')).packages);
  const link = `${tmp}-link`;
  const moved = `${tmp}-moved`;
  const cleanupLinks = async () => {
    await fs.rm(link, { force: true, recursive: true });
    await fs.rm(moved, { force: true, recursive: true });
  };

  beforeEach(async () => {
    await cleanupLinks();
    await cleanup();
  });
  afterEach(async () => {
    await cleanupLinks();
    await cleanup();
  });

  it('should remove versions left by upgrades only when asked', async () => {
    await writePkg({ debug: '4.3.4', pedding: '1.1.0' });
    await run(helper.npminstall, []).expect('code', 0).end();
    await writePkg({ debug: '3.2.7' });
    await run(helper.npminstall, []).expect('code', 0).end();
    await run(x, ['uninstall', 'pedding']).expect('code', 0).end();
    // 重装不删除旧版本; npd-x uninstall 自己会删除被卸载的版本目录
    const before = await storeEntries();
    assert(before.includes('_debug@4.3.4@debug'));
    assert((await stateKeys()).includes('_debug@4.3.4@debug'));
    assert(!(await stateKeys()).some(key => key.startsWith('_pedding@')));

    await run(x, ['prune', '--dry-run'])
      .expect('code', 0)
      .expect('stdout', /would remove _debug@4\.3\.4@debug/)
      .end();
    assert.deepEqual(await storeEntries(), before);

    await run(x, ['prune'])
      .expect('code', 0)
      .expect('stdout', /removed _debug@4\.3\.4@debug/)
      .end();
    const after = await storeEntries();
    assert.deepEqual(after, ['_debug@3.2.7@debug', '_ms@2.1.3@ms']);
    assert.deepEqual((await stateKeys()).sort(), after);
    await run(helper.npminstall, []).expect('code', 0).end();
    assert.equal(require(path.join(tmp, 'node_modules/debug/package.json')).version, '3.2.7');
  });

  it('should resolve symlinked --root and node_modules before comparing link targets', async () => {
    await writePkg({ debug: '4.3.4' });
    await run(helper.npminstall, []).expect('code', 0).end();
    const before = await storeEntries();
    assert(before.length > 0);

    await fs.symlink(tmp, link, 'junction');
    await run(x, ['prune', '--dry-run', `--root=${link}`])
      .expect('code', 0)
      .expect('stdout', /Found 0 unreferenced/)
      .end();

    if (process.platform === 'win32') return;
    await fs.rename(store, moved);
    await fs.symlink(moved, store);
    await run(x, ['prune'])
      .expect('code', 0)
      .expect('stdout', /Removed 0 unreferenced/)
      .end();
    assert.deepEqual(await storeEntries(), before);
  });
});
