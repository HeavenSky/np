'use strict';

const assert = require('assert');
const fs = require('fs/promises');
const path = require('path');
const utils = require('../../lib/utils');
const helper = require('../support/helper');

describe('test/unit/utils.test.js', () => {
  describe('matchPlatform()', () => {
    it('should match os names', () => {
      assert(utils.matchPlatform('darwin', []));
      assert(utils.matchPlatform('darwin', ['darwin']));
      assert(utils.matchPlatform('darwin', ['linux', 'darwin']));
      assert(utils.matchPlatform('darwin', ['linux', 'win32', 'darwin']));
      assert(utils.matchPlatform('win32', ['win32']));
      assert(utils.matchPlatform('linux', ['linux']));
      assert(utils.matchPlatform('darwin', ['!win32']));
      assert(utils.matchPlatform('darwin', ['!linux']));
      assert(utils.matchPlatform('darwin', ['!linux', 'darwin']));
      assert(utils.matchPlatform('darwin', ['darwin', '!darwin']));
    });

    it('should match cpu names', () => {
      assert(utils.matchPlatform('x64', []));
      assert(utils.matchPlatform('x64', ['x64']));
      assert(utils.matchPlatform('x64', ['x64', 'ia32']));
      assert(utils.matchPlatform('x64', ['x64', 'ia32', 'arm']));
      assert(utils.matchPlatform('ia32', ['ia32']));
      assert(utils.matchPlatform('mips', ['mips']));
      assert(utils.matchPlatform('x64', ['!mips']));
      assert(utils.matchPlatform('x64', ['!ia32']));
      assert(utils.matchPlatform('x64', ['!ia32', 'x64']));
      assert(utils.matchPlatform('x64', ['x64', '!x64']));
    });

    it('should match libc names', () => {
      assert(utils.matchPlatform('glibc', []));
      assert(utils.matchPlatform('musl', []));
      assert(utils.matchPlatform(null, []));
      assert(utils.matchPlatform('glibc', ['glibc']));
      assert(utils.matchPlatform('glibc', ['glibc', 'musl']));
      assert(utils.matchPlatform('musl', ['glibc', 'musl']));
      assert(utils.matchPlatform('musl', ['musl']));
      assert(utils.matchPlatform('glibc', ['!musl']));
      assert(utils.matchPlatform('musl', ['!glibc']));
      assert(utils.matchPlatform('glibc', ['!musl', 'glibc']));
      assert(utils.matchPlatform('glibc', ['glibc', '!glibc']));
    });

    it('should not match os names', () => {
      assert(!utils.matchPlatform('darwin', ['linux']));
      assert(!utils.matchPlatform('darwin', ['win32']));
      assert(!utils.matchPlatform('darwin', ['linux', 'win32']));
      assert(!utils.matchPlatform('win32', ['darwin']));
      assert(!utils.matchPlatform('linux', ['darwin']));
      assert(!utils.matchPlatform('linux', ['!linux']));
      assert(!utils.matchPlatform('darwin', ['!darwin']));
      assert(!utils.matchPlatform('darwin', ['!linux', '!darwin']));
      assert(!utils.matchPlatform('win32', ['!win32']));
      assert(!utils.matchPlatform('win32', ['!win32', 'win32']));
    });

    it('should not match cpu names', () => {
      assert(!utils.matchPlatform('x64', ['ia32']));
      assert(!utils.matchPlatform('ia32', ['x64']));
      assert(!utils.matchPlatform('ia32', ['mips', 'arm']));
      assert(!utils.matchPlatform('arm', ['!arm']));
      assert(!utils.matchPlatform('mips', ['!mips']));
      assert(!utils.matchPlatform('mips', ['!x64', '!mips']));
      assert(!utils.matchPlatform('x64', ['!x64']));
    });

    it('should not match libc names', () => {
      assert(!utils.matchPlatform(null, ['musl']));
      assert(!utils.matchPlatform(null, ['glibc']));
      assert(!utils.matchPlatform('glibc', ['musl']));
      assert(!utils.matchPlatform('musl', ['glibc']));
      assert(!utils.matchPlatform('glibc', ['!glibc']));
      assert(!utils.matchPlatform('musl', ['!musl']));
    });
  });

  describe('findMaxSatisfyingVersion()', () => {
    it('should use vaild version itself', () => {
      assert(
        utils.findMaxSatisfyingVersion(
          '1.0.2',
          {
            latest: '2.0.0',
          },
          ['1.0.1', '1.0.2', '1.0.3', '2.0.0']
        ) === '1.0.2'
      );
    });

    it('should return undefined when no version match', () => {
      assert(
        utils.findMaxSatisfyingVersion(
          '>= 2.0.1 < 3.0.0',
          {
            latest: '2.0.0',
          },
          ['1.0.1', '1.0.2', '1.0.3', '2.0.0']
        ) === null
      );
    });

    it('should use max range version', () => {
      assert(
        utils.findMaxSatisfyingVersion(
          '>= 1.0.1 < 2.0.0',
          {
            latest: '2.0.0',
          },
          ['1.0.1', '1.0.2', '1.0.3', '2.0.0']
        ) === '1.0.3'
      );
    });

    it('should return latest version', () => {
      assert(
        utils.findMaxSatisfyingVersion(
          'latest',
          {
            latest: '2.0.0',
            'latest-1': '1.0.2',
          },
          ['1.0.1', '1.0.2', '1.0.3', '2.0.0']
        ) === '2.0.0'
      );
    });

    it('should support latest version first', () => {
      assert(
        utils.findMaxSatisfyingVersion(
          '>= 1.0.1 < 2.0.0',
          {
            latest: '1.0.1',
            'latest-1': '1.0.2',
          },
          ['1.0.1', '1.0.2', '1.0.3', '2.0.0']
        ) === '1.0.1'
      );
    });

    it('should support latest-{major} version', () => {
      assert(
        utils.findMaxSatisfyingVersion(
          '>= 1.0.1 < 2.0.0',
          {
            latest: '2.0.0',
            'latest-1': '1.0.2',
          },
          ['1.0.1', '1.0.2', '1.0.3', '2.0.0']
        ) === '1.0.2'
      );
    });

    describe('engines.node', () => {
      const distTags = { latest: '12.0.0' };
      const allVersions = ['10.8.0', '10.9.0', '11.0.0', '12.0.0'];
      const versions = {
        '10.8.0': { engines: { node: '^18.17.0 || >=20.5.0' } },
        '10.9.0': { engines: { node: '^18.17.0 || >=20.5.0' } },
        '11.0.0': { engines: { node: '^20.17.0 || >=22.9.0' } },
        '12.0.0': { engines: { node: '^22.14.0 || >=24.0.0' } },
      };
      const options = { versions, nodeVersion: 'v18.20.0' };

      it('should pick the highest compatible version when no version is specified', () => {
        assert.equal(
          utils.findMaxSatisfyingVersion('latest', distTags, allVersions, { ...options, implicitTag: true }),
          '10.9.0'
        );
      });

      it('should keep the explicit tag', () => {
        assert.equal(utils.findMaxSatisfyingVersion('latest', distTags, allVersions, options), '12.0.0');
      });

      it('should keep the exact version', () => {
        assert.equal(utils.findMaxSatisfyingVersion('12.0.0', distTags, allVersions, options), '12.0.0');
      });

      it('should pick the highest compatible version in range', () => {
        assert.equal(utils.findMaxSatisfyingVersion('>=10', distTags, allVersions, options), '10.9.0');
      });

      it('should skip incompatible latest-{major} version', () => {
        assert.equal(
          utils.findMaxSatisfyingVersion('^10.0.0', { ...distTags, 'latest-10': '10.9.0' }, allVersions, {
            ...options,
            versions: { ...versions, '10.9.0': { engines: { node: '>=20' } } },
          }),
          '10.8.0'
        );
      });

      it('should fallback to the original version when none is compatible', () => {
        assert.equal(utils.findMaxSatisfyingVersion('>=11', distTags, allVersions, options), '12.0.0');
        assert.equal(
          utils.findMaxSatisfyingVersion('latest', distTags, allVersions, {
            ...options,
            nodeVersion: 'v16.0.0',
            implicitTag: true,
          }),
          '12.0.0'
        );
      });
    });

    describe('deprecated', () => {
      const distTags = { latest: '2.1.0' };
      const allVersions = ['1.0.0', '2.0.0', '2.0.1', '2.1.0'];
      const versions = {
        '1.0.0': {},
        '2.0.0': {},
        '2.0.1': { engines: { node: '>=20' } },
        '2.1.0': { deprecated: 'broken release' },
      };
      const options = { versions, nodeVersion: 'v18.20.0' };

      it('should avoid deprecated latest when no version is specified', () => {
        assert.equal(
          utils.findMaxSatisfyingVersion('latest', distTags, allVersions, { ...options, implicitTag: true }),
          '2.0.0'
        );
      });

      it('should prefer a non-deprecated version with incompatible engines over a deprecated one', () => {
        assert.equal(
          utils.findMaxSatisfyingVersion('^2.0.0', distTags, allVersions, {
            ...options,
            versions: { ...versions, '2.0.0': { deprecated: 'x' } },
          }),
          '2.0.1'
        );
      });

      it('should avoid deprecated version in range', () => {
        assert.equal(utils.findMaxSatisfyingVersion('^2.0.0', distTags, allVersions, options), '2.0.0');
      });

      it('should keep the explicit tag and exact version', () => {
        assert.equal(utils.findMaxSatisfyingVersion('latest', distTags, allVersions, options), '2.1.0');
        assert.equal(utils.findMaxSatisfyingVersion('2.1.0', distTags, allVersions, options), '2.1.0');
      });

      it('should fallback to deprecated version when the range has nothing else', () => {
        assert.equal(utils.findMaxSatisfyingVersion('~2.1.0', distTags, allVersions, options), '2.1.0');
      });
    });
  });

  describe('parseTarballUrls()', () => {
    it('should return one url', () => {
      assert.deepEqual(utils.parseTarballUrls('https://registry.npmjs.org/node/-/node-10.3.0.tgz'), [
        'https://registry.npmjs.org/node/-/node-10.3.0.tgz',
      ]);
      assert.deepEqual(utils.parseTarballUrls('https://registry.npmjs.org/node/-/node-10.3.0.tgz?other_urls='), [
        'https://registry.npmjs.org/node/-/node-10.3.0.tgz?other_urls=',
      ]);
    });

    it('should return multi urls', () => {
      assert.deepEqual(
        utils.parseTarballUrls(
          'http://foo-us1.oss.com/@cnpmtest/download-test-module/-/@cnpmtest/download-test-module-1.0.0.tgz?other_urls=http%3A%2F%2Fdefault.oss.com%2F%40cnpmtest%2Fdownload-test-module%2F-%2F%40cnpmtest%2Fdownload-test-module-1.0.0.tgz%2Chttp%3A%2F%2Fbackup.oss.com%2F%40cnpmtest%2Fdownload-test-module%2F-%2F%40cnpmtest%2Fdownload-test-module-1.0.0.tgz'
        ),
        [
          'http://foo-us1.oss.com/@cnpmtest/download-test-module/-/@cnpmtest/download-test-module-1.0.0.tgz?other_urls=http%3A%2F%2Fdefault.oss.com%2F%40cnpmtest%2Fdownload-test-module%2F-%2F%40cnpmtest%2Fdownload-test-module-1.0.0.tgz%2Chttp%3A%2F%2Fbackup.oss.com%2F%40cnpmtest%2Fdownload-test-module%2F-%2F%40cnpmtest%2Fdownload-test-module-1.0.0.tgz',
          'http://default.oss.com/@cnpmtest/download-test-module/-/@cnpmtest/download-test-module-1.0.0.tgz',
          'http://backup.oss.com/@cnpmtest/download-test-module/-/@cnpmtest/download-test-module-1.0.0.tgz',
        ]
      );

      assert.deepEqual(
        utils.parseTarballUrls(
          'http://foo-us1.oss.com/@cnpmtest/download-test-module/-/@cnpmtest/download-test-module-1.0.0.tgz?foo=bar&other_urls=http%3A%2F%2Fdefault.oss.com%2F%40cnpmtest%2Fdownload-test-module%2F-%2F%40cnpmtest%2Fdownload-test-module-1.0.0.tgz%2Chttp%3A%2F%2Fbackup.oss.com%2F%40cnpmtest%2Fdownload-test-module%2F-%2F%40cnpmtest%2Fdownload-test-module-1.0.0.tgz'
        ),
        [
          'http://foo-us1.oss.com/@cnpmtest/download-test-module/-/@cnpmtest/download-test-module-1.0.0.tgz?foo=bar&other_urls=http%3A%2F%2Fdefault.oss.com%2F%40cnpmtest%2Fdownload-test-module%2F-%2F%40cnpmtest%2Fdownload-test-module-1.0.0.tgz%2Chttp%3A%2F%2Fbackup.oss.com%2F%40cnpmtest%2Fdownload-test-module%2F-%2F%40cnpmtest%2Fdownload-test-module-1.0.0.tgz',
          'http://default.oss.com/@cnpmtest/download-test-module/-/@cnpmtest/download-test-module-1.0.0.tgz',
          'http://backup.oss.com/@cnpmtest/download-test-module/-/@cnpmtest/download-test-module-1.0.0.tgz',
        ]
      );
    });
  });

  describe('parsePackageStorePath()', () => {
    it('should reverse getPackageStorePath', () => {
      for (const pkg of [
        { name: 'foo', version: '1.0.0' },
        { name: '@a/b_c', version: '2.0.0-beta.1' },
        { name: '@a_b/c', version: '1.0.0' },
      ]) {
        assert.deepEqual(utils.parsePackageStorePath(utils.getPackageStorePath('/store', pkg)), pkg);
      }
    });

    it('should separate the source suffix of git, url and local packages', () => {
      const sha = '1a2b3c4d5e6f7a8b9c0d1a2b3c4d5e6f7a8b9c0d';
      const dir = utils.getPackageStorePath('/store', { name: 'foo', version: '1.0.0' }, utils.gitSource(sha));
      assert.equal(path.basename(dir), '_foo@1.0.0+git.1a2b3c4d@foo');
      assert.deepEqual(utils.parsePackageStorePath(dir), { name: 'foo', version: '1.0.0', source: 'git.1a2b3c4d' });
      const scoped = { name: '@a/b', version: '1.0.0+build.1' };
      const source = utils.fileSource('/abs/dir');
      const scopedDir = utils.getPackageStorePath('/store', scoped, source);
      assert.match(scopedDir, /_@a_b@1\.0\.0\+build\.1\.file\.[0-9a-f]{8}@@a[/\\]b$/);
      assert.deepEqual(utils.parsePackageStorePath(scopedDir), { ...scoped, source });
      assert.match(utils.urlSource('sha512-abc'), /^url\.[0-9a-f]{8}$/);
    });

    it('should return null for other directories', () => {
      assert.equal(utils.parsePackageStorePath('/store/foo'), null);
      assert.equal(utils.parsePackageStorePath('/store/_foo@1.0.0@bar'), null);
      assert.equal(utils.parsePackageStorePath('/store/_@a_b@1.0.0@@a/c'), null);
    });
  });

  describe('pruneJSON()', () => {
    const [tmp, cleanup] = helper.tmp();
    beforeEach(cleanup);
    afterEach(cleanup);

    it('should finish writing package.json before resolve', async () => {
      const pkgFile = path.join(tmp, 'package.json');
      await fs.writeFile(
        pkgFile,
        JSON.stringify({
          dependencies: { foo: '1.0.0', bar: '1.0.0' },
          devDependencies: { foo: '1.0.0' },
        })
      );
      await utils.pruneJSON(pkgFile, 'foo');
      const pkg = JSON.parse(await fs.readFile(pkgFile, 'utf8'));
      assert.deepEqual(pkg.dependencies, { bar: '1.0.0' });
      assert.deepEqual(pkg.devDependencies, {});
    });

    it('should keep package.json unchanged when dependency not found', async () => {
      const pkgFile = path.join(tmp, 'package.json');
      await fs.writeFile(pkgFile, JSON.stringify({ dependencies: { bar: '1.0.0' } }));
      await utils.pruneJSON(pkgFile, 'foo');
      const pkg = JSON.parse(await fs.readFile(pkgFile, 'utf8'));
      assert.deepEqual(pkg.dependencies, { bar: '1.0.0' });
    });
  });

  describe('install state', () => {
    const [tmp, cleanup] = helper.tmp();
    const store = path.join(tmp, 'node_modules');
    const installState = require('../../lib/install_state');
    const createPackage = async entry => {
      const dir = path.join(store, entry);
      await utils.mkdirp(dir);
      await fs.writeFile(path.join(dir, 'package.json'), '{}');
      await utils.setInstallDone(dir, 'postinstall');
      return dir;
    };
    const stateKeys = async () =>
      Object.keys(JSON.parse(await fs.readFile(path.join(store, '.npd-state.json'), 'utf8')).packages).sort();
    beforeEach(cleanup);
    afterEach(cleanup);

    it('should mark a package unfinished on reset', async () => {
      const dir = await createPackage('_a@1.0.0@a');
      assert.equal(await utils.isInstallDone(dir), true);
      await installState.reset(dir);
      assert.equal(await utils.isInstallDone(dir), false);
      assert.deepEqual(await utils.getInstallState(dir), { done: false });
    });

    it('should remove only the matching store entries', async () => {
      await createPackage('_a@1.0.0@a');
      await createPackage('_b@1.0.0@b');
      await createPackage('_@s_c@1.0.0@@s/c');
      const dropped = ['_a@1.0.0@a', '_@s_c@1.0.0@@s'];
      await installState.removeEntries(store, entry => dropped.includes(entry));
      assert.deepEqual(await stateKeys(), ['_b@1.0.0@b']);
    });

    it('should keep an entry set while another call is reloading the state file', async () => {
      const mm = require('mm');
      const a = await createPackage('_a@1.0.0@a');
      const b = await createPackage('_b@1.0.0@b');
      await installState.reset(a);
      // 其他进程改写了状态文件, 下一次读取会重新加载
      const file = path.join(store, '.npd-state.json');
      const data = JSON.parse(await fs.readFile(file, 'utf8'));
      data.packages['_c@1.0.0@c'] = { done: true };
      await fs.writeFile(file, JSON.stringify(data));
      // 第 1 次读取(get(b) 的重新加载)慢于 setInstallDone(a), 第 3 次读取(写盘前的合并)再晚于第 1 次返回
      const readFile = fs.readFile;
      const delays = [200, 0, 400];
      let calls = 0;
      mm(fs, 'readFile', async (...args) => {
        const delay = delays[calls++] || 0;
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        return readFile.apply(fs, args);
      });
      try {
        const reloading = installState.get(b);
        await new Promise(resolve => setTimeout(resolve, 50));
        await utils.setInstallDone(a);
        await reloading;
      } finally {
        mm.restore();
      }
      assert.deepEqual(await installState.get(a), { done: true });
      assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')).packages['_a@1.0.0@a'], { done: true });
    });
  });

  describe('stripUrlAuth()', () => {
    it('should drop credentials but keep the ssh user', () => {
      const sha = 'a'.repeat(40);
      assert.equal(
        utils.stripUrlAuth(`git+https://user:tok@github.com/a/b.git#${sha}`),
        `git+https://github.com/a/b.git#${sha}`
      );
      assert.equal(utils.stripUrlAuth('https://tok@r.com/a/-/a-1.0.0.tgz'), 'https://r.com/a/-/a-1.0.0.tgz');
      assert.equal(utils.stripUrlAuth('git+ssh://git@github.com/a/b.git'), 'git+ssh://git@github.com/a/b.git');
      assert.equal(utils.stripUrlAuth('git+ssh://u:pw@host/a/b.git'), 'git+ssh://u@host/a/b.git');
      assert.equal(utils.stripUrlAuth('https://r.com/a@1.0.0'), 'https://r.com/a@1.0.0');
    });
  });

  describe('redact()', () => {
    it('should hide credentials in urls and npmrc style tokens', () => {
      assert.equal(utils.redactUrl('http://u:p@h:8080'), 'http://***@h:8080');
      assert.equal(
        utils.redactUrl('install git+https://tok@github.com/a/b.git failed'),
        'install git+https://***@github.com/a/b.git failed'
      );
      assert.equal(utils.redactUrl('git@github.com:a/b'), 'git@github.com:a/b');
      assert.equal(utils.redactUrl('//r.com/:_authToken=abc x'), '//r.com/:_authToken=*** x');
      assert.equal(
        utils.redactUrl('GET https://h/a.tgz?token=abc&v=1#x failed'),
        'GET https://h/a.tgz?token=***&v=1#x failed'
      );
      assert.equal(utils.redactUrl('https://h/a?v=1&access_token=abc'), 'https://h/a?v=1&access_token=***');
      assert.equal(utils.redactUrl('https://h/a?auth=abc&password=p'), 'https://h/a?auth=***&password=***');
      assert.equal(utils.redactUrl('https://h/a?Token=abc&PASSWORD=p'), 'https://h/a?Token=***&PASSWORD=***');
      assert.equal(utils.redactUrl('https://h/a?mytoken=abc'), 'https://h/a?mytoken=abc');
    });

    it('should return a redacted copy and keep the original', () => {
      const original = {
        registry: 'https://u:p@r.com/',
        headers: { Authorization: 'Bearer abc', 'User-Agent': 'npd' },
        '//r.com/:_authToken': 'abc',
        list: ['http://a:b@c.com'],
        nested: { password: 'x' },
      };
      const snapshot = JSON.parse(JSON.stringify(original));
      const copy = utils.redact(original);
      assert.deepEqual(original, snapshot);
      assert.deepEqual(copy, {
        registry: 'https://***@r.com/',
        headers: { Authorization: '***', 'User-Agent': 'npd' },
        '//r.com/:_authToken': '***',
        list: ['http://***@c.com'],
        nested: { password: '***' },
      });
    });

    it('should not throw on circular references', () => {
      const original = { url: 'http://a:b@c.com' };
      original.self = original;
      const copy = utils.redact(original);
      assert.equal(copy.self, copy);
      assert.equal(copy.url, 'http://***@c.com');
    });
  });

  describe('trackChildProcess()', () => {
    const events = ['exit', 'SIGINT', 'SIGTERM'];
    const counts = () => events.map(event => process.listenerCount(event));

    it('should add one listener per event however many processes are tracked', async () => {
      const warnings = [];
      const onWarning = warning => warnings.push(warning);
      process.on('warning', onWarning);
      const baseline = counts();
      // 同一 worker 先运行的文件会留下监听(coffee 每次 fork 注册一个 exit 监听), 基线恰好等于上限时多 1 个也会告警
      const maxListeners = process.getMaxListeners();
      process.setMaxListeners(Math.max(maxListeners, ...baseline) + 10);
      try {
        // 超出 pid 上限, 不会误杀真实进程
        const untracks = Array.from({ length: 20 }, (_, i) => utils.trackChildProcess(4194304 + i));
        assert.deepEqual(
          counts(),
          baseline.map(count => count + 1)
        );
        untracks.forEach(untrack => untrack());
        assert.deepEqual(counts(), baseline);
        await new Promise(resolve => setImmediate(resolve));
      } finally {
        process.setMaxListeners(maxListeners);
        process.removeListener('warning', onWarning);
      }
      assert.deepEqual(warnings, []);
    });

    describe('on signals', () => {
      if (process.platform === 'win32') return;
      const [tmp, cleanup] = helper.tmp();
      before(cleanup);
      after(cleanup);

      const isAlive = pid => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      };

      const runDriver = async signal => {
        const driver = path.join(tmp, 'driver.js');
        const grandchild = `const c = require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); console.log(c.pid); setInterval(() => {}, 1000);`;
        await fs.writeFile(
          driver,
          `const { spawn } = require('child_process');
const utils = require(${JSON.stringify(path.join(__dirname, '../../lib/utils'))});
const child = spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
utils.trackChildProcess(child.pid);
child.stdout.pipe(process.stdout);
setInterval(() => {}, 1000);
`
        );
        const proc = require('child_process').spawn(process.execPath, [driver], {
          stdio: ['ignore', 'pipe', 'inherit'],
        });
        const pid = await new Promise(resolve =>
          proc.stdout.once('data', data => resolve(Number(String(data).trim())))
        );
        assert(isAlive(pid));
        const code = await new Promise(resolve => {
          proc.on('exit', resolve);
          proc.kill(signal);
        });
        for (let i = 0; i < 40 && isAlive(pid); i++) await utils.sleep(50);
        return { code, alive: isAlive(pid) };
      };

      it('should kill tracked process trees and exit with 143 on SIGTERM', async () => {
        assert.deepEqual(await runDriver('SIGTERM'), { code: 143, alive: false });
      });

      it('should exit with 130 on SIGINT', async () => {
        assert.deepEqual(await runDriver('SIGINT'), { code: 130, alive: false });
      });
    });
  });
});
