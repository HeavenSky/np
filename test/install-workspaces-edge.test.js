// workspace 场景的边界行为回归: 全局安装, lockfile, update, 排序, 版本校验, peer 校验, 卸载清理
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs/promises');
const coffee = require('coffee');
const helper = require('./helper');

describe('test/install-workspaces-edge.test.js', () => {
  const [ tmp, cleanup ] = helper.tmp();

  beforeEach(cleanup);
  afterEach(cleanup);

  async function writeJSON(file, data) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(data));
  }

  function run(bin, args = []) {
    return coffee.fork(bin, args, { cwd: tmp }).debug();
  }

  async function workspace(packages, rootPkg = {}) {
    await writeJSON(path.join(tmp, 'package.json'), {
      name: 'root', version: '1.0.0', private: true, workspaces: Object.keys(packages), ...rootPkg,
    });
    for (const [ dir, pkg ] of Object.entries(packages)) {
      await writeJSON(path.join(tmp, dir, 'package.json'), { version: '1.0.0', ...pkg });
    }
  }

  it('should not touch local node_modules on global install', async () => {
    await workspace({ 'packages/a': { name: 'pkg-a' } });
    await fs.mkdir(path.join(tmp, 'node_modules/pkg-a'), { recursive: true });
    await fs.writeFile(path.join(tmp, 'node_modules/pkg-a/marker.txt'), 'keep');
    await run(helper.npminstall, [ '-g', 'ms@2.1.3', `--prefix=${path.join(tmp, 'gprefix')}` ])
      .expect('code', 0)
      .end();
    assert.equal(await fs.readFile(path.join(tmp, 'node_modules/pkg-a/marker.txt'), 'utf8'), 'keep');
  });

  it('should reject --lockfile-path in workspaces', async () => {
    await workspace({ 'packages/a': { name: 'pkg-a', dependencies: { ms: '^2.0.0' } } });
    await writeJSON(path.join(tmp, 'package-lock.json'), { lockfileVersion: 3, packages: {} });
    await run(helper.npminstall, [ `--lockfile-path=${path.join(tmp, 'package-lock.json')}` ])
      .expect('code', 1)
      .expect('stderr', /--lockfile-path is not supported with npm workspaces/)
      .end();
  });

  it('should keep other workspaces working after np-update -w', async () => {
    await workspace({
      'packages/x': { name: 'pkg-x', dependencies: { ms: '2.1.3' } },
      'packages/y': { name: 'pkg-y', dependencies: { pedding: '1.1.0' } },
    });
    await run(helper.npminstall).expect('code', 0).end();
    await run(helper.npmupdate, [ '-w', 'pkg-x' ]).expect('code', 0).end();
    assert.equal(require(path.join(tmp, 'packages/y/node_modules/pedding/package.json')).version, '1.1.0');
    assert.equal(require(path.join(tmp, 'packages/x/node_modules/ms/package.json')).version, '2.1.3');
  });

  it('should fail when the lockfile can not be loaded', async () => {
    await writeJSON(path.join(tmp, 'package.json'), { name: 'r', version: '1.0.0', dependencies: { ms: '2.1.3' } });
    await run(helper.npminstall, [ `--lockfile-path=${path.join(tmp, 'missing-lock.json')}` ])
      .expect('code', 1)
      .expect('stderr', /load lockfile from .*missing-lock\.json error/)
      .end();
  });
});
