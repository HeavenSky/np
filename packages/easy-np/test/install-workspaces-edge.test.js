// workspace 场景的边界行为回归: 全局安装, lockfile, update, 排序, 版本校验, peer 校验, 卸载清理
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs/promises');
const coffee = require('coffee');
const helper = require('./helper');

describe('test/install-workspaces-edge.test.js', () => {
  const [tmp, cleanup] = helper.tmp();

  beforeEach(cleanup);
  afterEach(cleanup);

  async function writeJSON(file, data) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(data));
  }

  async function exists(file) {
    try {
      await fs.lstat(file);
      return true;
    } catch {
      return false;
    }
  }

  function run(bin, args = []) {
    return coffee.fork(bin, args, { cwd: tmp }).debug();
  }

  async function workspace(packages, rootPkg = {}) {
    await writeJSON(path.join(tmp, 'package.json'), {
      name: 'root',
      version: '1.0.0',
      private: true,
      workspaces: Object.keys(packages),
      ...rootPkg,
    });
    for (const [dir, pkg] of Object.entries(packages)) {
      await writeJSON(path.join(tmp, dir, 'package.json'), { version: '1.0.0', ...pkg });
    }
  }

  it('should not touch local node_modules on global install', async () => {
    await workspace({ 'packages/a': { name: 'pkg-a' } });
    await fs.mkdir(path.join(tmp, 'node_modules/pkg-a'), { recursive: true });
    await fs.writeFile(path.join(tmp, 'node_modules/pkg-a/marker.txt'), 'keep');
    await run(helper.npminstall, ['-g', 'ms@2.1.3', `--prefix=${path.join(tmp, 'gprefix')}`])
      .expect('code', 0)
      .end();
    assert.equal(await fs.readFile(path.join(tmp, 'node_modules/pkg-a/marker.txt'), 'utf8'), 'keep');
  });

  it('should reject --lockfile-path in workspaces', async () => {
    await workspace({ 'packages/a': { name: 'pkg-a', dependencies: { ms: '^2.0.0' } } });
    await writeJSON(path.join(tmp, 'package-lock.json'), { lockfileVersion: 3, packages: {} });
    await run(helper.npminstall, [`--lockfile-path=${path.join(tmp, 'package-lock.json')}`])
      .expect('code', 1)
      .expect('stderr', /--lockfile-path is not supported with npm workspaces/)
      .end();
  });

  it('should keep other workspaces working after np-x update -w', async () => {
    await workspace({
      'packages/x': { name: 'pkg-x', dependencies: { ms: '2.1.3' } },
      'packages/y': { name: 'pkg-y', dependencies: { pedding: '1.1.0' } },
    });
    await run(helper.npminstall).expect('code', 0).end();
    await run(helper.x, ['update', '-w', 'pkg-x']).expect('code', 0).end();
    assert.equal(require(path.join(tmp, 'packages/y/node_modules/pedding/package.json')).version, '1.1.0');
    assert.equal(require(path.join(tmp, 'packages/x/node_modules/ms/package.json')).version, '2.1.3');
  });

  describe('sortWorkspacesByDependencies', () => {
    const { sortWorkspacesByDependencies } = require('../lib/utils');
    const info = (name, deps = []) => ({
      package: { name, dependencies: Object.fromEntries(deps.map(dep => [dep, '*'])) },
    });
    const permutations = arr =>
      arr.length <= 1
        ? [arr]
        : arr.flatMap((item, i) =>
            permutations([...arr.slice(0, i), ...arr.slice(i + 1)]).map(rest => [item, ...rest])
          );

    it('should always put dependencies before dependents', () => {
      const graphs = [
        { a: ['b'], b: ['c'], c: [] },
        { a: [], b: [], c: [], d: ['a'] },
        { a: ['b', 'c'], b: ['d'], c: ['d'], d: [] },
      ];
      for (const graph of graphs) {
        for (const order of permutations(Object.keys(graph))) {
          const sorted = sortWorkspacesByDependencies(order.map(name => info(name, graph[name]))).map(
            item => item.package.name
          );
          for (const [name, deps] of Object.entries(graph)) {
            for (const dep of deps) {
              assert(sorted.indexOf(dep) < sorted.indexOf(name), `${order} => ${sorted}: ${dep} should before ${name}`);
            }
          }
        }
      }
    });

    it('should keep original order without dependencies and on cycles', () => {
      const names = infos => sortWorkspacesByDependencies(infos).map(item => item.package.name);
      assert.deepEqual(names([info('b'), info('a'), info('c')]), ['b', 'a', 'c']);
      assert.deepEqual(names([info('x'), info('a', ['b']), info('b', ['a'])]), ['x', 'a', 'b']);
    });
  });

  it('should run dependency workspace scripts first', async () => {
    const script = name => `node -e "require('fs').appendFileSync('../../order.txt', '${name}\\n')"`;
    await workspace({
      'packages/a': { name: 'pkg-a', scripts: { postinstall: script('pkg-a') } },
      'packages/b': { name: 'pkg-b', scripts: { postinstall: script('pkg-b') } },
      'packages/c': { name: 'pkg-c', scripts: { postinstall: script('pkg-c') } },
      'packages/d': { name: 'pkg-d', dependencies: { 'pkg-a': '1.0.0' }, scripts: { postinstall: script('pkg-d') } },
    });
    await run(helper.npminstall).expect('code', 0).end();
    const order = (await fs.readFile(path.join(tmp, 'order.txt'), 'utf8')).trim().split('\n');
    assert(order.indexOf('pkg-a') < order.indexOf('pkg-d'), order.join(','));
  });

  it('should link workspace: protocol dependencies to local workspaces', async () => {
    await workspace({
      'packages/a': { name: 'pkg-a', dependencies: { 'pkg-b': 'workspace:*', 'pkg-c': 'workspace:^1.0.0' } },
      'packages/b': { name: 'pkg-b' },
      'packages/c': { name: 'pkg-c' },
    });
    await run(helper.npminstall, ['-d'])
      .expect('code', 0)
      .expect('stdout', /pkg-b@\* is skipped because it resolves to the local workspace:/)
      .end();
    assert.equal(
      await fs.realpath(path.join(tmp, 'node_modules/pkg-b')),
      await fs.realpath(path.join(tmp, 'packages/b'))
    );
  });

  it('should fail when a workspace: dependency has no matching workspace', async () => {
    await workspace({ 'packages/a': { name: 'pkg-a', dependencies: { 'pkg-missing': 'workspace:*' } } });
    await run(helper.npminstall)
      .expect('code', 1)
      .expect('stderr', /pkg-missing uses the workspace: protocol but no workspace named pkg-missing was found/)
      .end();
  });

  it('should warn when a local workspace does not satisfy the declared range', async () => {
    await workspace({
      'packages/a': { name: 'pkg-a', dependencies: { 'pkg-b': '^2.0.0' } },
      'packages/b': { name: 'pkg-b' },
    });
    await run(helper.npminstall)
      .expect('code', 0)
      .expect('stderr', /workspace package pkg-b@1\.0\.0 does not satisfy \^2\.0\.0 required by packages[\\/]a/)
      .end();
  });

  describe('peerDependencies', () => {
    async function peerWorkspace(rootDependencies) {
      await writeJSON(path.join(tmp, 'vendor/c/package.json'), {
        name: 'c',
        version: '1.0.0',
        peerDependencies: { p: '^1.0.0' },
      });
      await writeJSON(path.join(tmp, 'vendor/p/package.json'), { name: 'p', version: '1.0.0' });
      await workspace(
        { 'packages/a': { name: 'pkg-a', dependencies: { c: 'file:../../vendor/c' } } },
        { dependencies: rootDependencies }
      );
    }

    it('should not warn when the peer is provided by workspace root', async () => {
      await peerWorkspace({ p: 'file:./vendor/p' });
      await run(helper.npminstall)
        .expect('code', 0)
        .notExpect('stderr', /requires a peer of p@\^1\.0\.0 but none was installed/)
        .end();
    });

    it('should still warn when the peer is missing', async () => {
      await peerWorkspace({});
      await run(helper.npminstall)
        .expect('code', 0)
        .expect('stderr', /requires a peer of p@\^1\.0\.0 but none was installed/)
        .end();
    });
  });

  describe('np-x uninstall hoisted links', () => {
    const rootLink = name => path.join(tmp, 'node_modules', name);

    it('should remove hoisted link when no workspace uses the package', async () => {
      await workspace({
        'packages/x': { name: 'pkg-x', dependencies: { pedding: '1.1.0' } },
        'packages/y': { name: 'pkg-y' },
      });
      await run(helper.npminstall, ['--dedup']).expect('code', 0).end();
      assert(await exists(rootLink('pedding')));
      await run(helper.x, ['uninstall', 'pedding', '-w', 'pkg-x']).expect('code', 0).end();
      assert(!(await exists(rootLink('pedding'))));
    });

    it('should keep hoisted link when another workspace still declares it', async () => {
      await workspace({
        'packages/x': { name: 'pkg-x', dependencies: { pedding: '1.1.0' } },
        'packages/y': { name: 'pkg-y', dependencies: { pedding: '1.1.0' } },
      });
      await run(helper.npminstall, ['--dedup']).expect('code', 0).end();
      await run(helper.x, ['uninstall', 'pedding', '-w', 'pkg-x']).expect('code', 0).end();
      assert(await exists(rootLink('pedding')));
    });

    it('should keep hoisted link when another package still depends on it', async () => {
      await workspace({
        'packages/x': { name: 'pkg-x', dependencies: { ms: '2.1.3' } },
        'packages/y': { name: 'pkg-y', dependencies: { debug: '4.4.3' } },
      });
      await run(helper.npminstall, ['--dedup']).expect('code', 0).end();
      await run(helper.x, ['uninstall', 'ms', '-w', 'pkg-x']).expect('code', 0).end();
      assert(await exists(rootLink('ms')));
    });
  });

  it('should fail when the lockfile can not be loaded', async () => {
    await writeJSON(path.join(tmp, 'package.json'), { name: 'r', version: '1.0.0', dependencies: { ms: '2.1.3' } });
    await run(helper.npminstall, [`--lockfile-path=${path.join(tmp, 'missing-lock.json')}`])
      .expect('code', 1)
      .expect('stderr', /load lockfile from .*missing-lock\.json error/)
      .end();
  });
});
