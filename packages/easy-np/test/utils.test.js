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
        utils.runScript(tmp, nodeScript('console.error("prepare-detail"); process.exit(2)'), globalOptions, false, 10000),
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
});
