'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs/promises');
const coffee = require('coffee');
const urllib = require('urllib');
const helper = require('../support/helper');

const x = path.join(__dirname, '../..', 'bin', 'x.js');

describe('test/lockfile/np-lock.test.js', () => {
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
  async function lockManifest(key, spec) {
    const lock = await readLock();
    const res = await urllib.request(`https://registry.npmmirror.com/${spec}`, { dataType: 'json', timeout: 30000 });
    const { name, version, dist } = res.data;
    lock.packages[key] = { name, version, dist };
    await fs.writeFile(lockFile, JSON.stringify(lock));
  }
  // 把锁文件中 ms@^2.1.1 改成 2.1.1, 证明再次安装复用锁定的版本而不是范围内的最新版本
  async function pinMs() {
    await lockManifest('ms@^2.1.1', 'ms/2.1.1');
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
    // 命令行装的包另按保存进 package.json 的声明(^1.1.0)记录, 命令行的非浮动键保留到下次完整安装
    assert.deepEqual(Object.keys((await readLock()).packages), [
      'debug@4.1.0',
      'ms@^2.1.1',
      'pedding@1.1.0',
      'pedding@^1.1.0',
    ]);

    await writePkg({ pedding: '1.1.0' });
    await run(helper.npminstall, []).expect('code', 0).end();
    assert.deepEqual(Object.keys((await readLock()).packages), ['pedding@1.1.0']);
  });

  it('should lock the subtree of packages installed without the lockfile', async () => {
    await writePkg({ debug: '4.1.0' });
    await run(helper.npminstall, ['--no-lockfile']).expect('code', 0).end();
    await run(helper.npminstall, []).expect('code', 0).end();
    assert.deepEqual(Object.keys((await readLock()).packages), ['debug@4.1.0', 'ms@^2.1.1']);
  });

  it('should restore the lockfile after switching branches', async () => {
    await writePkg({ debug: '4.1.0' });
    await run(helper.npminstall, []).expect('code', 0).end();
    const lockA = await fs.readFile(lockFile, 'utf8');
    await writePkg({ debug: '4.3.4' });
    await run(helper.npminstall, []).expect('code', 0).end();
    const lockB = await fs.readFile(lockFile, 'utf8');
    assert.deepEqual(Object.keys(JSON.parse(lockB).packages), ['debug@4.3.4', 'ms@2.1.2']);

    // 切换分支只换 package.json 与锁文件, node_modules 与 store 里两个版本都已装好
    await writePkg({ debug: '4.1.0' });
    await fs.writeFile(lockFile, lockA);
    await run(helper.npminstall, []).expect('code', 0).end();
    assert.equal(await installedVersion('debug'), '4.1.0');
    assert.equal(await fs.readFile(lockFile, 'utf8'), lockA);

    await writePkg({ debug: '4.3.4' });
    await fs.writeFile(lockFile, lockB);
    await run(helper.npminstall, ['--frozen-lockfile']).expect('code', 0).end();
    assert.equal(await installedVersion('debug'), '4.3.4');
    await run(helper.npminstall, []).expect('code', 0).end();
    assert.equal(await fs.readFile(lockFile, 'utf8'), lockB);
  });

  it('should record the same keys when everything is installed', async () => {
    await writePkg({ '@isaacs/cliui': '8.0.2' });
    await run(helper.npminstall, []).expect('code', 0).end();
    const keys = Object.keys((await readLock()).packages);
    assert(keys.includes('string-width@^4.2.0'), keys.join(', '));
    await run(helper.npminstall, []).expect('code', 0).end();
    assert.deepEqual(Object.keys((await readLock()).packages), keys);
  });

  it('should keep a root alias next to the aliased package', async () => {
    await writePkg({ 'lodash-has-v3': 'npm:lodash.has@^3', 'lodash.has': '4.5.2' });
    const keys = [];
    for (let i = 0; i < 2; i++) {
      await run(helper.npminstall, []).expect('code', 0).end();
      assert.equal(await installedVersion('lodash.has'), '4.5.2');
      assert.equal(await installedVersion('lodash-has-v3'), '3.2.1');
      keys.push(Object.keys((await readLock()).packages));
    }
    assert(keys[0].includes('lodash.has@4.5.2') && keys[0].includes('lodash.has@^3'), keys[0].join(', '));
    assert.deepEqual(keys[1], keys[0]);
  });

  it('should lock packages installed by name under the saved spec', async () => {
    await writePkg({});
    await run(helper.npminstall, ['pedding']).expect('code', 0).end();
    // 不写版本时按 engines 选版本, Node 18.19 以下装 1.1.0
    const version = await installedVersion('pedding');
    const pkg = await helper.readJSON(path.join(tmp, 'package.json'));
    assert.deepEqual(pkg.dependencies, { pedding: `^${version}` });
    assert.deepEqual(Object.keys((await readLock()).packages), [`pedding@^${version}`]);
    await run(helper.npminstall, ['--frozen-lockfile']).expect('code', 0).end();
    await run(helper.npminstall, ['pedding', '--frozen-lockfile'])
      .expect('code', 1)
      .expect('stderr', /--frozen-lockfile can not be used with package arguments/)
      .end();

    // 命令行显式写的 tag 不复用锁文件里的同名键
    await lockManifest('pedding@latest', 'pedding/1.1.0');
    await run(helper.npminstall, ['pedding@latest']).expect('code', 0).end();
    assert.equal(await installedVersion('pedding'), '2.0.1');
    assert.equal((await readLock()).packages['pedding@latest'].version, '2.0.1');

    await run(helper.npminstall, ['pedding@*', '--no-save']).expect('code', 0).end();
    assert(!('pedding@*' in (await readLock()).packages));
  });

  it('should lock aliases installed by name under the saved spec', async () => {
    await writePkg({});
    await run(helper.npminstall, ['x@npm:pedding@^1']).expect('code', 0).end();
    assert.deepEqual(Object.keys((await readLock()).packages), ['pedding@^1']);

    // 不带版本的 alias 与显式 tag 一样不复用锁文件, 安装后按保存的声明(npm:pedding)记录
    await lockManifest('pedding@latest', 'pedding/1.1.0');
    await run(helper.npminstall, ['y@npm:pedding']).expect('code', 0).end();
    assert.equal(await installedVersion('y'), '2.0.1');
    const pkg = await helper.readJSON(path.join(tmp, 'package.json'));
    assert.deepEqual(pkg.dependencies, { x: 'npm:pedding@^1', y: 'npm:pedding' });
    const lock = await readLock();
    assert.deepEqual(Object.keys(lock.packages), ['pedding@^1', 'pedding@latest']);
    assert.equal(lock.packages['pedding@latest'].version, '2.0.1');
    await run(helper.npminstall, ['--frozen-lockfile']).expect('code', 0).end();
    await run(helper.npminstall, []).expect('code', 0).end();
    assert.deepEqual(await readLock(), lock);
  });

  it('should keep entries of other workspace packages in a workspace root', async () => {
    await fs.writeFile(
      path.join(tmp, 'package.json'),
      JSON.stringify({ name: 'root', version: '1.0.0', workspaces: ['packages/*'], dependencies: { pedding: '1.1.0' } })
    );
    await fs.writeFile(lockFile, JSON.stringify({ lockfileVersion: 1, packages: {} }));
    await lockManifest('debug@4.1.0', 'debug/4.1.0');
    await run(helper.npminstall, [])
      .expect('code', 0)
      .expect('stderr', /workspaces are not supported/)
      .end();
    assert.deepEqual(Object.keys((await readLock()).packages), ['debug@4.1.0', 'pedding@1.1.0']);
  });

  it('should not write credentials in urls to the lockfile', async () => {
    const npLock = require('../../lib/np_lock');
    const sha = 'a'.repeat(40);
    const url = 'git+https://user:tok@github.com/a/b.git';
    await npLock.write(tmp, {
      [`b@${url}`]: { name: 'b', version: '1.0.0', _resolved: `${url}#${sha}`, _from: `b@${url}` },
      'c@https://tok@r.com/c.tgz': { name: 'c', version: '1.0.0', dist: { tarball: 'https://tok@r.com/c.tgz' } },
    });
    const text = await fs.readFile(lockFile, 'utf8');
    assert(!text.includes('tok'), text);
    const packages = await npLock.read(tmp);
    assert.equal(npLock.lookup(packages, `b@${url}`)._resolved, `git+https://github.com/a/b.git#${sha}`);
    assert.equal(npLock.lookup(packages, 'c@https://tok@r.com/c.tgz').dist.tarball, 'https://r.com/c.tgz');
  });

  it('should keep the original peerDependencies in the lockfile', async () => {
    await writePkg({ 'use-sync-external-store': '1.2.0', react: '18.3.1' });
    for (let i = 0; i < 2; i++) {
      await run(helper.npminstall, []).expect('code', 0).end();
      const locked = (await readLock()).packages['use-sync-external-store@1.2.0'];
      assert.deepEqual(locked.peerDependencies, { react: '^16.8.0 || ^17.0.0 || ^18.0.0' });
    }
  });

  it('should switch to the locked version without removing node_modules', async () => {
    await writePkg({ debug: '4.1.0' });
    await run(helper.npminstall, []).expect('code', 0).end();
    await lockManifest('ms@^2.1.1', 'ms/2.1.1');
    await run(helper.npminstall, []).expect('code', 0).end();
    assert.equal(await msVersion(), '2.1.1');

    await lockManifest('ms@^2.1.1', 'ms/2.1.2');
    await run(helper.npminstall, ['--frozen-lockfile']).expect('code', 0).end();
    assert.equal(await msVersion(), '2.1.2');
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

    await fs.writeFile(
      path.join(tmp, 'package.json'),
      JSON.stringify({
        name: 'root',
        version: '1.0.0',
        dependencies: { pedding: '1.1.0' },
        config: { np: { lockfile: false } },
      })
    );
    await run(helper.npminstall, []).expect('code', 0).end();
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
      await run(helper.npminstall, [])
        .expect('code', 0)
        .notExpect('stderr', /install git-lock-demo from git/)
        .end();
    });

    it('should install the new commit of a git dependency that keeps its version', async () => {
      const { execFileSync } = require('child_process');
      const repo = path.join(tmp, 'repo');
      await fs.mkdir(repo, { recursive: true });
      const git = args => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
      const commit = async content => {
        await fs.writeFile(
          path.join(repo, 'package.json'),
          JSON.stringify({ name: 'git-same-version', version: '1.0.0' })
        );
        await fs.writeFile(path.join(repo, 'index.js'), content);
        git(['add', '-A']);
        git(['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', content]);
      };
      const installed = () => fs.readFile(path.join(tmp, 'node_modules/git-same-version/index.js'), 'utf8');
      git(['init', '-q']);
      await commit('first');
      await writePkg({ 'git-same-version': `git+file://${repo}` });
      await run(helper.npminstall, []).expect('code', 0).end();
      assert.equal(await installed(), 'first');

      await commit('second');
      await fs.rm(lockFile);
      await run(helper.npminstall, []).expect('code', 0).end();
      assert.equal(await installed(), 'second');
      const dirs = (await fs.readdir(path.join(tmp, 'node_modules'))).filter(dir =>
        dir.startsWith('_git-same-version@')
      );
      assert.equal(dirs.length, 2, dirs.join(', '));
      assert(
        dirs.every(dir => /^_git-same-version@1\.0\.0\+git\.[0-9a-f]{8}@git-same-version$/.test(dir)),
        dirs.join(', ')
      );
    });

    it('should not let a git dependency take the directory of a registry package', async () => {
      const { execFileSync } = require('child_process');
      const repo = path.join(tmp, 'repo');
      await fs.mkdir(repo, { recursive: true });
      // 自称 registry 上的 ms@2.1.3
      await fs.writeFile(path.join(repo, 'package.json'), JSON.stringify({ name: 'ms', version: '2.1.3' }));
      await fs.writeFile(path.join(repo, 'index.js'), "module.exports = 'fake';\n");
      const git = args => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
      git(['init', '-q']);
      git(['add', '-A']);
      git(['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', 'fake']);
      await writePkg({});
      await run(helper.npminstall, [`git+file://${repo}`])
        .expect('code', 0)
        .end();
      await run(helper.npminstall, ['ms@2.1.3']).expect('code', 0).end();
      const registryDir = path.join(tmp, 'node_modules/_ms@2.1.3@ms');
      assert.equal(await fs.realpath(path.join(tmp, 'node_modules/ms')), await fs.realpath(registryDir));
      assert(!(await fs.readFile(path.join(registryDir, 'index.js'), 'utf8')).includes('fake'));
    });
  }

  it('should lock tarball url dependencies without their credentials', async () => {
    const registry = helper.createRegistry('local', []);
    await new Promise(resolve => registry.server.listen(0, '127.0.0.1', resolve));
    try {
      const port = registry.server.address().port;
      registry.packages['url-demo'] = {
        '1.0.0': await helper.packTarball(tmp, { name: 'url-demo', version: '1.0.0' }),
      };
      const url = `http://user:tok@127.0.0.1:${port}/url-demo/-/url-demo-1.0.0.tgz`;
      await writePkg({ 'url-demo': url });
      await run(helper.npminstall, []).expect('code', 0).end();
      const text = await fs.readFile(lockFile, 'utf8');
      assert(!text.includes('tok'), text);
      assert.match(
        await fs.realpath(path.join(tmp, 'node_modules/url-demo')),
        /_url-demo@1\.0\.0\+url\.[0-9a-f]{8}@url-demo$/
      );

      // 已装的就是锁定的内容, 不重新下载; 删掉 node_modules 后按声明里的地址与凭据下载并校验锁定的 integrity
      await run(helper.npminstall, [])
        .expect('code', 0)
        .notExpect('stderr', /install url-demo from remote/)
        .end();
      await fs.rm(path.join(tmp, 'node_modules'), { recursive: true, force: true });
      await run(helper.npminstall, ['--frozen-lockfile']).expect('code', 0).end();
      assert.equal(await installedVersion('url-demo'), '1.0.0');
      assert.equal(await fs.readFile(lockFile, 'utf8'), text);
    } finally {
      registry.server.close();
    }
  });

  it('should record and verify the integrity of tarball url dependencies', async () => {
    const url = 'https://registry.npmmirror.com/pedding/-/pedding-1.1.0.tgz';
    await writePkg({ pedding: url });
    await run(helper.npminstall, []).expect('code', 0).end();
    const lock = await readLock();
    assert.match(lock.packages[`pedding@${url}`].dist.integrity, /^sha512-/);

    lock.packages[`pedding@${url}`].dist.integrity = 'sha512-tampered';
    await fs.writeFile(lockFile, JSON.stringify(lock));
    await fs.rm(path.join(tmp, 'node_modules'), { recursive: true, force: true });
    await run(helper.npminstall, [])
      .expect('code', 1)
      .expect('stderr', /integrity mismatch/)
      .end();
  });
});
