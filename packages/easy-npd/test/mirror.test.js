// 公共源自动切换: 用两个本地 registry 模拟 npmmirror 与 npmjs, 覆盖测速, 交替换源, 镜像滞后, 缓存共用与损坏缓存
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs/promises');
const coffee = require('coffee');
const helper = require('./helper');
const mirror = require('../lib/mirror');
const allowScripts = require('../lib/allow_scripts');
const { installLocal } = require('..');

describe('test/mirror.test.js', () => {
  const [tmp, cleanup] = helper.tmp();
  let log;
  let registries;
  let sources;

  before(async () => {
    log = [];
    registries = { mirror: helper.createRegistry('mirror', log), official: helper.createRegistry('official', log) };
    sources = {};
    for (const name in registries) {
      const registry = registries[name];
      await new Promise(resolve => registry.server.listen(0, '127.0.0.1', resolve));
      registry.prefix = `http://127.0.0.1:${registry.server.address().port}/`;
      sources[name] = {
        registry: registry.prefix.slice(0, -1),
        prefixes: [registry.prefix],
        binaryProbe: `${registry.prefix}node/index.json`,
      };
    }
  });

  after(async () => {
    for (const name in registries) registries[name].server.close();
  });

  beforeEach(async () => {
    await cleanup();
    await fs.mkdir(path.join(tmp, 'root'), { recursive: true });
    await fs.writeFile(path.join(tmp, 'root/package.json'), JSON.stringify({ name: 'root', version: '1.0.0' }));
    log.length = 0;
    for (const name in registries) {
      registries[name].behavior = {};
      registries[name].packages = {};
    }
  });
  afterEach(cleanup);

  async function publish(pkg, files, { manifest, only } = {}) {
    const tarball = await helper.packTarball(tmp, pkg, files);
    tarball.manifest = manifest;
    for (const name of only || Object.keys(registries)) {
      const packages = registries[name].packages;
      packages[pkg.name] = packages[pkg.name] || {};
      packages[pkg.name][pkg.version] = tarball;
    }
    return tarball;
  }

  function install(pkgs, { order = ['mirror', 'official'], binaryOrder = order, extra } = {}) {
    const state = mirror.create({ order, binaryOrder, sources, binaryEnvs: extra?.binaryEnvs });
    return installLocal({
      root: path.join(tmp, 'root'),
      pkgs,
      registry: state.registry,
      cacheDir: path.join(tmp, 'cache'),
      mirror: state,
      console: { info() {}, log() {}, warn() {}, error() {} },
      ...extra,
      binaryEnvs: undefined,
    });
  }

  const tgzLog = () => log.filter(line => line.includes(':tgz:')).map(line => line.split(':')[0]);

  it('should expand only urls of known sources', () => {
    const state = mirror.create({ order: ['official', 'mirror'], binaryOrder: ['official', 'mirror'] });
    assert.deepEqual(state.expand('https://registry.npmmirror.com/a/-/a-1.0.0.tgz'), [
      'https://registry.npmjs.org/a/-/a-1.0.0.tgz',
      'https://registry.npmmirror.com/a/-/a-1.0.0.tgz',
    ]);
    assert.equal(state.expand('https://npm.corp.local/a/-/a-1.0.0.tgz'), null);
    assert.equal(mirror.sourceOf('https://registry.npmjs.com'), 'official');
    assert.equal(mirror.sourceOf('https://npm.corp.local'), null);
  });

  it('should order sources by the first probe response', async () => {
    registries.mirror.behavior.delay = 500;
    await publish({ name: 'binary-mirror-config', version: '1.0.0' });
    const probed = await mirror.probe({ sources, globalOptions: { console: { warn() {} } } });
    assert.deepEqual(probed.order, ['official', 'mirror']);
    assert.deepEqual(probed.binaryOrder, ['official', 'mirror']);
  });

  it('should skip registry probing with a preferred source', async () => {
    registries.mirror.behavior.delay = 500;
    const probed = await mirror.probe({ prefer: 'mirror', sources, globalOptions: { console: { warn() {} } } });
    assert.deepEqual(probed.order, ['mirror', 'official']);
    assert.deepEqual(probed.binaryOrder, ['mirror', 'official']);
  });

  it('should reuse the probe result within cacheMinutes', async () => {
    await publish({ name: 'binary-mirror-config', version: '1.0.0' });
    const cacheDir = path.join(tmp, 'probe-cache');
    const probe = options => mirror.probe({ sources, globalOptions: { console: { warn() {} } }, cacheDir, ...options });
    registries.mirror.behavior.delay = 500;
    const first = await probe({ cacheMinutes: 5 });
    assert.deepEqual(first.order, ['official', 'mirror']);
    assert(!first.cached);

    registries.mirror.behavior.delay = 0;
    registries.official.behavior.delay = 500;
    const second = await probe({ cacheMinutes: 5 });
    assert.deepEqual(second.order, ['official', 'mirror']);
    assert(second.cached);

    // 指定源不同或缓存分钟数为 0 时重新测速
    const preferred = await probe({ cacheMinutes: 5, prefer: 'mirror' });
    assert(!preferred.cached);
    const fresh = await probe({ cacheMinutes: 0 });
    assert.deepEqual(fresh.order, ['mirror', 'official']);
    assert(!fresh.cached);
  });

  it('should parse probe cache minutes', () => {
    assert.equal(mirror.parseProbeCacheMinutes(undefined), 5);
    assert.equal(mirror.parseProbeCacheMinutes('0'), 0);
    assert.equal(mirror.parseProbeCacheMinutes('30'), 30);
    assert.throws(() => mirror.parseProbeCacheMinutes('-1'), /non-negative number of minutes/);
    assert.throws(() => mirror.parseProbeCacheMinutes('abc'), /non-negative number of minutes/);
  });

  it('should download tarball from the other source when the first one fails', async () => {
    await publish({ name: 'foo', version: '1.0.0' });
    registries.mirror.behavior.tarballStatus = 500;
    await install([{ name: 'foo', version: '1.0.0' }]);
    assert(await fs.stat(path.join(tmp, 'root/node_modules/foo/package.json')));
    assert.deepEqual(tgzLog(), ['mirror', 'official']);
  });

  it('should try each source twice in turn and then fail', async () => {
    await publish({ name: 'foo', version: '1.0.0' });
    registries.mirror.behavior.tarballStatus = 500;
    registries.official.behavior.tarballStatus = 500;
    await assert.rejects(install([{ name: 'foo', version: '1.0.0' }]), /500/);
    assert.deepEqual(tgzLog(), ['mirror', 'official', 'mirror', 'official']);
  });

  it('should fetch manifests from the other source when the first one fails', async () => {
    await publish({ name: 'foo', version: '1.0.0' });
    registries.mirror.behavior.metaStatus = 502;
    await install([{ name: 'foo', version: '1.0.0' }]);
    assert.deepEqual(
      log.filter(line => line.includes(':meta:')).map(line => line.split(':')[0]),
      ['mirror', 'official']
    );
  });

  it('should refetch manifests from official when the mirror lags behind', async () => {
    await publish({ name: 'foo', version: '1.0.0' });
    await publish({ name: 'foo', version: '1.0.1' });
    registries.mirror.behavior.hiddenVersions = ['1.0.1'];
    await install([{ name: 'foo', version: '1.0.1' }]);
    const pkg = JSON.parse(await fs.readFile(path.join(tmp, 'root/node_modules/foo/package.json')));
    assert.equal(pkg.version, '1.0.1');
  });

  it('should share the manifest cache between sources', async () => {
    await publish({ name: 'foo', version: '1.0.0' });
    await install([{ name: 'foo', version: '1.0.0' }], { order: ['mirror', 'official'] });
    await fs.rm(path.join(tmp, 'root/node_modules'), { recursive: true });
    log.length = 0;
    await install([{ name: 'foo', version: '1.0.0' }], { order: ['official', 'mirror'] });
    assert.deepEqual(log, []);
  });

  it('should replace a corrupted tarball in the cache', async () => {
    const tarball = await publish({ name: 'foo', version: '1.0.0' });
    const cacheFile = path.join(tmp, 'cache/np-tgz/foo', `1.0.0-${tarball.shasum}.tgz`);
    await fs.mkdir(path.dirname(cacheFile), { recursive: true });
    await fs.writeFile(cacheFile, 'broken');
    await install([{ name: 'foo', version: '1.0.0' }]);
    assert(await fs.stat(path.join(tmp, 'root/node_modules/foo/package.json')));
    assert.deepEqual(await fs.readFile(cacheFile), tarball.content);
  });

  it('should ignore and overwrite the cache with refreshCache', async () => {
    await publish({ name: 'foo', version: '1.0.0' });
    await install([{ name: 'foo', version: '1.0.0' }]);
    await fs.rm(path.join(tmp, 'root/node_modules'), { recursive: true });
    log.length = 0;
    await install([{ name: 'foo', version: '1.0.0' }], { extra: { refreshCache: true } });
    assert.deepEqual(
      log.map(line => line.split(':').slice(0, 2).join(':')),
      ['mirror:meta', 'mirror:tgz']
    );
  });

  it('should not switch sources for a scope with its own registry', async () => {
    await publish({ name: '@corp/foo', version: '1.0.0' }, {}, { only: ['official'] });
    const home = path.join(tmp, 'home');
    await fs.mkdir(home, { recursive: true });
    await fs.writeFile(path.join(home, '.nprc'), `@corp:registry=${sources.official.registry}`);
    const args = {
      root: path.join(tmp, 'root'),
      pkgs: [{ name: '@corp/foo', version: '1.0.0' }],
      order: ['mirror', 'official'],
      sources,
      cacheDir: path.join(tmp, 'cache'),
    };
    await coffee
      .fork(path.join(__dirname, 'mirror-install.js'), [JSON.stringify(args)], {
        env: { ...process.env, HOME: home, USERPROFILE: home },
      })
      .debug()
      .expect('code', 0)
      .end();
    assert(log.length > 0 && log.every(line => line.startsWith('official:')), log.join(', '));
  });

  it('should retry dependency install scripts with the other binary source', async () => {
    const script =
      "node -e \"process.exit(require('fs').readFileSync('lib/install.js', 'utf8').includes('mirror.invalid') && process.env.TEST_BINARY_ENV ? 0 : 1)\"";
    await publish(
      { name: 'bin-pkg', version: '1.0.0', scripts: { install: script } },
      { 'lib/install.js': 'const host = "https://official.invalid";' },
      { manifest: { scripts: { install: script } } }
    );
    await install([{ name: 'bin-pkg', version: '1.0.0' }], {
      order: ['mirror', 'official'],
      binaryOrder: ['official', 'mirror'],
      extra: {
        scriptPolicy: allowScripts.load({ argv: { 'allow-scripts': 'bin-pkg' } }),
        binaryEnvs: { TEST_BINARY_ENV: '1' },
        binaryMirrors: {
          'bin-pkg': {
            host: 'https://mirror.invalid',
            replaceHost: 'https://official.invalid',
            replaceHostFiles: ['lib/install.js'],
          },
        },
      },
    });
    const content = await fs.readFile(path.join(tmp, 'root/node_modules/bin-pkg/lib/install.js'), 'utf8');
    assert(content.includes('mirror.invalid'));
  });
});
