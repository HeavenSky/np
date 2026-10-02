const assert = require('node:assert');
const fs = require('node:fs/promises');
const path = require('node:path');
const npminstall = require('./npminstall');
const helper = require('./helper');

describe('test/stale-bin.test.js', () => {
  const [tmp, cleanup] = helper.tmp();

  beforeEach(cleanup);
  afterEach(cleanup);

  it('should remove bins that the new version no longer declares', async () => {
    await npminstall({ root: tmp, pkgs: [{ name: 'mocha', version: '11' }] });
    const binDir = path.join(tmp, 'node_modules', '.bin');
    // 旧版本多声明 old-mocha(入口指向旧版本)与 shared-cmd(入口属于其他包)
    const oldDir = await fs.realpath(path.join(tmp, 'node_modules', 'mocha'));
    const pkgFile = path.join(oldDir, 'package.json');
    const pkg = JSON.parse(await fs.readFile(pkgFile, 'utf8'));
    pkg.bin['old-mocha'] = pkg.bin.mocha;
    pkg.bin['shared-cmd'] = pkg.bin.mocha;
    await fs.writeFile(pkgFile, JSON.stringify(pkg));
    const mochaBin = path.join(binDir, 'mocha');
    const oldBin = path.join(binDir, 'old-mocha');
    if ((await fs.lstat(mochaBin)).isSymbolicLink()) {
      await fs.symlink(await fs.readlink(mochaBin), oldBin);
    } else {
      await fs.copyFile(mochaBin, oldBin);
    }
    await fs.writeFile(path.join(binDir, 'shared-cmd'), '#!/bin/sh\necho other\n');

    await npminstall({ root: tmp, pkgs: [{ name: 'mocha', version: '10' }] });

    const names = await fs.readdir(binDir);
    assert(!names.includes('old-mocha'), names.join(','));
    assert(names.includes('shared-cmd'), names.join(','));
    assert(names.includes('mocha'), names.join(','));
    const newPkg = JSON.parse(await fs.readFile(path.join(tmp, 'node_modules', 'mocha', 'package.json'), 'utf8'));
    assert(newPkg.version.startsWith('10.'));
  });
});
