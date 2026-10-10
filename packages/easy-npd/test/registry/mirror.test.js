// 公共源自动切换: 用 4 个本地 registry 模拟公共源, 覆盖测速取前 3, 逐个换源, 镜像滞后, 缓存共用与损坏缓存
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs/promises');
const coffee = require('coffee');
const helper = require('../support/helper');
const mirror = require('../../lib/mirror');
const allowScripts = require('../../lib/allow_scripts');
const { installLocal } = require('../..');

describe('test/registry/mirror.test.js', () => {
  const [tmp, cleanup] = helper.tmp();
  let log;
  let registries;
  let sources;
  let binarySources;

  before(async () => {
    log = [];
    registries = {};
    sources = {};
    for (const name of ['npm', 'yarn', 'alibaba', 'tencent']) {
      const registry = (registries[name] = helper.createRegistry(name, log));
      await new Promise(resolve => registry.server.listen(0, '127.0.0.1', resolve));
      registry.prefix = `http://127.0.0.1:${registry.server.address().port}/`;
      sources[name] = {
        registry: registry.prefix.slice(0, -1),
        prefixes: [registry.prefix],
        binary: name === 'npm' || name === 'yarn' ? 'official' : 'mirror',
      };
    }
    binarySources = {
      mirror: `${registries.alibaba.prefix}node/index.json`,
      official: `${registries.npm.prefix}node/index.json`,
    };
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

  function install(pkgs, { order = ['alibaba', 'npm', 'yarn'], binaryOrder = ['mirror', 'official'], extra } = {}) {
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

  const probe = options => mirror.probe({ sources, binarySources, globalOptions: { console: { warn() {} } }, ...options });
  const delays = values => {
    for (const name in values) registries[name].behavior.delay = values[name];
  };

  it('should expand only urls of known sources', () => {
    const state = mirror.create({ order: ['npm', 'alibaba', 'huawei'], binaryOrder: ['official', 'mirror'] });
    assert.deepEqual(state.expand('https://registry.npmmirror.com/a/-/a-1.0.0.tgz'), [
      'https://registry.npmjs.org/a/-/a-1.0.0.tgz',
      'https://registry.npmmirror.com/a/-/a-1.0.0.tgz',
      'https://mirrors.huaweicloud.com/repository/npm/a/-/a-1.0.0.tgz',
    ]);
    assert.equal(state.expand('https://npm.corp.local/a/-/a-1.0.0.tgz'), null);
    assert.equal(mirror.sourceOf('https://registry.npmjs.com'), 'npm');
    assert.equal(mirror.sourceOf('https://registry.yarnpkg.com'), 'yarn');
    assert.equal(mirror.sourceOf('https://mirrors.cloud.tencent.com/npm/'), 'tencent');
    assert.equal(mirror.sourceOf('https://repo.huaweicloud.com/repository/npm'), 'huawei');
    assert.equal(mirror.sourceOf('https://npm.corp.local'), null);
  });

  it('should keep the TOP fastest sources in probe order', async () => {
    await publish({ name: 'binary-mirror-config', version: '1.0.0' });
    delays({ yarn: 0, npm: 200, tencent: 400, alibaba: 800 });
    const probed = await probe();
    assert.deepEqual(probed.order, ['yarn', 'npm', 'tencent']);
    assert.deepEqual(probed.binaryOrder, ['official', 'mirror']);
  });

  it('should put the preferred source first and rank the rest by probing', async () => {
    await publish({ name: 'binary-mirror-config', version: '1.0.0' });
    delays({ yarn: 0, npm: 200, tencent: 400, alibaba: 800 });
    const probed = await probe({ prefer: 'alibaba' });
    assert.deepEqual(probed.order, ['alibaba', 'yarn', 'npm']);
    assert.deepEqual(probed.binaryOrder, ['mirror', 'official']);
  });

  it('should fill up with the defined order when fewer sources respond', async () => {
    await publish({ name: 'binary-mirror-config', version: '1.0.0' }, {}, { only: ['tencent'] });
    const probed = await probe();
    assert.deepEqual(probed.order, ['tencent', 'npm', 'yarn']);
  });

  it('should order sources by definition without probing', () => {
    assert.deepEqual(mirror.defaultOrder(), { order: ['npm', 'yarn', 'alibaba'], binaryOrder: ['official', 'mirror'] });
    assert.deepEqual(mirror.defaultOrder({ prefer: 'huawei' }), {
      order: ['huawei', 'npm', 'yarn'],
      binaryOrder: ['mirror', 'official'],
    });
  });

  it('should reuse the probe result within cacheMinutes', async () => {
    await publish({ name: 'binary-mirror-config', version: '1.0.0' });
    const cacheDir = path.join(tmp, 'probe-cache');
    delays({ alibaba: 500 });
    const first = await probe({ cacheDir, cacheMinutes: 5 });
    assert(!first.order.includes('alibaba'), first.order.join(','));
    assert(!first.cached);

    delays({ alibaba: 0, npm: 500, yarn: 500, tencent: 500 });
    const second = await probe({ cacheDir, cacheMinutes: 5 });
    assert.deepEqual(second.order, first.order);
    assert(second.cached);

    // 指定源不同或缓存分钟数为 0 时重新测速
    const preferred = await probe({ cacheDir, cacheMinutes: 5, prefer: 'npm' });
    assert(!preferred.cached);
    const fresh = await probe({ cacheDir, cacheMinutes: 0 });
    assert.equal(fresh.order[0], 'alibaba');
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
    registries.alibaba.behavior.tarballStatus = 500;
    await install([{ name: 'foo', version: '1.0.0' }]);
    assert(await fs.stat(path.join(tmp, 'root/node_modules/foo/package.json')));
    assert.deepEqual(tgzLog(), ['alibaba', 'npm']);
  });

  it('should try the TOP sources twice in turn and then fail', async () => {
    await publish({ name: 'foo', version: '1.0.0' });
    for (const name in registries) registries[name].behavior.tarballStatus = 500;
    await assert.rejects(install([{ name: 'foo', version: '1.0.0' }]), /500/);
    assert.deepEqual(tgzLog(), ['alibaba', 'npm', 'yarn', 'alibaba', 'npm', 'yarn']);
  });

  it('should fetch manifests from the other source when the first one fails', async () => {
    await publish({ name: 'foo', version: '1.0.0' });
    registries.alibaba.behavior.metaStatus = 502;
    await install([{ name: 'foo', version: '1.0.0' }]);
    assert.deepEqual(
      log.filter(line => line.includes(':meta:')).map(line => line.split(':')[0]),
      ['alibaba', 'npm']
    );
  });

  it('should refetch manifests from official when the mirror lags behind', async () => {
    await publish({ name: 'foo', version: '1.0.0' });
    await publish({ name: 'foo', version: '1.0.1' });
    registries.alibaba.behavior.hiddenVersions = ['1.0.1'];
    await install([{ name: 'foo', version: '1.0.1' }]);
    const pkg = JSON.parse(await fs.readFile(path.join(tmp, 'root/node_modules/foo/package.json')));
    assert.equal(pkg.version, '1.0.1');
  });

  it('should share the manifest cache between sources', async () => {
    await publish({ name: 'foo', version: '1.0.0' });
    await install([{ name: 'foo', version: '1.0.0' }], { order: ['alibaba', 'npm', 'yarn'] });
    await fs.rm(path.join(tmp, 'root/node_modules'), { recursive: true });
    log.length = 0;
    await install([{ name: 'foo', version: '1.0.0' }], { order: ['npm', 'yarn', 'alibaba'] });
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
      ['alibaba:meta', 'alibaba:tgz']
    );
  });

  it('should not switch sources for a scope with its own registry', async () => {
    await publish({ name: '@corp/foo', version: '1.0.0' }, {}, { only: ['npm'] });
    const home = path.join(tmp, 'home');
    await fs.mkdir(home, { recursive: true });
    await fs.writeFile(path.join(home, '.nprc'), `@corp:registry=${sources.npm.registry}`);
    const args = {
      root: path.join(tmp, 'root'),
      pkgs: [{ name: '@corp/foo', version: '1.0.0' }],
      order: ['alibaba', 'npm', 'yarn'],
      sources,
      cacheDir: path.join(tmp, 'cache'),
    };
    await coffee
      .fork(path.join(__dirname, '../support/mirror-install.js'), [JSON.stringify(args)], {
        env: { ...process.env, HOME: home, USERPROFILE: home },
      })
      .debug()
      .expect('code', 0)
      .end();
    assert(log.length > 0 && log.every(line => line.startsWith('npm:')), log.join(', '));
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
