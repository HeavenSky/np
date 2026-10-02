'use strict';

const assert = require('assert');
const fs = require('fs/promises');
const path = require('path');
const coffee = require('coffee');
const helper = require('./helper');
const { exists } = require('../lib/utils');

describe('test/installGlobal.test.js', () => {
  const registry = process.env.npm_registry || 'https://r.cnpmjs.org';
  const [tmp, cleanup] = helper.tmp();

  let binDir = path.join(tmp, 'bin');
  let libDir = path.join(tmp, 'lib');
  if (process.platform === 'win32') {
    binDir = tmp;
    libDir = tmp;
  }

  beforeEach(cleanup);
  afterEach(cleanup);
  it('should global install work', async () => {
    await coffee
      .fork(helper.npminstall, [
        `--prefix=${tmp}`,
        '-g',
        'contributors',
        `${registry}/pedding/-/pedding-1.0.0.tgz`,
        `${registry}/taffydb/-/taffydb-2.7.2.tgz`,
        `${registry}/egg-bin/-/egg-bin-1.6.0.tgz`,
      ])
      .debug()
      .expect('stdout', /All packages installed/)
      .expect('code', 0)
      .end();

    assert(await exists(path.join(binDir, 'contributors')));
    assert(await exists(path.join(binDir, 'egg-bin')));
    assert(await exists(path.join(libDir, 'node_modules/contributors')));
    assert(await exists(path.join(libDir, 'node_modules/taffydb')));
    assert(await exists(path.join(libDir, 'node_modules/pedding')));
    assert(await exists(path.join(libDir, 'node_modules/egg-bin')));
    assert(!(await exists(path.join(libDir, 'node_modules/.contributors_npd/node_modules'))));

    await coffee
      .fork(require.resolve('../bin/install.js'), [
        `--prefix=${tmp}`,
        '-g',
        'contributors',
        'b',
        `${registry}/egg-bin/-/egg-bin-1.7.0.tgz`,
      ])
      .debug()
      .expect('stdout', /All packages installed/)
      .expect('code', 0)
      .end();

    assert(await exists(path.join(binDir, 'contributors')));
    assert(await exists(path.join(binDir, 'egg-bin')));
    assert(await exists(path.join(binDir, 'mocha')));
    assert(await exists(path.join(libDir, 'node_modules/contributors')));
    assert(await exists(path.join(libDir, 'node_modules/b')));
    assert(await exists(path.join(libDir, 'node_modules/egg-bin')));

    await coffee
      .fork(require.resolve('../bin/install.js'), [`--prefix=${tmp}`, '-g', 'contributors@0'])
      .debug()
      .expect('stdout', /All packages installed/)
      .expect('code', 0)
      .end();

    assert(await exists(path.join(binDir, 'contributors')));
    assert(await exists(path.join(libDir, 'node_modules/contributors')));
  });

  it('should install success with alias package', async () => {
    await coffee
      .fork(helper.npminstall, [`--prefix=${tmp}`, '-g', 'lodash-has@npm:lodash.has@4'])
      .debug()
      .expect('stdout', /Downloading lodash-has\(lodash.has\) to /)
      .expect('stdout', /Installing lodash.has's dependencies to /)
      .expect('stdout', /All packages installed/)
      .expect('code', 0)
      .end();
  });

  it('should remove old bins when reinstall global package', async () => {
    await coffee
      .fork(helper.npminstall, [`--prefix=${tmp}`, '-g', 'mocha@11'])
      .debug()
      .expect('code', 0)
      .end();

    // 模拟旧版本声明了新版本没有的命令, 以及在非 Windows 上遗留的 shim
    const pkgFile = path.join(libDir, 'node_modules/mocha/package.json');
    const pkg = JSON.parse(await fs.readFile(pkgFile, 'utf8'));
    pkg.bin['old-mocha'] = pkg.bin.mocha;
    await fs.writeFile(pkgFile, JSON.stringify(pkg));
    for (const name of ['old-mocha', 'old-mocha.cmd', 'old-mocha.ps1', 'mocha.cmd', 'mocha.ps1']) {
      await fs.writeFile(path.join(binDir, name), '');
    }

    await coffee
      .fork(helper.npminstall, [`--prefix=${tmp}`, '-g', 'mocha@11'])
      .debug()
      .expect('code', 0)
      .end();

    const names = await fs.readdir(binDir);
    assert(!names.some(name => name.startsWith('old-mocha')), names.join(','));
    assert(names.includes('mocha'));
    if (process.platform !== 'win32') {
      assert(!names.some(name => /\.(cmd|ps1)$/i.test(name)), names.join(','));
    }
  });
});
