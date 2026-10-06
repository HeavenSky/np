'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs/promises');
const coffee = require('coffee');
const urllib = require('urllib');
const helper = require('./helper');

const x = path.join(__dirname, '..', 'bin', 'x.js');

describe('test/np-lock.test.js', () => {
  const [tmp, cleanup] = helper.tmp();
  const lockFile = path.join(tmp, 'np-lock.json');

  beforeEach(cleanup);
  afterEach(cleanup);

  async function writePkg(dependencies) {
    await fs.writeFile(
      path.join(tmp, 'package.json'),
      JSON.stringify({ name: 'root', version: '1.0.0', dependencies })
    );
  }
  const readLock = async () => JSON.parse(await fs.readFile(lockFile, 'utf8'));
  const run = (bin, args) => coffee.fork(bin, args, { cwd: tmp, env: { ...process.env, np_lockfile: '' } });
  const installedVersion = async name =>
    (await helper.readJSON(path.join(await fs.realpath(path.join(tmp, 'node_modules', name)), 'package.json'))).version;
  // 不用 require.resolve: 它缓存解析结果, 重装后仍返回旧版本目录
  async function msVersion() {
    const debugDir = await fs.realpath(path.join(tmp, 'node_modules/debug'));
    for (const dir of [path.join(debugDir, 'node_modules/ms'), path.join(debugDir, '../ms')]) {
      const pkg = await helper.readJSON(path.join(dir, 'package.json'));
      if (pkg.version) return pkg.version;
    }
  }
  // 把锁文件中 ms@^2.1.1 改成 2.1.1, 证明再次安装复用锁定的版本而不是范围内的最新版本
  async function pinMs() {
    const lock = await readLock();
    const res = await urllib.request('https://registry.npmmirror.com/ms/2.1.1', { dataType: 'json', timeout: 30000 });
    const { name, version, dist } = res.data;
    lock.packages['ms@^2.1.1'] = { name, version, dist };
    await fs.writeFile(lockFile, JSON.stringify(lock));
    await fs.rm(path.join(tmp, 'node_modules'), { recursive: true, force: true });
  }

  it('should write the lockfile and reuse locked versions', async () => {
    await writePkg({ debug: '4.1.0' });
    await run(helper.npminstall, [])
      .expect('code', 0)
      .expect('stdout', /npd np-lock\.json updated/)
      .end();
    const lock = await readLock();
    assert.equal(lock.lockfileVersion, 1);
    assert.deepEqual(Object.keys(lock.packages), ['debug@4.1.0', 'ms@^2.1.1']);
    assert.notEqual(await msVersion(), '2.1.1');

    await pinMs();
    await run(helper.npminstall, []).expect('code', 0).end();
    assert.equal(await msVersion(), '2.1.1');

    // update 不复用锁定版本, 并把新解析的版本写回锁文件
    await run(x, ['update']).expect('code', 0).end();
    assert.notEqual(await msVersion(), '2.1.1');
    assert.notEqual((await readLock()).packages['ms@^2.1.1'].version, '2.1.1');
  });

  it('should merge on partial install and prune on full install', async () => {
    await writePkg({ debug: '4.1.0' });
    await run(helper.npminstall, []).expect('code', 0).end();
    await run(helper.npminstall, ['pedding@1.1.0']).expect('code', 0).end();
    assert.deepEqual(Object.keys((await readLock()).packages), ['debug@4.1.0', 'ms@^2.1.1', 'pedding@1.1.0']);

    await writePkg({ pedding: '1.1.0' });
    await run(helper.npminstall, []).expect('code', 0).end();
    assert.deepEqual(Object.keys((await readLock()).packages), ['pedding@1.1.0']);
  });

  it('should fail with --frozen-lockfile when a dependency is not locked', async () => {
    await writePkg({ pedding: '1.1.0' });
    await run(helper.npminstall, ['--frozen-lockfile'])
      .expect('code', 1)
      .expect('stderr', /requires np-lock\.json/)
      .end();
    await run(helper.npminstall, []).expect('code', 0).end();
    const before = await fs.readFile(lockFile, 'utf8');

    await run(helper.npminstall, ['--frozen-lockfile']).expect('code', 0).end();
    await writePkg({ pedding: '1.1.0', 'utility-types': '3.10.0' });
    await run(helper.npminstall, ['--frozen-lockfile'])
      .expect('code', 1)
      .expect('stderr', /utility-types@3\.10\.0 is not in np-lock\.json/)
      .end();
    assert.equal(await fs.readFile(lockFile, 'utf8'), before);
  });

  it('should not create the lockfile with a foreign lockfile or --no-lockfile', async () => {
    await writePkg({ pedding: '1.1.0' });
    await fs.writeFile(path.join(tmp, 'package-lock.json'), '{}');
    await run(helper.npminstall, []).expect('code', 0).end();
    assert.equal(await installedVersion('pedding'), '1.1.0');
    await assert.rejects(fs.stat(lockFile), /ENOENT/);

    await fs.rm(path.join(tmp, 'package-lock.json'));
    await run(helper.npminstall, ['--no-lockfile']).expect('code', 0).end();
    await assert.rejects(fs.stat(lockFile), /ENOENT/);
  });
});
