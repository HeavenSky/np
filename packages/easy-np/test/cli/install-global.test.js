const assert = require('node:assert');
const fs = require('node:fs/promises');
const path = require('node:path');
const coffee = require('coffee');
const helper = require('../support/helper');
const { exists } = require('../../lib/utils');

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
      .fork(helper.npminstall, [`--prefix=${tmp}`, '-g', 'easy-np-not-exists-test-pkg', 'contributors@0'])
      .debug()
      .expect('stderr', /1 package\(s\) failed[\s\S]*easy-np-not-exists-test-pkg/)
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

  // will fail on Windows, ignore it
  if (process.platform !== 'win32') {
    it('should install with global prefix', async () => {
      await coffee
        .fork(helper.npminstall, [`--prefix=${tmp}`, '-g', 'egg-bin'])
        .debug()
        .expect('stdout', /Downloading egg-bin to /)
        .expect('stdout', /Installing egg-bin's dependencies to /)
        .expect('stdout', /All packages installed/)
        .expect('code', 0)
        .end();

      assert(await exists(path.join(binDir, 'egg-bin')));
      assert(await exists(path.join(libDir, 'node_modules/egg-bin')));
      assert((await fs.stat(path.join(libDir, 'node_modules/egg-bin'))).isDirectory());
    });
  }

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

  // 被装的包是它的本地依赖的声明者: file: 依赖的脚本要放行被装的包才执行
  it('should not run scripts of local dependencies until the global package is approved', async () => {
    const marker = path.join(tmp, 'inner-postinstall');
    const registryServer = helper.createRegistry('registry', []);
    await new Promise(resolve => registryServer.server.listen(0, '127.0.0.1', resolve));
    registryServer.prefix = `http://127.0.0.1:${registryServer.server.address().port}/`;
    try {
      const tarball = await helper.packTarball(
        tmp,
        { name: 'glob-host', version: '1.0.0', dependencies: { inner: 'file:./inner' } },
        {
          'inner/package.json': JSON.stringify({
            name: 'inner',
            version: '1.0.0',
            scripts: { postinstall: `node -e "require('fs').writeFileSync('${marker.replace(/\\/g, '/')}', '')"` },
          }),
        }
      );
      registryServer.packages = { 'glob-host': { '1.0.0': tarball } };
      const args = [`--prefix=${tmp}`, '-g', 'glob-host', `--registry=${registryServer.prefix.slice(0, -1)}`];
      const env = { ...process.env, np_cache: path.join(tmp, 'cache') };
      await coffee
        .fork(helper.npminstall, args, { env })
        .expect('stderr', /inner@file:\.\/inner \(declared by glob-host@1\.0\.0\) \(postinstall\)/)
        .expect('stderr', /reinstall with: np -g "--allow-scripts=glob-host@1\.0\.0" glob-host/)
        .notExpect('stderr', /approve-scripts/)
        .expect('code', 0)
        .end();
      assert(await exists(path.join(libDir, 'node_modules/glob-host/node_modules/inner/package.json')));
      assert.equal(await exists(marker), false);

      await coffee
        .fork(helper.npminstall, [...args, '--allow-scripts=glob-host'], { env })
        .expect('code', 0)
        .end();
      assert.equal(await exists(marker), true);
    } finally {
      registryServer.server.close();
    }
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
