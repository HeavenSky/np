'use strict';

const debug = require('debug')('npd:utils');
const fs = require('fs/promises');
const { accessSync } = require('fs');
const path = require('path');
const cp = require('child_process');
const { promisify } = require('util');
const { parse: urlparse } = require('url');
const querystring = require('querystring');
const tar = require('tar');
const zlib = require('zlib');
const runscript = require('runscript');
const homedir = require('node-homedir');
const fse = require('fs-extra');
const destroy = require('destroy');
const normalizeData = require('normalize-package-data');
const normalizeBin = require('npm-normalize-package-bin');
const semver = require('semver');
const utility = require('utility');
const url = require('url');
const config = require('./config');
const get = require('./get');

exports.exists = async filepath => {
  try {
    await fs.access(filepath);
    return true;
  } catch {
    return false;
  }
};

// bin 入口及其可能存在的 .cmd / .ps1 shim; 主入口总是返回, 其余用 lstat 判定以覆盖失效链接
exports.listBinShims = async binPath => {
  const targets = [binPath];
  for (const ext of ['.cmd', '.ps1']) {
    try {
      await fs.lstat(`${binPath}${ext}`);
      targets.push(`${binPath}${ext}`);
    } catch {
      // 不存在则跳过
    }
  }
  return targets;
};

// 删除 pkgDir 中已安装包在 binDir 下的全部入口, 用于覆盖旧包前清掉新版本不再声明的命令与遗留的 shim
exports.removePackageBins = async (pkgDir, binDir) => {
  const pkgFile = path.join(pkgDir, 'package.json');
  if (!binDir || !(await exports.exists(pkgFile))) return;
  const { bin: bins = {} } = normalizeBin(await exports.readJSON(pkgFile));
  for (const name of Object.keys(bins)) {
    for (const target of await exports.listBinShims(path.join(binDir, name))) {
      await exports.rimraf(target);
      debug('remove old bin %s', target);
    }
  }
};

// 根依赖换版本时, 删除旧版本声明而新版本不再声明, 且确实指向旧版本目录的 bin 入口; 其他包的同名入口不动
exports.removeStaleBins = async (linkDir, newPkg, binDir) => {
  let oldDir;
  try {
    oldDir = path.resolve(path.dirname(linkDir), await fs.readlink(linkDir));
  } catch {
    return;
  }
  const pkgFile = path.join(oldDir, 'package.json');
  if (!(await exports.exists(pkgFile))) return;
  const oldPkg = await exports.readJSON(pkgFile);
  if (oldPkg.name === newPkg.name && oldPkg.version === newPkg.version) return;
  const { bin: oldBins = {} } = normalizeBin(oldPkg);
  const { bin: newBins = {} } = normalizeBin({ ...newPkg });
  const oldDirs = [oldDir];
  try {
    oldDirs.push(await fs.realpath(oldDir));
  } catch {
    // 旧目录已不存在时只按链接路径比对
  }
  const tokens = new Set();
  for (const dir of oldDirs) {
    const relative = path.relative(binDir, dir);
    for (const p of [dir, relative]) {
      tokens.add(p.split(path.sep).join('/'));
      tokens.add(p.split(path.sep).join('\\'));
    }
  }
  for (const name of Object.keys(oldBins)) {
    if (name in newBins) continue;
    for (const target of await exports.listBinShims(path.join(binDir, name))) {
      if (await binPointsTo(target, oldDirs, tokens)) {
        await exports.rimraf(target);
        debug('remove stale bin %s', target);
      }
    }
  }
};

// 软链接按解析后的路径判断, shim 文件按内容中是否出现旧包目录判断
async function binPointsTo(target, dirs, tokens) {
  let stat;
  try {
    stat = await fs.lstat(target);
  } catch {
    return false;
  }
  const inside = p => dirs.some(dir => p === dir || p.startsWith(dir + path.sep));
  if (stat.isSymbolicLink()) {
    const dest = path.resolve(path.dirname(target), await fs.readlink(target));
    if (inside(dest)) return true;
    try {
      return inside(await fs.realpath(target));
    } catch {
      return false;
    }
  }
  if (!stat.isFile() || stat.size > 64 * 1024) return false;
  const content = await fs.readFile(target, 'utf8');
  return [...tokens].some(token => content.includes(token));
}

exports.existsSync = filepath => {
  try {
    accessSync(filepath);
    return true;
  } catch {
    return false;
  }
};

exports.hasOwnProp = (target, key) => target.hasOwnProperty(key);
/**
 *
 * @param {String} filepath cwd package.json path
 * @param {String} depName dependency name
 * @description clear removed pkg info from package.json
 */
exports.pruneJSON = async (filepath, depName) => {
  const pkg = await this.readJSON(filepath);
  const depMap = {};
  const depKeys = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
  for (const key of depKeys) {
    if (pkg[key]) depMap[key] = pkg[key];
  }
  for (const dep of Object.values(depMap)) {
    if (this.hasOwnProp(dep, depName)) {
      Reflect.deleteProperty(dep, depName);
    }
  }
  await this.addMetaToJSONFile(filepath, depMap);
};

exports.readJSON = async filepath => {
  if (!(await exports.exists(filepath))) {
    return {};
  }
  const content = await fs.readFile(filepath, 'utf8');
  try {
    return JSON.parse(content.trim());
  } catch (err) {
    err.message += ` (file: ${filepath})`;
    console.error('content buffer: %j', await fs.readFile(filepath));
    throw err;
  }
};

exports.readPackageJSON = async root => {
  const pkg = await exports.readJSON(path.join(root, 'package.json'));
  normalizeData(pkg);
  return pkg;
};

const INSTALL_DONE_KEY = '__npd_done';

// 设置 pkg 安装完成的标记
exports.setInstallDone = async pkgRoot => {
  await exports.addMetaToJSONFile(path.join(pkgRoot, 'package.json'), {
    [INSTALL_DONE_KEY]: true,
  });
};

exports.unsetInstallDone = async pkgRoot => {
  await exports.addMetaToJSONFile(path.join(pkgRoot, 'package.json'), {
    [INSTALL_DONE_KEY]: false,
  });
};

// 判断 pkg 是否已经安装完成
exports.isInstallDone = async pkgRoot => {
  const pkg = await exports.readJSON(path.join(pkgRoot, 'package.json'));
  return !!pkg[INSTALL_DONE_KEY];
};

// 只认显式的 false: fetch-only 解压或安装失败留下的包; 不带标记的包可能由 npm 等其他工具装出, 不算未完成
exports.isInstallUnfinished = async pkgRoot => {
  const pkg = await exports.readJSON(path.join(pkgRoot, 'package.json'));
  return pkg[INSTALL_DONE_KEY] === false;
};

exports.addMetaToJSONFile = async (filepath, meta) => {
  await fs.chmod(filepath, '644');
  const pkg = await exports.readJSON(filepath);
  for (const key in meta) {
    pkg[key] = meta[key];
  }
  await fs.writeFile(filepath, JSON.stringify(pkg, null, 2));
};

exports.mkdirp = async dir => {
  await fs.mkdir(dir, { recursive: true });
};

exports.rimraf = async dest => {
  await fs.rm(dest, { force: true, recursive: true });
};

exports.relative = (src, dest) => {
  // Windows don't support relative path
  if (process.platform === 'win32') return src;
  return path.relative(path.dirname(dest), src);
};

exports.forceSymlink = async (src, dest, type) => {
  const relative = exports.relative(src, dest);
  type = type || 'junction';
  // cleanup dest
  try {
    const linkString = await fs.readlink(dest);
    // already linked
    if (linkString === relative) {
      return relative;
    }
  } catch {
    // ignore error, will always cleanup dest
  }

  const destDir = path.dirname(dest);
  // check if destDir is not exist
  if (!(await exports.exists(destDir))) {
    await exports.mkdirp(destDir);
  }

  await exports.rimraf(dest);
  await fs.symlink(relative, dest, type);
  return relative;
};

function setNpmPackageEnv(env, key, value) {
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') {
    env[`npm_package_${key}`] = value;
  } else if (value === null) {
    env[`npm_package_${key}`] = 'null';
  } else if (value) {
    for (const subkey in value) {
      setNpmPackageEnv(env, `${key}_${subkey}`, value[subkey]);
    }
  }
}

exports.formatPackageUrl = (registry, name) => {
  if (name[0] === '@') {
    // dont encodeURIComponent @ char, it will be 405
    // https://registry.npmjs.com/%40rstacruz%2Ftap-spec/%3E%3D4.1.1
    name = '@' + utility.encodeURIComponent(name.substring(1));
  }
  const parsed = url.parse(registry);
  if (parsed.pathname.endsWith('/')) {
    parsed.pathname += name;
  } else {
    parsed.pathname += `/${name}`;
  }
  return url.format(parsed);
};

exports.parseTarballUrls = tarball => {
  const urls = [tarball];
  const parsed = urlparse(tarball);
  const query = parsed.query && querystring.parse(parsed.query);
  if (query && query.other_urls) {
    const otherUrls = query.other_urls.split(',');
    for (const url of otherUrls) {
      urls.push(url);
    }
  }
  return urls;
};

/*
 * Runs an npm script.
 */

exports.runScript = async (pkgDir, script, options) => {
  // merge config.env <= process.env <= options.env
  const env = {};

  for (const key in config.env) {
    env[key] = config.env[key];
  }

  for (const key in process.env) {
    // ignore `Path` env on Windows
    if (/^path$/i.test(key)) {
      continue;
    }
    env[key] = process.env[key];
  }

  for (const key in options.env) {
    // ignore `Path` env on Windows
    if (/^path$/i.test(key)) {
      continue;
    }
    env[key] = options.env[key];
  }

  // set npm_package_* env from package.json
  const pkg = await exports.readJSON(path.join(pkgDir, 'package.json'));
  for (const key in pkg) {
    setNpmPackageEnv(env, key, pkg[key]);
  }

  env.PATH = [
    path.join(__dirname, '../node-gyp-bin'),
    path.join(options.root, 'node_modules', '.bin'),
    path.join(pkgDir, 'node_modules', '.bin'),
    process.env.PATH,
  ].join(path.delimiter);

  // replace `npm install xxx` to `npd xxx`
  const NPM_INSTALL_RE = /^npm (i|install) /;
  if (NPM_INSTALL_RE.test(script)) {
    const npd = path.join(__dirname, '../bin/install.js');
    const newScript = script.replace(NPM_INSTALL_RE, `${process.execPath} ${npd} `);
    options.console.info('[npd:runScript] replace %j to %j', script, newScript);
    script = newScript;
  }

  // ignore npm ls error
  // e.g.: npm ERR! extraneous: base64-js@1.1.2
  let ignoreError = false;
  if (/^npm (ls|list)$/.test(script)) {
    ignoreError = true;
  }

  try {
    return await runscript(script, {
      cwd: pkgDir,
      env,
      stdio: 'inherit',
    });
  } catch (err) {
    if (ignoreError) {
      options.console.info('[npd:runScript] ignore runscript error: %s', err);
    } else {
      throw err;
    }
  }
};

exports.getMaxRange = spec => {
  // >=1.0.0 <2.0.0
  const r = /^>=.*?<(.*?)$/.exec(spec);
  if (r) {
    return r[1];
  }
};

exports.findMaxSatisfyingVersion = (spec, distTags, allVersions) => {
  // try tag first
  let realPkgVersion = distTags[spec];

  if (!realPkgVersion) {
    const version = semver.valid(spec);
    const range = semver.validRange(spec, true);
    if (semver.satisfies(distTags.latest, spec)) {
      realPkgVersion = distTags.latest;
    } else if (version) {
      // use the valid version
      realPkgVersion = version;
    } else if (range) {
      realPkgVersion = semver.maxSatisfying(allVersions, range);
      if (realPkgVersion) {
        // try to use latest-{major} tag version on range
        // ^1.0.1 =range=> get 1.0.3 in (1.0.2, 1.0.3), but latest-1 tag is 1.0.2
        // finnaly we should use 1.0.2 on ^1.0.1
        const major = semver.major(realPkgVersion);
        if (major) {
          const latestMajorVersion = distTags[`latest-${major}`];
          if (latestMajorVersion && semver.satisfies(latestMajorVersion, spec)) {
            realPkgVersion = latestMajorVersion;
          }
        }
      }
    }
  }

  return realPkgVersion;
};

exports.getPackageStorePath = (storeDir, pkg) => {
  // name => _name@1.0.0@name
  // @scope/name => _@scope_name@1.0.0@scope/name
  // some packages need name: https://github.com/BenoitZugmeyer/eslint-plugin-html/blob/master/src/index.js#L24
  return path.join(storeDir, `_${pkg.name.replace(/\//g, '_')}@${pkg.version}@${pkg.name}`);
};

exports.unpack = (readstream, target, pkg) => {
  return new Promise((resolve, reject) => {
    const extracter = tar.extract({
      cwd: target,
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
    });
    const gunzip = zlib.createGunzip();
    const name = pkg.name || pkg.displayName || 'unknown package';

    // just support gzip tarball and nacked tarball
    readstream.on('data', function ondata(data) {
      // detect what it is.
      // Then, depending on that, we'll figure out whether it's
      // gzipped tarball or naked tarball.
      // gzipped files all start with 1f8b08
      if (data[0] === 0x1f && data[1] === 0x8b && data[2] === 0x08) {
        readstream.pipe(gunzip).pipe(extracter);
      } else {
        readstream.pipe(extracter);
      }
      // re-emit
      readstream.removeListener('data', ondata);
      readstream.emit('data', data);
    });

    extracter.on('end', handleCallback);
    readstream.on('error', handleCallback);
    gunzip.on('error', handleCallback);
    extracter.on('error', handleCallback);

    let ended = false;
    function handleCallback(err) {
      if (ended) {
        return;
      }
      ended = true;
      if (err) {
        debug(`failed to unpack ${name}: ${err}`);
        reject(err);
      } else {
        debug(`unpacked ${name}`);
        resolve();
      }
    }
  });
};

exports.copyInstall = async (src, options) => {
  // 1. make sure source folder has package.json, and package.json contains name
  // 2. get the target directory: $storeDir/${pkg.name}/${pkg.version}
  // 3. check if this package has been installed, and make sure only copy once.
  // 4. if already installed, return with exists = true
  // 5. if not installed, copy and return with exists = false
  const pkgpath = path.join(src, 'package.json');
  if (!(await exports.exists(pkgpath))) {
    throw new Error(`package.json missed(${pkgpath})`);
  }
  const realPkg = await exports.readPackageJSON(src);
  if (!realPkg.name || !realPkg.version) {
    throw new Error(`package.json must contains name and version(${pkgpath})`);
  }

  const targetdir = options.ungzipDir || exports.getPackageStorePath(options.storeDir, realPkg);
  const key = `copy:${targetdir}`;
  const result = {
    dir: targetdir,
    package: realPkg,
    exists: true,
  };

  if (options.cache[key]) {
    options.console.log('exist cache: %j %j', key, options.cache[key]);
    if (options.cache[key].done) {
      return result;
    }
    // wait copy finish
    await options.events.await(key);
    return result;
  }

  options.cache[key] = {
    done: false,
  };

  if (!(await exports.isInstallDone(targetdir))) {
    await fse.emptyDir(targetdir);
    await fse.copy(src, targetdir);
    await exports.setInstallDone(targetdir);
    result.exists = false;
  }

  options.cache[key].done = true;
  options.events.emit(key);
  return result;
};

exports.getPkgFromPaths = async (name, paths) => {
  for (const p of paths) {
    const tryPath = path.join(p, name, 'package.json');
    const pkg = await exports.readJSON(tryPath);
    if (pkg.name && pkg.version) {
      pkg.installPath = path.join(p, name);
      return pkg;
    }
  }
  return null;
};

exports.getTarballStream = async (url, options) => {
  const result = await get(
    url,
    {
      timeout: options.streamingTimeout || options.timeout,
      followRedirect: true,
      streaming: true,
    },
    options
  );

  if (result.status !== 200) {
    destroy(result.res);
    throw new Error(`Download ${url} status: ${result.status} error, should be 200`);
  }
  return result.res;
};

async function getRemotePackage(name, registry, globalOptions) {
  // 离线时直接用随包安装的同名依赖
  if (globalOptions && globalOptions.offline) {
    return require(name + '/package.json');
  }
  const registries = [registry].concat([
    'https://registry.npmmirror.com',
    'https://r.cnpmjs.org',
    'https://registry.npmjs.com',
  ]);
  let lastErr;
  let pkg;
  for (const registry of registries) {
    const binaryMirrorUrl = exports.formatPackageUrl(registry, name + '/latest');
    try {
      const res = await get(
        binaryMirrorUrl,
        {
          dataType: 'json',
          followRedirect: true,
          // don't retry
          retry: 0,
        },
        globalOptions
      );
      pkg = res.data;
      break;
    } catch (err) {
      lastErr = err;
    }
  }

  if (!pkg || process.env.NPD_TEST_LOCAL_PKG) {
    console.warn('Get /%s/latest from %s error: %s', name, registry, lastErr && lastErr.stack);
    pkg = require(name + '/package.json');
  }
  return pkg;
}

exports.getBinaryMirrors = async (registry, globalOptions) => {
  const pkg = await getRemotePackage('binary-mirror-config', registry, globalOptions);
  return pkg.mirrors.china;
};

exports.getBugVersions = async (registry, globalOptions) => {
  const pkg = await getRemotePackage('bug-versions', registry, globalOptions);
  return pkg.config['bug-versions'];
};

// match platform, arch or libc
// see https://docs.npmjs.com/cli/v7/configuring-npm/package-json#os
exports.matchPlatform = (current, osNames) => {
  if (!Array.isArray(osNames) || osNames.length === 0) {
    return true;
  }
  let hasAnti = false;
  for (const name of osNames) {
    if (name === current) {
      return true;
    }
    if (name[0] === '!') {
      hasAnti = true;
      if (name.substring(1) === current) {
        return false;
      }
    }
  }
  return hasAnti;
};

exports.isSudo = () => {
  const effectiveUser = process.env.USER;
  const actualUser = process.env.SUDO_USER || process.env.USER;
  return effectiveUser === 'root' && actualUser !== 'root';
};

exports.sleep = ms => {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
};

exports.formatPath = pathname => {
  if (pathname[0] === '~') {
    // convert '~/foo/path' => '$HOME/foo/path'
    pathname = homedir() + pathname.substring(1);
  }
  return pathname;
};

exports.fork = (moduleFile, args, options) => {
  options = options || {};
  options.stdio = options.stdio || [process.stdin, process.stdout, process.stderr, 'ipc'];
  return new Promise((resolve, reject) => {
    const child = cp.fork(moduleFile, args, options);
    child.on('exit', code => {
      if (code !== 0) {
        return reject(new Error(`Run ${moduleFile} ${args.join(' ')} exit ${code}`));
      }
      resolve();
    });
  });
};

exports.getGlobalPrefix = prefix => {
  if (!prefix) {
    try {
      prefix = cp.execSync('npm config get prefix').toString().trim();
    } catch (err) {
      throw new Error(`exec npm config get prefix ERROR: ${err.message}`);
    }
  }
  return exports.formatPath(prefix);
};

exports.getGlobalInstallMeta = prefix => {
  prefix = exports.getGlobalPrefix(prefix);
  const meta = {
    targetDir: prefix,
    binDir: prefix,
  };
  if (process.platform !== 'win32') {
    meta.targetDir = path.join(prefix, 'lib');
    meta.binDir = path.join(prefix, 'bin');
  }
  return meta;
};

exports.endsWithX = version => typeof version === 'string' && !!version.match(/^\d+\.(x|\d+\.x)$/);

exports.getDisplayName = (pkg, ancestors) => {
  return ancestors
    .map(ancestor => ancestor.displayName || ancestor)
    .concat([`${pkg.name}@${pkg.version}`])
    .join(' › ');
};

exports.exec = promisify(cp.exec);
