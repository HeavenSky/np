// 公共源自动切换: 用两个本地 registry 模拟 npmmirror 与 npmjs, 覆盖测速, 交替换源, 镜像滞后, 缓存共用与损坏缓存
'use strict';

const assert = require('assert');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs/promises');
const tar = require('tar');
const coffee = require('coffee');
const helper = require('./helper');
const mirror = require('../lib/mirror');
const { installLocal } = require('..');

async function packTarball(dir, pkg, files = {}) {
  const pkgDir = path.join(dir, 'package');
  await fs.mkdir(pkgDir, { recursive: true });
  await fs.writeFile(path.join(pkgDir, 'package.json'), JSON.stringify(pkg));
  for (const file in files) {
    await fs.mkdir(path.dirname(path.join(pkgDir, file)), { recursive: true });
    await fs.writeFile(path.join(pkgDir, file), files[file]);
  }
  const tgz = path.join(dir, `${pkg.name.replace('/', '-')}-${pkg.version}.tgz`);
  await tar.c({ gzip: true, file: tgz, cwd: dir }, ['package']);
  await fs.rm(pkgDir, { recursive: true });
  const content = await fs.readFile(tgz);
  return {
    content,
    shasum: crypto.createHash('sha1').update(content).digest('hex'),
    integrity: `sha512-${crypto.createHash('sha512').update(content).digest('base64')}`,
  };
}

// 一个本地 registry: packages 为 { name: { version: tarball } }, behavior 控制失败, 延迟与缺失版本
function createRegistry(name, log) {
  const registry = { name, packages: {}, behavior: {} };
  registry.server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url);
    if (url === '/node/index.json') {
      log.push(`${name}:probe:${url}`);
      return setTimeout(() => res.end('[]'), registry.behavior.delay || 0);
    }
    const isTarball = url.includes('/-/');
    log.push(`${name}:${isTarball ? 'tgz' : 'meta'}:${url}`);
    const behavior = registry.behavior;
    const reply = () => {
      if ((isTarball ? behavior.tarballStatus : behavior.metaStatus) || 0) {
        res.statusCode = isTarball ? behavior.tarballStatus : behavior.metaStatus;
        return res.end('error');
      }
      if (isTarball) {
        const [pkgName, file] = url.slice(1).split('/-/');
        const version = Object.keys(registry.packages[pkgName] || {}).find(v => file.endsWith(`-${v}.tgz`));
        if (!version) {
          res.statusCode = 404;
          return res.end('not found');
        }
        return res.end(registry.packages[pkgName][version].content);
      }
      const latestOnly = url.endsWith('/latest');
      const pkgName = latestOnly ? url.slice(1, -'/latest'.length) : url.slice(1);
      const versions = registry.packages[pkgName];
      if (!versions) {
        res.statusCode = 404;
        return res.end('{}');
      }
      const visible = Object.keys(versions).filter(v => !(behavior.hiddenVersions || []).includes(v));
      const manifests = {};
      for (const v of visible) {
        manifests[v] = {
          name: pkgName,
          version: v,
          dist: {
            tarball: `${registry.prefix}${pkgName}/-/${pkgName.split('/').pop()}-${v}.tgz`,
            shasum: versions[v].shasum,
            integrity: versions[v].integrity,
          },
          ...versions[v].manifest,
        };
      }
      res.setHeader('content-type', 'application/json');
      if (latestOnly) return res.end(JSON.stringify(manifests[visible[visible.length - 1]]));
      res.end(
        JSON.stringify({ name: pkgName, 'dist-tags': { latest: visible[visible.length - 1] }, versions: manifests })
      );
    };
    if (behavior.delay) setTimeout(reply, behavior.delay);
    else reply();
  });
  return registry;
}

describe('test/mirror.test.js', () => {
  const [tmp, cleanup] = helper.tmp();
  let log;
  let registries;
  let sources;

  before(async () => {
    log = [];
    registries = { mirror: createRegistry('mirror', log), official: createRegistry('official', log) };
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
    const tarball = await packTarball(tmp, pkg, files);
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
    await fs.writeFile(path.join(home, '.cnpmrc'), `@corp:registry=${sources.official.registry}`);
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
