const debug = require('node:util').debuglog('np:download:npm');
const { randomUUID } = require('node:crypto');
const { createWriteStream, createReadStream, rmSync } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const os = require('node:os');
const bytes = require('bytes');
const tar = require('tar');
const destroy = require('destroy');
const chalk = require('chalk');
const moment = require('moment');
const semver = require('semver');
const { family: getLibcFamily } = require('detect-libc');
const get = require('../get');

const { MIRROR_ATTEMPTS } = get;
const utils = require('../utils');
const config = require('../cnpm_config');

module.exports = async (pkg, options) => {
  const realPkg = await resolve(pkg.subSpec || pkg, options);
  // download tarball and unzip
  const info = await download(realPkg, options);
  info.package = realPkg;
  return info;
};

module.exports.resolve = resolve;

async function resolve(pkg, options) {
  const dependenciesTree = options.cache.dependenciesTree;
  // check cache first
  if (dependenciesTree[pkg.raw]) {
    debug('resolve hit dependencies cache: %s', pkg.raw);
    return dependenciesTree[pkg.raw];
  }

  const packageMetaKey = `npm:resolve:package:${pkg.name}`;
  let packageMeta = options.cache[packageMetaKey];
  if (!packageMeta) {
    // add a lock to make sure fetch full meta once
    packageMeta = { done: false };
    options.cache[packageMetaKey] = packageMeta;
    let err;
    try {
      const fullMeta = await getFullPackageMeta(pkg.name, options);
      Object.assign(packageMeta, fullMeta);
      packageMeta.done = true;
      packageMeta.allVersions = Object.keys(packageMeta.versions);
    } catch (e) {
      err = e;
      // clean cache
      options.cache[packageMetaKey] = null;
    }

    if (err) {
      options.events.emit(packageMetaKey, err);
      throw err;
    } else {
      options.events.emit(packageMetaKey);
    }
  } else if (!packageMeta.done) {
    debug('await %s', packageMetaKey);
    const err = await options.events.await(packageMetaKey);
    if (err) throw err;
  }

  let spec = pkg.fetchSpec;
  if (spec === '*') {
    spec = 'latest';
  }

  let distTags = packageMeta['dist-tags'];

  let realPkgVersion = utils.findMaxSatisfyingVersion(spec, distTags, packageMeta.allVersions);
  // 镜像同步滞后时新版本只在官方源上: 找不到版本时绕过缓存向官方源重拉一次
  const missing = !realPkgVersion || !packageMeta.versions[realPkgVersion];
  if (missing && _getMirror(pkg.name, options) && !packageMeta.fromOfficial) {
    try {
      const fullMeta = await getFullPackageMeta(pkg.name, options, { officialOnly: true });
      Object.assign(packageMeta, fullMeta, { fromOfficial: true, allVersions: Object.keys(fullMeta.versions) });
      distTags = packageMeta['dist-tags'];
      realPkgVersion = utils.findMaxSatisfyingVersion(spec, distTags, packageMeta.allVersions);
    } catch (err) {
      debug('[%s] refetch manifests from official registry error: %s', pkg.name, err.message);
    }
  }
  let fixDependencies;
  let fixScripts;

  if (!realPkgVersion) {
    // remove disk cache
    await removeCacheInfo(pkg.name, options);
    throw new Error(`[${pkg.displayName}] Can't find package ${pkg.name}@${pkg.rawSpec}`);
  }

  if (options.autoFixVersion) {
    const fixVersion = options.autoFixVersion(pkg.name, realPkgVersion);
    if (fixVersion) {
      if (fixVersion.version && fixVersion.version !== realPkgVersion) {
        options.console.warn(
          `[${pkg.name}@${realPkgVersion}] use ${pkg.name}@${chalk.green(fixVersion.version)} instead, reason: ${chalk.yellow(fixVersion.reason)}`
        );
        realPkgVersion = fixVersion.version;
      }
      if (fixVersion.dependencies) {
        options.console.warn(
          `[${pkg.name}@${realPkgVersion}] use dependencies: ${chalk.green(JSON.stringify(fixVersion.dependencies))} instead, reason: ${chalk.yellow(fixVersion.reason)}`
        );
        fixDependencies = fixVersion.dependencies;
      }
      // https://github.com/npm/rfcs/pull/488/files
      // merge custom scripts
      // {
      //   "foo": {
      //     "1.0.0": {
      //       "scripts": { "postinstall": "" },
      //       "reason": "some description message"
      //     }
      //   }
      // }
      if (fixVersion.scripts) {
        options.console.warn(
          `[${pkg.name}@${realPkgVersion}] use scripts: ${chalk.green(JSON.stringify(fixVersion.scripts))} instead, reason: ${chalk.yellow(fixVersion.reason)}`
        );
        fixScripts = fixVersion.scripts;
      }
    }
  }

  const realPkg = packageMeta.versions[realPkgVersion];
  if (!realPkg) {
    // remove disk cache
    await removeCacheInfo(pkg.name, options);
    throw new Error(`[${pkg.displayName}] Can't find package ${pkg.name}'s version: ${realPkgVersion}`);
  }

  if (fixDependencies) {
    realPkg.__fixDependencies = fixDependencies;
  }
  if (fixScripts) {
    realPkg.__fixScripts = fixScripts;
  }

  debug(
    '[%s@%s] spec: %s, real version: %s, dist-tags: %j',
    pkg.name,
    pkg.rawSpec,
    pkg.fetchSpec,
    realPkg.version,
    distTags
  );

  // cache resolve result
  dependenciesTree[pkg.raw] = realPkg;
  return realPkg;
}

function _getScope(name) {
  if (name[0] === '@') return name.slice(0, name.indexOf('/'));
}

// scope 单独指定 registry 时该 scope 不换源
function _getMirror(name, options) {
  const scope = _getScope(name);
  if (scope && config.get(scope + ':registry')) return null;
  return options.mirror || null;
}

async function _getCacheInfo(fullname, globalOptions, { officialOnly = false } = {}) {
  // check name has scope
  let registry = globalOptions.registry;
  const scope = _getScope(fullname);
  const scopeRegistry = scope && config.get(scope + ':registry');
  if (scopeRegistry) {
    registry = scopeRegistry;
  }
  // 换源时缓存键统一取官方源地址, 使两个源共用缓存
  const mirror = _getMirror(fullname, globalOptions);
  const info = {
    pkgUrl: utils.formatPackageUrl(mirror ? mirror.officialRegistry : registry, fullname),
    mirrorUrls: null,
    cacheFile: '',
    cache: null,
  };
  if (mirror) {
    info.mirrorUrls = officialOnly ? [info.pkgUrl] : mirror.expand(info.pkgUrl);
  }
  if (!globalOptions.cacheDir) {
    return info;
  }
  const hash = crypto.createHash('md5').update(info.pkgUrl).digest('hex');
  // hash 区分同名包在不同 registry 的 manifest, 按包名分目录便于定位与清理
  const parentDir = path.join(globalOptions.cacheDir, 'np-manifests', fullname);
  // { etag, age, headers, manifests }
  info.cacheFile = path.join(parentDir, `${hash}.json`);
  // --refresh-cache 与回官方源重拉时不读旧缓存, 拉取后覆盖写入
  const exists = !globalOptions.refreshCache && !officialOnly && (await utils.exists(info.cacheFile));
  // cache not exists
  if (!exists) {
    await utils.mkdirp(parentDir);
    return info;
  }
  // cache exists
  const cacheContent = await fs.readFile(info.cacheFile);
  try {
    info.cache = JSON.parse(cacheContent);
  } catch {
    globalOptions.console.warn('[np:download:npm] Ignore invalid cache file %s', info.cacheFile);
  }
  return info;
}

async function removeCacheInfo(fullname, globalOptions) {
  const info = await _getCacheInfo(fullname, globalOptions);
  if (info.cache) {
    await fs.rm(info.cacheFile, { force: true });
  }
}

async function getFullPackageMeta(fullname, globalOptions, fetchOptions) {
  const info = await _getCacheInfo(fullname, globalOptions, fetchOptions);
  if (globalOptions.offline && !info.cache) {
    throw new Error(`Can't find package ${fullname} manifests on offline mode`);
  }

  if (!info.cacheFile) {
    const result = await _fetchFullPackageMeta(info.pkgUrl, globalOptions, null, false, info.mirrorUrls);
    return result.data;
  }
  // cache file not exists
  if (!info.cache) {
    return await _fetchFullPackageMetaWithCache(info.pkgUrl, globalOptions, info.cacheFile, null, info.mirrorUrls);
  }
  // check is expired or not
  // offline should force to use cache manifests
  if (globalOptions.offline || info.cache.expired > Date.now()) {
    globalOptions.totalCacheJSONCount += 1;
    return info.cache.manifests;
  }
  // use etag to request
  return await _fetchFullPackageMetaWithCache(info.pkgUrl, globalOptions, info.cacheFile, info.cache, info.mirrorUrls);
}

async function _fetchFullPackageMetaWithCache(pkgUrl, globalOptions, cacheFile, cache, mirrorUrls) {
  const etag = cache && cache.etag;
  let result;
  try {
    result = await _fetchFullPackageMeta(pkgUrl, globalOptions, etag, !!cache, mirrorUrls);
  } catch (err) {
    if (cache) {
      globalOptions.console.warn('[np:download:npm] Request %s error, use cache instead', pkgUrl);
      return cache.manifests;
    }
    throw err;
  }
  // < etag: "14A082C35C551D6A94A29E064E32BDA5"
  // < cache-control: public, max-age=300
  const headers = result.headers;
  const cacheControl = headers['cache-control'];
  let maxAge = 120;
  if (cacheControl) {
    const cacheControlMatch = /max-age=(\d{1,100})/.exec(cacheControl);
    if (cacheControlMatch) {
      maxAge = parseInt(cacheControlMatch[1]);
      // >= 1min & <= 30mins
      if (maxAge > 1800) {
        maxAge = 1800;
      } else if (maxAge < 60) {
        maxAge = 60;
      }
    }
  }
  debug('GET %s with etag: %j, status: %s, maxAge: %s', pkgUrl, etag, result.status, maxAge);
  const expired = Date.now() + maxAge * 1000;
  // etag match
  if (result.status === 304) {
    cache.expired = expired;
    cache.headers = headers;
    await fs.writeFile(cacheFile, JSON.stringify(cache));
    globalOptions.totalEtagHitCount += 1;
    globalOptions.totalCacheJSONCount += 1;
    return cache.manifests;
  }
  // 200 status
  await fs.writeFile(
    cacheFile,
    JSON.stringify({
      etag: headers.etag,
      expired,
      headers,
      manifests: result.data,
    })
  );
  if (etag) {
    globalOptions.totalEtagMissCount += 1;
  }
  return result.data;
}

async function _fetchFullPackageMeta(pkgUrl, globalOptions, etag, hasCache = false, mirrorUrls = null) {
  const headers = {
    accept: 'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*',
  };
  if (etag) {
    headers['if-none-match'] = etag;
  }
  const result = await get(
    pkgUrl,
    {
      headers,
      timeout: globalOptions.timeout,
      followRedirect: true,
      gzip: true,
      dataType: 'json',
      mirrorUrls,
    },
    globalOptions,
    hasCache
  );
  if (result.status === 200) {
    globalOptions.totalJSONSize += result.res.size;
    globalOptions.totalJSONCount += 1;
  }
  return result;
}

async function download(pkg, options) {
  // don't download pkg in not matched os
  if (!utils.matchPlatform(process.platform, pkg.os)) {
    const errMsg = `[${pkg.name}@${pkg.version}] skip download for reason ${pkg.os.join(', ')} dont includes your platform ${process.platform}`;
    const err = new Error(errMsg);
    err.name = 'UnSupportedPlatformError';
    throw err;
  }
  // don't download pkg in not matched cpu
  if (!utils.matchPlatform(process.arch, pkg.cpu)) {
    const errMsg = `[${pkg.name}@${pkg.version}] skip download for reason ${pkg.cpu.join(', ')} dont includes your arch ${process.arch}`;
    const err = new Error(errMsg);
    err.name = 'UnSupportedPlatformError';
    throw err;
  }
  // don't download pkg in not matched libc
  if (Array.isArray(pkg.libc)) {
    const currentLibc = await getLibcFamily();
    if (currentLibc && !utils.matchPlatform(currentLibc, pkg.libc)) {
      const errMsg = `[${pkg.name}@${pkg.version}] skip download for reason ${pkg.libc.join(', ')} dont includes your libc ${currentLibc}`;
      const err = new Error(errMsg);
      err.name = 'UnSupportedPlatformError';
      throw err;
    }
  }

  const ungzipDir = options.ungzipDir || utils.getPackageStorePath(options.storeDir, pkg, options);

  // make sure only one download for a version
  const key = `download:${pkg.name}@${pkg.version}`;
  if (options.cache[key]) {
    // wait download finish
    if (!options.cache[key].done) {
      const err = await options.events.await(key);
      if (err) {
        throw err;
      }
    }
    return {
      exists: true,
      dir: ungzipDir,
    };
  }
  options.cache[key] = {
    done: false,
  };

  if (await utils.isInstallDone(ungzipDir)) {
    options.cache[key].done = true;
    options.events.emit(key);
    // debug('[%s@%s] Exists', pkg.name, pkg.version);
    return {
      exists: true,
      dir: ungzipDir,
    };
  }

  await utils.mkdirp(ungzipDir);

  // download tar and unzip
  let lastErr;
  let count = 0;
  const pkgMirror = _getMirror(pkg.name, options);
  const mirrorUrls = pkgMirror && pkgMirror.expand(pkg.dist.tarball);
  const tarballUrls = mirrorUrls || utils.parseTarballUrls(pkg.dist.tarball);
  const maxCount = mirrorUrls ? MIRROR_ATTEMPTS : 3;
  let tarballUrlIndex = 0;
  let tarballUrl;
  while (count < maxCount) {
    tarballUrl = tarballUrls[tarballUrlIndex++];
    if (!tarballUrl) {
      tarballUrlIndex = 1;
      tarballUrl = tarballUrls[0];
    }
    let stream;
    try {
      stream = await getTarballStream(tarballUrl, pkg, options, !!mirrorUrls);
      let useTarFormat = false;
      if (count === 1 && lastErr && lastErr.code === 'Z_DATA_ERROR') {
        options.console.warn(`[${pkg.name}@${pkg.version}] format ungzip error, try to use tar format`);
        useTarFormat = true;
      }
      await checkShasumAndUngzip(ungzipDir, stream, pkg, useTarFormat);
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      count++;
      options.console.warn(
        `[${pkg.name}@${pkg.version}] download %s %s: %s, fail count: %s`,
        tarballUrl,
        err.name,
        err.message,
        count
      );
      // 缓存中的 tgz 校验或解压失败时删除, 否则之后每次重试都读到同一个损坏文件
      if (stream && stream.tarballFile) {
        await fs.rm(stream.tarballFile, { force: true });
      }
      // retry download on any error
      // 换到下一个地址时直接重试, 所有地址都试过一轮才等待
      if (count < maxCount && tarballUrlIndex >= tarballUrls.length) {
        await utils.sleep(count * 500);
      }
    }
  }
  if (lastErr) {
    options.events.emit(key, lastErr);
    throw lastErr;
  }

  // read package.json to merge into realPkg
  const fullMeta = await utils.readPackageJSON(ungzipDir);
  Object.assign(pkg, fullMeta);
  if (pkg.__fixDependencies) {
    pkg.dependencies = Object.assign({}, pkg.dependencies, pkg.__fixDependencies);
  }
  if (pkg.__fixScripts) {
    pkg.scripts = Object.assign({}, pkg.scripts, pkg.__fixScripts);
  }

  await utils.setInstallDone(ungzipDir);

  const pkgMeta = {
    _from: `${pkg.name}@${pkg.version}`,
    _resolved: pkg.dist.tarball,
  };
  const binaryMirror = options.binaryMirrors[pkg.name];
  if (binaryMirror) {
    if (options.mirror) {
      // 记下改写前的内容, 安装脚本失败换源重试时据此在镜像与官方地址之间切换
      options.mirror.binaryPackages.set(ungzipDir, await snapshotBinaryFiles(pkg, ungzipDir, binaryMirror));
    }
    if (!options.mirror || options.mirror.binaryOrder[0] === 'mirror') {
      await applyBinaryMirror(pkg, ungzipDir, binaryMirror, pkgMeta, options);
    }
  }

  if (pkg.name === 'node-pre-gyp') {
    // ignore https protocol check on: lib/util/versioning.js
    const versioningFile = path.join(ungzipDir, 'lib/util/versioning.js');
    if (await utils.exists(versioningFile)) {
      let content = await fs.readFile(versioningFile, 'utf-8');
      content = content.replace("if (protocol === 'http:') {", "if (false && protocol === 'http:') { // hack by np");
      await fs.writeFile(versioningFile, content);
    }
  }

  await utils.addMetaToJSONFile(path.join(ungzipDir, 'package.json'), pkgMeta);

  options.cache[key].done = true;
  options.events.emit(key);
  options.registryPackages++;

  return {
    exists: false,
    dir: ungzipDir,
  };
}

async function getTarballStream(tarballUrl, pkg, options, mirrored = false) {
  // 只改写首个请求地址: urllib 3 不支持 formatRedirectUrl, 重定向后的地址无法再按 mapping 改写
  if (options.formatNpmTarballUrl) {
    tarballUrl = options.formatNpmTarballUrl(tarballUrl);
  }

  // 公共源地址由 download 的外层循环换源重试, 这里不再原地重试
  const retry = mirrored ? 1 : undefined;

  if (!options.cacheDir || utils.isSudo()) {
    // sudo don't touch the cacheDir
    // production mode
    debug('[%s@%s] GET streaming %j', pkg.name, pkg.version, tarballUrl);
    const result = await get(
      tarballUrl,
      {
        timeout: options.streamingTimeout || options.timeout,
        followRedirect: true,
        retry,
        streaming: true,
      },
      options
    );

    if (result.status !== 200) {
      try {
        destroy(result.res);
      } catch (err) {
        options.console.warn('[np:download:npm] ignore destroy response stream error: %s', err);
      }
      throw new Error(`Download ${tarballUrl} status: ${result.status} error, should be 200`);
    }

    // record size
    result.res.on('data', chunk => {
      options.totalTarballSize += chunk.length;
    });
    result.res.tarballUrl = tarballUrl;
    return result.res;
  }

  // multi process problems
  let name = pkg.name;
  if (name[0] === '@') {
    name = name.split('/')[1];
  }
  const parentDir = path.join(options.cacheDir, 'np-tgz', pkg.name);
  const tarballFile = path.join(parentDir, `${pkg.version}-${pkg.dist.shasum}.tgz`);
  // --refresh-cache 时忽略已有缓存, 下载后覆盖
  let exists = !options.refreshCache && (await utils.exists(tarballFile));
  if (!exists) {
    const tmpDir = path.join(options.cacheDir, 'np-tmp', moment().format('YYYYMMDD'));
    await utils.mkdirp(parentDir);
    await utils.mkdirp(tmpDir);
    const tmpFile = path.join(tmpDir, `${name}-${pkg.version}-${randomUUID()}.tgz`);
    const result = await get(
      tarballUrl,
      {
        timeout: options.streamingTimeout || options.timeout,
        followRedirect: true,
        retry,
        writeStream: createWriteStream(tmpFile),
      },
      options
    );

    if (result.status !== 200) {
      throw new Error(`Download ${tarballUrl} status: ${result.status} error, should be 200`);
    }
    // make sure tarball file is not exists again
    exists = !options.refreshCache && (await utils.exists(tarballFile));
    if (!exists) {
      try {
        await fs.rename(tmpFile, tarballFile);
      } catch (err) {
        if (err.code === 'EPERM') {
          // Error: EPERM: operation not permitted, rename
          exists = await utils.exists(tarballFile);
          if (exists) {
            // parallel execution case same file exists, ignore rename error
            // clean tmpFile
            await fs.rm(tmpFile, { force: true });
          } else {
            // rename error
            throw err;
          }
        } else {
          // rename error
          throw err;
        }
      }
    } else {
      // clean tmpFile
      await fs.rm(tmpFile, { force: true });
    }
    const stat = await fs.stat(tarballFile);
    debug('[%s@%s] saved %s %s => %s', pkg.name, pkg.version, bytes(stat.size), tarballUrl, tarballFile);
    options.totalTarballSize += stat.size;
  }

  const stream = createReadStream(tarballFile);
  stream.tarballFile = tarballFile;
  stream.tarballUrl = tarballUrl;
  return stream;
}

function checkShasumAndUngzip(ungzipDir, readstream, pkg, useTarFormat) {
  return new Promise((resolve, reject) => {
    const shasum = pkg.dist.shasum;
    const integrity = pkg.dist.integrity;
    const algorithmType = pkg.dist.checkSSRI ? 'sha512' : 'sha1';
    const hash = crypto.createHash(algorithmType);
    let tarballSize = 0;
    const opts = {
      cwd: ungzipDir,
      strip: 1,
      onentry(entry) {
        if (entry.type.toLowerCase() === 'file') {
          /* eslint-disable no-bitwise */
          entry.mode = (entry.mode || 0) | 0o644;
        }
        if (entry.type.toLowerCase() === 'directory') {
          /* eslint-disable no-bitwise */
          entry.mode = (entry.mode || 0) | 0o755;
        }
      },
    };
    const extracter = tar.extract(opts);

    let isEnd = false;
    function handleCallback(err) {
      if (isEnd) return;
      isEnd = true;
      if (err) {
        // make sure readstream will be destroy
        destroy(readstream);
        err.message += ` (${pkg.name}@${pkg.version})`;
        if (readstream.tarballFile && utils.existsSync(readstream.tarballFile)) {
          err.message += ` (${readstream.tarballFile})`;
          debug('[%s@%s] remove tarball file: %s, because %s', pkg.name, pkg.version, readstream.tarballFile, err);
          // remove tarball cache file
          rmSync(readstream.tarballFile, { force: true });
        }
        return reject(err);
      }
      resolve();
    }

    readstream.on('data', buf => {
      tarballSize += buf.length;
      hash.update(buf);
    });
    readstream.on('end', () => {
      // this will be fire before extracter `env` event fire.
      let hashResult = '';
      let hashString = '';
      if (pkg.dist.checkSSRI) {
        hashResult = algorithmType + '-' + hash.digest('base64');
        hashString = integrity;
      } else {
        hashResult = hash.digest('hex');
        hashString = shasum;
      }
      if (hashResult !== hashString) {
        const err = new Error(
          `real ${algorithmType}:${hashResult} not equal to remote:${hashString}, download url ${readstream.tarballUrl || ''}, download size ${tarballSize}`
        );
        err.name = 'ShasumNotMatchError';
        handleCallback(err);
      }
    });

    extracter.on('end', handleCallback);
    readstream.on('error', handleCallback);
    extracter.on('error', handleCallback);

    if (useTarFormat) {
      readstream.pipe(extracter);
    } else {
      const gunzip = zlib.createGunzip();
      gunzip.on('error', handleCallback);
      readstream.pipe(gunzip).pipe(extracter);
    }
  });
}

// 把包内的二进制下载地址改写为镜像: node-pre-gyp 类写入 pkgMeta.binary, 其余直接改写包内文件
async function applyBinaryMirror(pkg, ungzipDir, binaryMirror, pkgMeta, options) {
  // node-pre-gyp
  if (pkg.scripts && pkg.scripts.install && !binaryMirror.replaceHostFiles) {
    // leveldown and sqlite3
    // nodegit
    if (
      /prebuild --install/.test(pkg.scripts.install) ||
      /prebuild --download/.test(pkg.scripts.install) ||
      /node-pre-gyp install/.test(pkg.scripts.install) ||
      // utf-8-validate
      /prebuild-install || node-gyp rebuild/.test(pkg.scripts.install) ||
      pkg.name === 'nodegit' ||
      pkg.name === 'fsevents'
    ) {
      const newBinary = Object.assign({}, pkg.binary);
      for (const key in binaryMirror) {
        newBinary[key] = binaryMirror[key];
      }
      pkgMeta.binary = newBinary;
      // ignore https protocol check on: node_modules/node-pre-gyp/lib/util/versioning.js
      if (/node-pre-gyp install/.test(pkg.scripts.install)) {
        const versioningFile = path.join(ungzipDir, 'node_modules/node-pre-gyp/lib/util/versioning.js');
        if (await utils.exists(versioningFile)) {
          let content = await fs.readFile(versioningFile, 'utf-8');
          content = content.replace(
            "if (protocol === 'http:') {",
            "if (false && protocol === 'http:') { // hack by np"
          );
          await fs.writeFile(versioningFile, content);
        }
      }
      options.console.info('%s download from binary mirror: %j', chalk.gray(`${pkg.name}@${pkg.version}`), newBinary);
    }
  } else if (
    (binaryMirror.replaceHost && binaryMirror.host) ||
    binaryMirror.replaceHostMap ||
    binaryMirror.replaceHostRegExpMap
  ) {
    // use mirror url instead
    // e.g.: pngquant-bin
    // https://github.com/lovell/sharp/blob/master/install/libvips.js#L19
    const replaceHostFiles = binaryMirror.replaceHostFiles || ['lib/index.js', 'lib/install.js'];
    for (const replaceHostFile of replaceHostFiles) {
      const replaceHostFilePath = path.join(ungzipDir, replaceHostFile);
      await replaceHostInFile(pkg, replaceHostFilePath, binaryMirror, options);
    }
  }

  // replace cypress download url
  // https://github.com/cypress-io/cypress/blob/master/cli/lib/tasks/download.js#L30
  if (pkg.name === 'cypress') {
    const defaultPlatforms = {
      darwin: 'osx64',
      linux: 'linux64',
      win32: 'win64',
    };
    let platforms = binaryMirror.platforms || defaultPlatforms;
    // version >= 3.3.0 should use binaryMirror.newPlatforms by default, other use defaultPlatforms
    if (binaryMirror.newPlatforms && semver.gte(pkg.version, '3.3.0')) {
      platforms = binaryMirror.newPlatforms;
    }
    const targetPlatform = platforms[os.platform()];
    if (targetPlatform) {
      options.console.info(
        '%s download from binary mirror: %j, targetPlatform: %s',
        chalk.gray(`${pkg.name}@${pkg.version}`),
        binaryMirror,
        targetPlatform
      );
      const downloadFile = path.join(ungzipDir, 'lib/tasks/download.js');
      if (await utils.exists(downloadFile)) {
        let content = await fs.readFile(downloadFile, 'utf-8');
        // return version ? prepend('desktop/' + version) : prepend('desktop');
        const afterContent =
          'return "' + binaryMirror.host + '/" + version + "/' + targetPlatform + '/cypress.zip"; // hack by np\n';
        content = content
          .replace("return version ? prepend(`desktop/${version}`) : prepend('desktop')", afterContent)
          .replace("return version ? prepend('desktop/' + version) : prepend('desktop');", afterContent);
        await fs.writeFile(downloadFile, content);
      }
    }
  } else if (pkg.name === 'vscode') {
    // https://github.com/Microsoft/vscode-extension-vscode/blob/master/bin/install#L64
    const indexFilepath = path.join(ungzipDir, 'bin/install');
    await replaceHostInFile(pkg, indexFilepath, binaryMirror, options);
  }
}

function binaryMirrorFiles(pkg, binaryMirror) {
  const files = [...(binaryMirror.replaceHostFiles || ['lib/index.js', 'lib/install.js'])];
  if (pkg.name === 'cypress') files.push('lib/tasks/download.js');
  if (pkg.name === 'vscode') files.push('bin/install');
  return files;
}

async function snapshotBinaryFiles(pkg, ungzipDir, binaryMirror) {
  const files = {};
  for (const file of binaryMirrorFiles(pkg, binaryMirror)) {
    const filepath = path.join(ungzipDir, file);
    if (await utils.exists(filepath)) files[filepath] = await fs.readFile(filepath);
  }
  return { pkg, binaryMirror, binary: pkg.binary && JSON.parse(JSON.stringify(pkg.binary)), files };
}

// 安装脚本换源重试前调用: official 还原改写前的文件与 binary 字段, mirror 在还原后重新改写
module.exports.useBinarySource = async (ungzipDir, source, options) => {
  const snapshot = options.mirror && options.mirror.binaryPackages.get(ungzipDir);
  if (!snapshot) return;
  for (const filepath in snapshot.files) {
    await fs.writeFile(filepath, snapshot.files[filepath]);
  }
  const pkgMeta = { binary: snapshot.binary };
  if (source === 'mirror') {
    await applyBinaryMirror(snapshot.pkg, ungzipDir, snapshot.binaryMirror, pkgMeta, options);
  }
  await utils.addMetaToJSONFile(path.join(ungzipDir, 'package.json'), pkgMeta);
};

async function replaceHostInFile(pkg, filepath, binaryMirror, globalOptions) {
  const exists = await utils.exists(filepath);
  if (!exists) {
    return;
  }

  let content = await fs.readFile(filepath, 'utf8');
  let replaceHostMap;
  // support RegExp string
  if (binaryMirror.replaceHostRegExpMap) {
    replaceHostMap = binaryMirror.replaceHostRegExpMap;
    for (const replaceHost in replaceHostMap) {
      const replaceAllRE = new RegExp(replaceHost, 'g');
      const targetHost = replaceHostMap[replaceHost];
      debug('replace %j(%s) => %s', replaceHost, replaceAllRE, targetHost);
      content = content.replace(replaceAllRE, targetHost);
    }
  } else {
    replaceHostMap = binaryMirror.replaceHostMap;
    if (!replaceHostMap) {
      let replaceHosts = binaryMirror.replaceHost;
      if (!Array.isArray(replaceHosts)) {
        replaceHosts = [replaceHosts];
      }
      replaceHostMap = {};
      for (const replaceHost of replaceHosts) {
        replaceHostMap[replaceHost] = binaryMirror.host;
      }
    }
    for (const replaceHost in replaceHostMap) {
      content = content.replace(replaceHost, replaceHostMap[replaceHost]);
    }
  }
  debug('%s: \n%s', filepath, content);
  await fs.writeFile(filepath, content);
  globalOptions.console.info(
    '%s download from mirrors: %j, changed file: %s',
    chalk.gray(`${pkg.name}@${pkg.version}`),
    replaceHostMap,
    filepath
  );
}
