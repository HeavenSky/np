// 根目录提升: 默认不提升, --public-hoist-pattern 按正则提升, --dedup 提升全部包
const path = require('node:path');
const fs = require('node:fs/promises');
const coffee = require('coffee');
const assertFile = require('assert-file');
const helper = require('../support/helper');

describe('test/resolution/public-hoist-pattern.test.js', () => {
  const cwd = helper.fixtures('public-hoist-pattern');
  const cleanup = helper.cleanup(cwd);
  const env = Object.assign({}, process.env, {
    USERPROFILE: cwd,
    HOME: cwd,
  });
  const rootModule = name => path.join(cwd, 'node_modules', name, 'package.json');

  beforeEach(cleanup);
  after(cleanup);

  it('should not hoist transitive deps by default', async () => {
    await coffee.fork(helper.npminstall, ['--ignore-scripts'], { cwd, env }).debug().expect('code', 0).end();
    assertFile(rootModule('http-errors'));
    assertFile.fail(rootModule('depd'));
    assertFile.fail(rootModule('statuses'));
  });

  it('should hoist packages matched by --public-hoist-pattern', async () => {
    await coffee
      .fork(helper.npminstall, ['--public-hoist-pattern=^depd$'], { cwd, env })
      .debug()
      .expect('code', 0)
      .end();
    assertFile(rootModule('depd'));
    assertFile.fail(rootModule('statuses'));
  });

  it('should hoist all packages with --dedup', async () => {
    await coffee
      .fork(helper.npminstall, ['--dedup', '--public-hoist-pattern=none'], { cwd, env })
      .debug()
      .expect('code', 0)
      .end();
    assertFile(rootModule('depd'));
    assertFile(rootModule('statuses'));
  });

  describe('config.np.publicHoistPattern in package.json', () => {
    const [tmp, cleanupTmp] = helper.tmp();
    const tmpModule = name => path.join(tmp, 'node_modules', name, 'package.json');

    beforeEach(async () => {
      await cleanupTmp();
      await fs.mkdir(tmp, { recursive: true });
      await fs.writeFile(
        path.join(tmp, 'package.json'),
        JSON.stringify({
          name: 'cfg',
          version: '1.0.0',
          dependencies: { debug: '2.6.9' },
          config: { np: { publicHoistPattern: '^ms$' } },
        })
      );
    });
    after(cleanupTmp);

    it('should hoist packages matched by config', async () => {
      await coffee.fork(helper.npminstall, [], { cwd: tmp }).debug().expect('code', 0).end();
      assertFile(tmpModule('ms'));
    });

    it('should prefer --public-hoist-pattern over config', async () => {
      await coffee
        .fork(helper.npminstall, ['--public-hoist-pattern=none'], { cwd: tmp })
        .debug()
        .expect('code', 0)
        .end();
      assertFile.fail(tmpModule('ms'));
    });

    it('should read config when installing named packages', async () => {
      await coffee.fork(helper.npminstall, ['debug@2.6.9'], { cwd: tmp }).debug().expect('code', 0).end();
      assertFile(tmpModule('debug'));
      assertFile(tmpModule('ms'));
    });
  });
});
