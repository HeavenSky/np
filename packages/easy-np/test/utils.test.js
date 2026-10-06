const assert = require('node:assert');
const utils = require('../lib/utils');

describe('test/utils.test.js', () => {
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

  describe('runScript() with timeout', () => {
    const fs = require('node:fs/promises');
    const path = require('node:path');
    const helper = require('./helper');
    const [tmp, cleanup] = helper.tmp();
    const globalOptions = { root: tmp, console: { info() {}, warn() {} } };
    const nodeScript = code => `"${process.execPath}" -e ${JSON.stringify(code)}`;

    beforeEach(async () => {
      await cleanup();
      await fs.writeFile(path.join(tmp, 'package.json'), '{"name":"t","version":"1.0.0"}');
    });
    after(cleanup);

    it('should attach stderr to the error', async () => {
      await assert.rejects(
        utils.runScript(
          tmp,
          nodeScript('console.error("prepare-detail"); process.exit(2)'),
          globalOptions,
          false,
          10000
        ),
        err => err.stderr.includes('prepare-detail')
      );
    });

    it('should kill grandchild processes on timeout', async function () {
      if (process.platform === 'win32') this.skip();
      const pidFile = path.join(tmp, 'grandchild.pid');
      const code = `const c = require("child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" }); require("fs").writeFileSync(${JSON.stringify(pidFile)}, String(c.pid)); setInterval(() => {}, 1000);`;
      await assert.rejects(utils.runScript(tmp, nodeScript(code), globalOptions, false, 2000), /timed out after 2s/);
      const pid = Number(await fs.readFile(pidFile, 'utf8'));
      await new Promise(resolve => setTimeout(resolve, 200));
      assert.throws(() => process.kill(pid, 0), /ESRCH/);
    });
  });

  describe('trackChildProcess()', () => {
    const fs = require('node:fs/promises');
    const path = require('node:path');
    const { spawn } = require('node:child_process');
    const helper = require('./helper');
    const [tmp, cleanup] = helper.tmp();
    const EVENTS = ['exit', 'SIGINT', 'SIGTERM'];
    const counts = () => EVENTS.map(name => process.listenerCount(name));

    beforeEach(cleanup);
    after(cleanup);

    it('should add one listener per event no matter how many processes are tracked', async () => {
      const baseline = counts();
      const warnings = [];
      const onWarning = warning => warnings.push(warning);
      process.on('warning', onWarning);
      // 同一 worker 先运行的文件会留下监听(coffee 每次 fork 注册一个 exit 监听), 基线恰好等于上限时多 1 个也会告警
      const maxListeners = process.getMaxListeners();
      process.setMaxListeners(Math.max(maxListeners, ...baseline) + 10);
      try {
        const untracks = [];
        try {
          // 超出各平台 pid 上限, 不会误杀真实进程
          for (let i = 0; i < 20; i++) untracks.push(utils.trackChildProcess(4194304 + i));
          assert.deepEqual(
            counts(),
            baseline.map(count => count + 1)
          );
        } finally {
          for (const untrack of untracks) untrack();
        }
        assert.deepEqual(counts(), baseline);
        await new Promise(resolve => setImmediate(resolve));
      } finally {
        process.setMaxListeners(maxListeners);
        process.removeListener('warning', onWarning);
      }
      assert.deepEqual(warnings, []);
    });

    for (const [signal, code] of [
      ['SIGTERM', 143],
      ['SIGINT', 130],
    ]) {
      it(`should kill tracked process trees and exit with ${code} on ${signal}`, async function () {
        if (process.platform === 'win32') this.skip();
        const pidFile = path.join(tmp, 'grandchild.pid');
        const childCode = `const c = require("child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" }); require("fs").writeFileSync(${JSON.stringify(pidFile)}, String(c.pid)); setInterval(() => {}, 1000);`;
        const driver = path.join(tmp, 'driver.js');
        await fs.writeFile(
          driver,
          `const utils = require(${JSON.stringify(require.resolve('../lib/utils'))});
const child = require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(childCode)}], { detached: true, stdio: 'ignore' });
utils.trackChildProcess(child.pid);
setInterval(() => {}, 1000);`
        );
        const proc = spawn(process.execPath, [driver], { stdio: 'ignore' });
        const exited = new Promise(resolve =>
          proc.on('exit', (exitCode, exitSignal) => resolve({ exitCode, exitSignal }))
        );
        let pid;
        try {
          for (let i = 0; i < 100 && !pid; i++) {
            await utils.sleep(100);
            pid = Number(await fs.readFile(pidFile, 'utf8').catch(() => '')) || undefined;
          }
          assert(pid, 'grandchild did not start');
          proc.kill(signal);
          assert.deepEqual(await exited, { exitCode: code, exitSignal: null });
          await utils.sleep(200);
          assert.throws(() => process.kill(pid, 0), /ESRCH/);
        } finally {
          proc.kill('SIGKILL');
          if (pid) utils.killProcessTree(pid);
        }
      });
    }
  });

  describe('install state', () => {
    const fs = require('node:fs/promises');
    const path = require('node:path');
    const helper = require('./helper');
    const installState = require('../lib/install_state');
    const [tmp, cleanup] = helper.tmp();
    const store = path.join(tmp, 'node_modules/.store');
    const createPackage = async name => {
      const dir = path.join(store, `${name}@1.0.0/node_modules/${name}`);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0' }));
      await utils.setInstallDone(dir, utils.FIRST_INSTALL_STAGE);
      return dir;
    };
    const stateKeys = async () =>
      Object.keys((await helper.readJSON(path.join(store, '.np-state.json'))).packages).sort();

    beforeEach(cleanup);
    after(cleanup);

    it('should mark the package unfinished on reset', async () => {
      const dir = await createPackage('a');
      assert.equal(await utils.isInstallDone(dir), true);
      await installState.reset(dir);
      assert.equal(await utils.isInstallDone(dir), false);
      assert.deepEqual(await installState.get(dir), { done: false });
    });

    it('should remove only the matching entries', async () => {
      await createPackage('a');
      await createPackage('b');
      await installState.removeEntries(store, entry => entry === 'a@1.0.0');
      assert.deepEqual(await stateKeys(), ['b@1.0.0/node_modules/b']);
    });
  });

  describe('redact()', () => {
    it('should hide credentials in urls', () => {
      assert.equal(utils.redactUrl('proxy http://u:p@h:8080 failed'), 'proxy http://***@h:8080 failed');
      assert.equal(
        utils.redactUrl('git+https://tok@github.com/a/b.git#main'),
        'git+https://***@github.com/a/b.git#main'
      );
      assert.equal(utils.redactUrl('git@github.com:a/b'), 'git@github.com:a/b');
      assert.equal(
        utils.redactUrl('//r.com/:_authToken=abc _password: "xyz"'),
        '//r.com/:_authToken=*** _password: "***"'
      );
    });

    it('should hide tokens in query strings', () => {
      assert.equal(
        utils.redactUrl('GET https://h/a.tgz?token=abc&x=1#frag failed'),
        'GET https://h/a.tgz?token=***&x=1#frag failed'
      );
      assert.equal(
        utils.redactUrl('https://h/a?x=1&access_token=abc&auth=def&Password=ghi'),
        'https://h/a?x=1&access_token=***&auth=***&Password=***'
      );
      assert.equal(utils.redactUrl('https://h/a?_authToken=abc'), 'https://h/a?_authToken=***');
      assert.equal(utils.redactUrl('https://h/a?tokens=abc&mytoken=def'), 'https://h/a?tokens=abc&mytoken=def');
    });

    it('should return a redacted copy and keep the original', () => {
      const original = {
        proxy: 'http://user:s3cret@127.0.0.1:1',
        headers: { Authorization: 'Bearer t', accept: 'json' },
        '//r.com/:_authToken': 'abc',
        list: ['https://a:b@c.com/x'],
      };
      original.self = original;
      const copy = utils.redact(original);
      assert.equal(copy.proxy, 'http://***@127.0.0.1:1');
      assert.deepEqual(copy.headers, { Authorization: '***', accept: 'json' });
      assert.equal(copy['//r.com/:_authToken'], '***');
      assert.deepEqual(copy.list, ['https://***@c.com/x']);
      assert.equal(copy.self, copy);
      assert.equal(original.proxy, 'http://user:s3cret@127.0.0.1:1');
      assert.equal(original.headers.Authorization, 'Bearer t');
    });
  });

  describe('stripUrlAuth()', () => {
    it('should drop credentials but keep ssh user names', () => {
      assert.equal(
        utils.stripUrlAuth('git+https://user:tok@github.com/a/b.git#' + 'a'.repeat(40)),
        'git+https://github.com/a/b.git#' + 'a'.repeat(40)
      );
      assert.equal(utils.stripUrlAuth('foo@https://tok@h.com/foo.tgz'), 'foo@https://h.com/foo.tgz');
      assert.equal(utils.stripUrlAuth('git+ssh://git@github.com/a/b.git'), 'git+ssh://git@github.com/a/b.git');
      assert.equal(utils.stripUrlAuth('git+ssh://user:pass@h.com/a/b.git'), 'git+ssh://user@h.com/a/b.git');
      assert.equal(utils.stripUrlAuth('pedding@^1.0.0'), 'pedding@^1.0.0');
      assert.equal(utils.stripUrlAuth(undefined), undefined);
    });
  });

  describe('store source suffix', () => {
    it('should build and parse versions with a source suffix', () => {
      const sha = '1a2b3c4d5e6f1a2b3c4d5e6f1a2b3c4d5e6f1a2b';
      assert.equal(utils.sourceSuffix('git', sha), 'git.1a2b3c4d');
      assert.match(utils.sourceSuffix('url', 'sha512-abc'), /^url\.[a-f0-9]{8}$/);
      assert.match(utils.sourceSuffix('file', '/a/b'), /^file\.[a-f0-9]{8}$/);
      assert.notEqual(utils.sourceSuffix('file', '/a/b'), utils.sourceSuffix('file', '/a/c'));
      assert.equal(utils.storeVersion('1.0.0', 'git.1a2b3c4d'), '1.0.0+git.1a2b3c4d');
      assert.equal(utils.storeVersion('1.0.0+build.5', 'git.1a2b3c4d'), '1.0.0+build.5.git.1a2b3c4d');
      assert.equal(utils.storeVersion('1.0.0', null), '1.0.0');
      assert.deepEqual(utils.parseStoreVersion('1.0.0+git.1a2b3c4d'), { version: '1.0.0', suffix: 'git.1a2b3c4d' });
      assert.deepEqual(utils.parseStoreVersion('1.0.0+build.5.url.1a2b3c4d'), {
        version: '1.0.0+build.5',
        suffix: 'url.1a2b3c4d',
      });
      assert.deepEqual(utils.parseStoreVersion('1.0.0+build.5'), { version: '1.0.0+build.5', suffix: null });
      assert.equal(
        utils.getPackageStorePath('/r/node_modules', { name: '@a/b', version: '1.0.0' }, {}, 'file.1a2b3c4d'),
        require('node:path').join('/r/node_modules/.store/@a+b@1.0.0+file.1a2b3c4d/node_modules/@a/b')
      );
    });
  });
});
