const assert = require('node:assert');
const fs = require('node:fs/promises');
const path = require('node:path');
const coffee = require('coffee');
const helper = require('./helper');

describe('test/uninstallGlobal.test.js', () => {
  const [tmp, cleanup] = helper.tmp();

  beforeEach(cleanup);
  afterEach(cleanup);

  it('should uninstall with global and prefix', async () => {
    await coffee
      .fork(helper.npminstall, [`--prefix=${tmp}`, '-g', 'mocha@11'])
      .debug()
      .expect('stdout', /All packages installed/)
      .expect('code', 0)
      .end();

    if (process.platform === 'win32') {
      await coffee
        .fork(require.resolve('../bin/uninstall'), [`--prefix=${tmp}`, '-g', 'mocha'])
        .debug()
        .expect('stdout', /- mocha /)
        .expect('code', 0)
        .end();
    } else {
      await coffee
        .fork(require.resolve('../bin/uninstall'), [`--prefix=${tmp}`, '-g', 'mocha'])
        .debug()
        .expect('stdout', /- mocha \.[/\\]test[/\\]fixtures[/\\]\.tmp_[\w-]+[/\\]lib[/\\]node_modules[/\\]mocha/)
        .expect('stdout', /- mocha \.[/\\]test[/\\]fixtures[/\\]\.tmp_[\w-]+[/\\]bin[/\\]mocha/)
        .expect('stdout', /- mocha \.[/\\]test[/\\]fixtures[/\\]\.tmp_[\w-]+[/\\]bin[/\\]_mocha/)
        .expect('code', 0)
        .end();
    }
  });

  it('should remove all bin shims with global uninstall', async () => {
    await coffee
      .fork(helper.npminstall, [`--prefix=${tmp}`, '-g', 'mocha@11'])
      .debug()
      .expect('code', 0)
      .end();

    const binDir = process.platform === 'win32' ? tmp : path.join(tmp, 'bin');
    if (process.platform !== 'win32') {
      const names = await fs.readdir(binDir);
      assert(!names.some(name => /\.(cmd|ps1)$/i.test(name)), names.join(','));
    }
    // 模拟旧版本在非 Windows 上遗留的 shim
    for (const name of ['mocha.cmd', 'mocha.ps1', '_mocha.cmd', '_mocha.ps1']) {
      await fs.writeFile(path.join(binDir, name), '');
    }

    await coffee
      .fork(require.resolve('../bin/uninstall'), [`--prefix=${tmp}`, '-g', 'mocha'])
      .debug()
      .expect('code', 0)
      .end();

    const names = await fs.readdir(binDir);
    assert(!names.some(name => /^_?mocha(\.|$)/i.test(name)), names.join(','));
  });
});
