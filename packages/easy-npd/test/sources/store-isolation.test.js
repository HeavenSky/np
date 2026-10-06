'use strict';

// store 目录的复用条件: 本地包内容变了要重装, 不带来源后缀的旧 git / 本地包目录不当作 registry 包, 声明改回 registry 版本时换成 registry 包
const assert = require('assert');
const fs = require('fs/promises');
const path = require('path');
const npminstall = require('../support/npminstall');
const helper = require('../support/helper');

describe('test/sources/store-isolation.test.js', () => {
  const [tmp, cleanup] = helper.tmp();
  const root = path.join(tmp, 'app');
  const store = path.join(root, 'node_modules');

  beforeEach(async () => {
    await cleanup();
    await fs.mkdir(root, { recursive: true });
  });
  afterEach(cleanup);

  const writeRootPkg = dependencies =>
    fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'app', version: '1.0.0', dependencies }));
  const readInstalled = (name, file) => fs.readFile(path.join(root, 'node_modules', name, file), 'utf8');
  const writeLocalPkg = async (dir, pkg, index) => {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify(pkg));
    await fs.writeFile(path.join(dir, 'index.js'), index);
  };

  it('should reinstall a local folder whose content changed without a version bump', async () => {
    const localDir = path.join(root, 'local-demo');
    await writeLocalPkg(localDir, { name: 'local-demo', version: '1.0.0' }, 'one');
    await writeRootPkg({ 'local-demo': 'file:./local-demo' });
    await npminstall({ root });
    assert.equal(await readInstalled('local-demo', 'index.js'), 'one');

    await fs.writeFile(path.join(localDir, 'index.js'), 'two');
    await npminstall({ root });
    assert.equal(await readInstalled('local-demo', 'index.js'), 'two');
    const entries = (await fs.readdir(store)).filter(entry => entry.startsWith('_local-demo@'));
    assert.equal(entries.length, 1, entries.join(', '));
  });

  it('should replace a local package with the registry package when the declaration goes back to a version', async () => {
    const fake = 'module.exports = "fake";';
    await writeLocalPkg(path.join(root, 'fake-pedding'), { name: 'pedding', version: '1.1.0' }, fake);
    await writeRootPkg({ pedding: 'file:./fake-pedding' });
    await npminstall({ root });
    assert.equal(await readInstalled('pedding', 'index.js'), fake);

    await writeRootPkg({ pedding: '1.1.0' });
    await npminstall({ root });
    assert.notEqual(await readInstalled('pedding', 'index.js'), fake);
    assert.equal(
      await fs.realpath(path.join(root, 'node_modules/pedding')),
      await fs.realpath(path.join(store, '_pedding@1.1.0@pedding'))
    );
  });

  it('should not reuse a store directory without source suffix that holds a git package', async () => {
    await writeRootPkg({ pedding: '1.1.0' });
    await npminstall({ root });
    const dir = path.join(store, '_pedding@1.1.0@pedding');
    const pkg = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8'));
    // 模拟来源后缀出现之前由 git 依赖装进同一目录的包
    await fs.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({
        ...pkg,
        _from: 'pedding@git+https://example.com/pedding.git',
        _resolved: 'git+https://example.com/pedding.git#0123456789abcdef0123456789abcdef01234567',
      })
    );
    await fs.writeFile(path.join(dir, 'index.js'), 'module.exports = "fake";');

    await npminstall({ root });
    assert.notEqual(await readInstalled('pedding', 'index.js'), 'module.exports = "fake";');
    const installed = JSON.parse(await readInstalled('pedding', 'package.json'));
    assert.equal(installed._from, 'pedding@1.1.0');
  });
});
