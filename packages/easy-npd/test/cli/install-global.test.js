'use strict';

const assert = require('assert');
const fs = require('fs/promises');
const path = require('path');
const coffee = require('coffee');
const helper = require('../support/helper');
const { exists } = require('../../lib/utils');

const x = path.join(__dirname, '../..', 'bin', 'x.js');

describe('test/cli/install-global.test.js', () => {
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
  it('should keep installing other global packages when one fails', async () => {
    await coffee
      .fork(helper.npminstall, [`--prefix=${tmp}`, '-g', 'easy-npd-not-exists-test-pkg', 'contributors@0'])
      .debug()
      .expect('stderr', /1 package\(s\) failed[\s\S]*easy-npd-not-exists-test-pkg/)
      .expect('code', 1)
      .end();
    assert(await exists(path.join(libDir, 'node_modules/contributors')));
  });

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
      .fork(require.resolve('../../bin/i.js'), [
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
      .fork(require.resolve('../../bin/i.js'), [`--prefix=${tmp}`, '-g', 'contributors@0'])
      .debug()
      .expect('stdout', /All packages installed/)
      .expect('code', 0)
      .end();

    assert(await exists(path.join(binDir, 'contributors')));
    assert(await exists(path.join(libDir, 'node_modules/contributors')));
  });

  it('should review scripts of local dependencies declared by the global package', async () => {
    const registry = helper.createRegistry('local', []);
    await new Promise(resolve => registry.server.listen(0, '127.0.0.1', resolve));
    registry.prefix = `http://127.0.0.1:${registry.server.address().port}/`;
    const mark = name => `node -e "require('fs').writeFileSync('${path.join(tmp, name).replace(/\\/g, '/')}', 'x')"`;
    const marked = name => exists(path.join(tmp, name));
    try {
      registry.packages['global-host'] = {
        '1.0.0': await helper.packTarball(
          tmp,
          {
            name: 'global-host',
            version: '1.0.0',
            dependencies: { inner: 'file:./inner' },
            scripts: { postinstall: mark('host-postinstall') },
          },
          {
            'inner/package.json': JSON.stringify({
              name: 'inner',
              version: '1.0.0',
              scripts: { postinstall: mark('inner-postinstall') },
            }),
          }
        ),
      };
      const install = args =>
        coffee.fork(x, ['install', `--prefix=${tmp}`, `--registry=${registry.prefix}`, '-g', ...args]).debug();
      await install(['global-host'])
        .expect('stderr', /inner@file:\.\/inner \(declared by global-host@1\.0\.0\)/)
        .expect('stderr', /reinstall with: npd-x install -g "--allow-scripts=global-host@1\.0\.0" global-host/)
        .notExpect('stderr', /approve-scripts/)
        .expect('code', 0)
        .end();
      assert(await exists(path.join(libDir, 'node_modules/global-host/node_modules/inner/package.json')));
      assert.equal(await marked('host-postinstall'), true);
      assert.equal(await marked('inner-postinstall'), false);

      await install(['global-host', '--allow-scripts=global-host']).expect('code', 0).end();
      assert.equal(await marked('inner-postinstall'), true);
    } finally {
      registry.server.close();
    }
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
