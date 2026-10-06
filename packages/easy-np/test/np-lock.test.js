const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs/promises');
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
  async function pinMsTo211(lock) {
    const res = await urllib.request('https://registry.npmmirror.com/ms/2.1.1', { dataType: 'json', timeout: 30000 });
    const { name, version, dist } = res.data;
    lock.packages['ms@^2.1.1'] = { name, version, dist };
    await fs.writeFile(lockFile, JSON.stringify(lock));
    for (const dir of ['node_modules', 'packages/a/node_modules']) {
      await fs.rm(path.join(tmp, dir), { recursive: true, force: true });
    }
  }
  // 只改锁文件中 ms@^2.1.1 的版本, 保留 node_modules
  async function lockMsTo(version) {
    const lock = await readLock();
    const res = await urllib.request(`https://registry.npmmirror.com/ms/${version}`, {
      dataType: 'json',
      timeout: 30000,
    });
    const { name, dist } = res.data;
    lock.packages['ms@^2.1.1'] = { name, version, dist };
    await fs.writeFile(lockFile, JSON.stringify(lock));
  }
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
      .expect('stdout', /np-lock\.json updated/)
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
    const saved = (await helper.readJSON(path.join(tmp, 'package.json'))).dependencies.pedding;
    assert.deepEqual(Object.keys((await readLock()).packages), [
      'debug@4.1.0',
      'ms@^2.1.1',
      'pedding@1.1.0',
      `pedding@${saved}`,
    ]);

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

  it('should lock the subtree of packages installed without the lockfile', async () => {
    await writePkg({ debug: '4.1.0' });
    await run(helper.npminstall, ['--no-lockfile']).expect('code', 0).end();
    await assert.rejects(fs.stat(lockFile), /ENOENT/);
    await run(helper.npminstall, []).expect('code', 0).end();
    assert.deepEqual(Object.keys((await readLock()).packages), ['debug@4.1.0', 'ms@^2.1.1']);
  });

  it('should restore the lockfile after switching branches', async () => {
    await writePkg({ debug: '4.1.0' });
    await run(helper.npminstall, []).expect('code', 0).end();
    const lockA = await fs.readFile(lockFile, 'utf8');
    await writePkg({ debug: '4.3.4' });
    await run(helper.npminstall, []).expect('code', 0).end();
    assert.deepEqual(Object.keys((await readLock()).packages), ['debug@4.3.4', 'ms@2.1.2']);

    // 切回分支: package.json 与 np-lock.json 恢复, node_modules 仍是另一个分支装的版本
    await writePkg({ debug: '4.1.0' });
    await fs.writeFile(lockFile, lockA);
    await run(helper.npminstall, []).expect('code', 0).end();
    assert.equal(await fs.readFile(lockFile, 'utf8'), lockA);
    assert.equal(await installedVersion('debug'), '4.1.0');
  });

  it('should keep the same keys when installing again', async () => {
    await writePkg({ '@isaacs/cliui': '8.0.2' });
    await run(helper.npminstall, []).expect('code', 0).end();
    const keys = Object.keys((await readLock()).packages);
    assert(keys.includes('string-width@^4.2.0'), keys.join(', '));
    await run(helper.npminstall, []).expect('code', 0).end();
    assert.deepEqual(Object.keys((await readLock()).packages), keys);
  });

  it('should keep a root alias and the package of the same name', async () => {
    await writePkg({ 'lodash.has': '4.5.2', 'lodash-has-v3': 'npm:lodash.has@^3' });
    for (const args of [[], [], ['--no-lockfile']]) {
      await run(helper.npminstall, args).expect('code', 0).end();
      assert.equal(await installedVersion('lodash.has'), '4.5.2');
      assert.equal(await installedVersion('lodash-has-v3'), '3.2.1');
    }
    const keys = Object.keys((await readLock()).packages);
    assert(keys.includes('lodash.has@4.5.2') && keys.includes('lodash.has@^3'), keys.join(', '));
  });

  it('should lock packages installed by name under the saved spec', async () => {
    await writePkg({});
    await run(helper.npminstall, ['pedding', '--no-save']).expect('code', 0).end();
    assert.deepEqual(Object.keys((await readLock()).packages), []);

    await run(helper.npminstall, ['pedding']).expect('code', 0).end();
    const saved = (await helper.readJSON(path.join(tmp, 'package.json'))).dependencies.pedding;
    // 不写版本时按 engines 选版本, 旧版 Node.js 上不是 latest
    const version = await installedVersion('pedding');
    assert.match(saved, /^[\^~]?\d+\.\d+\.\d+$/);
    assert(saved.endsWith(version), saved);
    const lock = await readLock();
    assert.deepEqual(Object.keys(lock.packages), [`pedding@${saved}`]);
    assert.equal(lock.packages[`pedding@${saved}`].version, version);
    await run(helper.npminstall, ['--frozen-lockfile']).expect('code', 0).end();
    await run(helper.npminstall, ['pedding', '--frozen-lockfile'])
      .expect('code', 1)
      .expect('stderr', /can not be used with package names/)
      .end();

    // 锁文件中 pedding@latest 指向旧版本时, 命令行写的 tag 仍取最新版本
    await writePkg({ pedding: '1.1.0' });
    await run(helper.npminstall, []).expect('code', 0).end();
    const stale = await readLock();
    stale.packages['pedding@latest'] = stale.packages['pedding@1.1.0'];
    await fs.writeFile(lockFile, JSON.stringify(stale));
    await run(helper.npminstall, ['pedding@latest']).expect('code', 0).end();
    assert.equal(await installedVersion('pedding'), '2.0.1');
    assert.equal((await readLock()).packages['pedding@latest'].version, '2.0.1');
  });

  it('should keep the original peerDependencies in the lockfile', async () => {
    await writePkg({ react: '18.3.1', 'use-sync-external-store': '1.2.0' });
    for (let i = 0; i < 2; i++) {
      await run(helper.npminstall, []).expect('code', 0).end();
      assert.deepEqual((await readLock()).packages['use-sync-external-store@1.2.0'].peerDependencies, {
        react: '^16.8.0 || ^17.0.0 || ^18.0.0',
      });
    }
  });

  it('should switch to the locked version without removing node_modules', async () => {
    await writePkg({ debug: '4.1.0' });
    await run(helper.npminstall, []).expect('code', 0).end();
    assert.notEqual(await msVersion(), '2.1.1');

    await lockMsTo('2.1.1');
    await run(helper.npminstall, []).expect('code', 0).end();
    assert.equal(await msVersion(), '2.1.1');

    await lockMsTo('2.1.2');
    await run(helper.npminstall, ['--frozen-lockfile']).expect('code', 0).end();
    assert.equal(await msVersion(), '2.1.2');
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

  if (process.platform !== 'win32') {
    it('should lock the git commit and reuse it after the branch moves', async () => {
      const { execFileSync } = require('child_process');
      const repo = path.join(tmp, 'repo');
      await fs.mkdir(repo, { recursive: true });
      const git = args => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
      const commit = async version => {
        await fs.writeFile(path.join(repo, 'package.json'), JSON.stringify({ name: 'git-lock-demo', version }));
        git(['add', '-A']);
        git(['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', version]);
      };
      git(['init', '-q']);
      await commit('1.0.0');
      await writePkg({ 'git-lock-demo': `git+file://${repo}` });
      await run(helper.npminstall, []).expect('code', 0).end();
      const key = `git-lock-demo@git+file://${repo}`;
      const locked = (await readLock()).packages[key];
      assert.match(locked._resolved, /#[a-f0-9]{40}$/);
      assert.equal(locked.version, '1.0.0');

      await commit('2.0.0');
      await fs.rm(path.join(tmp, 'node_modules'), { recursive: true, force: true });
      await run(helper.npminstall, ['--frozen-lockfile']).expect('code', 0).end();
      assert.equal(await installedVersion('git-lock-demo'), '1.0.0');
      // 已装的就是锁定的 commit, 再次安装不重新克隆
      await run(helper.npminstall, []).expect('code', 0).notExpect('stderr', /install git-lock-demo from git/).end();
    });
  }

  it('should record and verify the integrity of tarball url dependencies', async () => {
    const url = 'https://registry.npmmirror.com/pedding/-/pedding-1.1.0.tgz';
    await writePkg({ pedding: url });
    await run(helper.npminstall, []).expect('code', 0).end();
    const lock = await readLock();
    assert.match(lock.packages[`pedding@${url}`].dist.integrity, /^sha512-/);

    lock.packages[`pedding@${url}`].dist.integrity = 'sha512-tampered';
    await fs.writeFile(lockFile, JSON.stringify(lock));
    await fs.rm(path.join(tmp, 'node_modules'), { recursive: true, force: true });
    await run(helper.npminstall, []).expect('code', 1).expect('stderr', /integrity mismatch/).end();
  });

  it('should lock dependencies of every workspace', async () => {
    await fs.mkdir(path.join(tmp, 'packages/a'), { recursive: true });
    await fs.writeFile(
      path.join(tmp, 'package.json'),
      JSON.stringify({ name: 'root', version: '1.0.0', workspaces: ['packages/*'], dependencies: { pedding: '1.1.0' } })
    );
    await fs.writeFile(
      path.join(tmp, 'packages/a/package.json'),
      JSON.stringify({ name: 'a', version: '1.0.0', dependencies: { ms: '^2.1.1' } })
    );
    await run(helper.npminstall, []).expect('code', 0).end();
    const lock = await readLock();
    assert(lock.packages['pedding@1.1.0']);
    assert(lock.packages['ms@^2.1.1']);

    await pinMsTo211(lock);
    await run(helper.npminstall, ['--frozen-lockfile']).expect('code', 0).end();
    const msDir = await fs.realpath(path.join(tmp, 'packages/a/node_modules/ms'));
    assert.equal((await helper.readJSON(path.join(msDir, 'package.json'))).version, '2.1.1');
  });
});
