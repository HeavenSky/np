'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs/promises');
const coffee = require('coffee');
const helper = require('../support/helper');

describe('test/registry/production-cache.test.js', () => {
  // Fixme: mock Windows homedir
  if (process.platform === 'win32') return;

  const [homedir, cleanupTmp] = helper.tmp();
  const demo = helper.fixtures('demo-install-cache-strict');
  // 外部 shell 设置的缓存变量会覆盖 HOME 推导出的默认缓存目录, 使断言落空
  const baseEnv = Object.assign({}, process.env);
  delete baseEnv.np_cache;
  delete baseEnv.npm_config_cache;
  const cleanupModules = helper.cleanup(demo);

  async function cleanup() {
    await cleanupModules();
    await cleanupTmp();
  }

  beforeEach(cleanup);
  afterEach(cleanup);

  it('should read disk cache on --production', async () => {
    await coffee
      .fork(helper.npminstall, ['--production'], {
        cwd: demo,
        env: Object.assign({}, baseEnv, {
          HOME: homedir,
        }),
      })
      .debug()
      .end();
    assert(await fs.stat(path.join(homedir, '.np_tarball/np-tgz/debug')));
  });

  it('should read disk cache from npm_config_cache env', async () => {
    await coffee
      .fork(helper.npminstall, [], {
        cwd: demo,
        env: Object.assign({}, baseEnv, {
          HOME: homedir,
          npm_config_cache: path.join(homedir, 'foocache/.np_tarball'),
        }),
      })
      .debug()
      .end();
    assert(await fs.stat(path.join(homedir, 'foocache/.np_tarball/np-tgz/debug')));
  });

  it('should reject the removed --cache-strict', async () => {
    await coffee
      .fork(helper.npminstall, ['--cache-strict'], { cwd: demo })
      .expect('code', 1)
      .expect('stderr', /--cache-strict has been removed/)
      .end();
  });

  it('should read disk cache on NODE_ENV=production', async () => {
    await coffee
      .fork(helper.npminstall, [], {
        cwd: demo,
        env: Object.assign({}, baseEnv, {
          HOME: homedir,
          NODE_ENV: 'production',
        }),
      })
      .debug()
      .end();
    assert(await fs.stat(path.join(homedir, '.np_tarball/np-tgz/debug')));
  });

  it('should read disk cache from np_cache env', async () => {
    await coffee
      .fork(helper.npminstall, [], {
        cwd: demo,
        env: Object.assign({}, baseEnv, {
          HOME: homedir,
          np_cache: path.join(homedir, 'foocache/.np_tarball'),
        }),
      })
      .debug()
      .end();
    assert(await fs.stat(path.join(homedir, 'foocache/.np_tarball/np-tgz/debug')));
  });
});
