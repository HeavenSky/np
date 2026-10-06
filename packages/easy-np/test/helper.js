const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const tar = require('tar');
const { randomUUID } = crypto;
const { rimraf, mkdirp } = require('../lib/utils');

const fixtures = path.join(__dirname, 'fixtures');

exports.cleanup = (...dirs) => {
  return async () => {
    await Promise.all(dirs.map(dir => rimraf(path.join(dir, 'node_modules'))));
  };
};

exports.fixtures = name => {
  return path.join(fixtures, name);
};

exports.tmp = name => {
  const dir = exports.fixtures(name || `.tmp_${randomUUID()}`);
  const cleanup = async () => {
    try {
      // avoid Error: ENOTEMPTY: directory not empty, rmdir
      await rimraf(dir);
    } catch {
      // ignore error
    }
    await mkdirp(dir);
  };
  return [dir, cleanup];
};

exports.npminstall = path.join(__dirname, '..', 'bin', 'i.js');
// 子命令用法: coffee.fork(helper.x, ['uninstall', ...args])
exports.x = path.join(__dirname, '..', 'bin', 'x.js');

exports.readJSON = require('../lib/utils').readJSON;

exports.packTarball = async function packTarball(dir, pkg, files = {}) {
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
};

// 一个本地 registry: packages 为 { name: { version: tarball } }, behavior 控制失败, 延迟与缺失版本
exports.createRegistry = function createRegistry(name, log) {
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
};
