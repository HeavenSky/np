// 根目录提升: 默认不提升, --public-hoist-pattern 按正则提升, --dedup 提升全部包
const path = require('node:path');
const coffee = require('coffee');
const assertFile = require('assert-file');
const helper = require('./helper');

describe('test/install-public-hoist-pattern.test.js', () => {
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
    await coffee.fork(helper.npminstall, [ '--ignore-scripts' ], { cwd, env })
      .debug()
      .expect('code', 0)
      .end();
    assertFile(rootModule('eslint-config-egg'));
    assertFile.fail(rootModule('eslint-plugin-eggache'));
    assertFile.fail(rootModule('ajv'));
  });

  it('should hoist packages matched by --public-hoist-pattern', async () => {
    await coffee.fork(helper.npminstall, [ '--public-hoist-pattern=eslint' ], { cwd, env })
      .debug()
      .expect('code', 0)
      .end();
    assertFile(rootModule('eslint-plugin-eggache'));
    assertFile.fail(rootModule('ajv'));
  });

  it('should hoist all packages with --dedup', async () => {
    await coffee.fork(helper.npminstall, [ '--dedup', '--public-hoist-pattern=none' ], { cwd, env })
      .debug()
      .expect('code', 0)
      .end();
    assertFile(rootModule('eslint-plugin-eggache'));
    assertFile(rootModule('ajv'));
  });
});
