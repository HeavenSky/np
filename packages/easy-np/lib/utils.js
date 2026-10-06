const debug = require('node:util').debuglog('np:utils');
const fs = require('node:fs/promises');
const { accessSync } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const { promisify } = require('node:util');
const { parse: urlparse } = require('node:url');
const url = require('node:url');
const querystring = require('node:querystring');
const zlib = require('node:zlib');
const chalk = require('chalk');
const globby = require('globby');
// 不能删: 加载时为 tar 补齐 Node < 16.6 缺少的内置方法
require('./runtime');
const tar = require('tar');
const { command } = require('execa');
const homedir = require('node-homedir');
const fse = require('fs-extra');
const destroy = require('destroy');
const normalizeData = require('normalize-package-data');
const normalizeBin = require('npm-normalize-package-bin');
const packlist = require('npm-packlist');
const npa = require('npm-package-arg');
const semver = require('semver');
const installState = require('./install_state');
const globalConfig = require('./config');
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

// 包安装中断或失败时停在的阶段: deps, 下一个要执行的生命周期脚本名, 或 finish; 本次运行没有失败时统一清除
exports.FIRST_INSTALL_STAGE = 'deps';
// finish: 包自身的步骤已完成, 但同一次运行中有包失败, 下次运行仍要遍历它的子依赖才能找到失败的包
exports.FINISH_INSTALL_STAGE = 'finish';

// 状态写入 store 的 .np-state.json; 不在 store 中的目录退回写 package.json
async function updateInstallState(pkgRoot, patch) {
  const legacy = await installState.update(pkgRoot, patch);
  if (legacy) await exports.addMetaToJSONFile(path.join(pkgRoot, 'package.json'), legacy);
}

// 设置 pkg 解压完成的标记, 同一次写入记下起始阶段, 避免中断在两次写入之间时包被当作已完成
exports.setInstallDone = async (pkgRoot, stage) => {
  await updateInstallState(pkgRoot, { done: true, stage });
};

// stage 为 undefined 时删除阶段标记
exports.setInstallStage = async (pkgRoot, stage) => {
  await updateInstallState(pkgRoot, { stage });
};

// 已解压的包要从哪个阶段继续; 无标记表示已完成, --rebuild 时先写回起始阶段再从头执行, 中断后仍能继续
exports.getResumeStage = async (pkgRoot, options) => {
  if (options.rebuild) {
    await exports.setInstallStage(pkgRoot, exports.FIRST_INSTALL_STAGE);
    return exports.FIRST_INSTALL_STAGE;
  }
  return (await installState.get(pkgRoot))?.stage;
};

exports.unsetInstallDone = async pkgRoot => {
  await updateInstallState(pkgRoot, { done: false });
};

// 清除项目根 package.json 中旧版本写入的完成标记
exports.removeInstallDone = async pkgRoot => {
  const pkgFile = path.join(pkgRoot, 'package.json');
  if (!(await exports.exists(pkgFile))) return;
  const pkg = await exports.readJSON(pkgFile);
  if (!('__np_done' in pkg)) return;

  await exports.addMetaToJSONFile(pkgFile, {
    __np_done: undefined,
  });
};

// 判断 pkg 是否已经安装完成; 目录被手动删除后状态文件里的记录不再算数
exports.isInstallDone = async pkgRoot => {
  return !!(await installState.get(pkgRoot))?.done && (await exports.exists(path.join(pkgRoot, 'package.json')));
};

// 只认显式的 false 与阶段标记: fetch-only 留下的包与安装中断或失败的包; 不带标记的包可能由 npm 等其他工具装出, 不算未完成
exports.isInstallUnfinished = async pkgRoot => {
  const state = await installState.get(pkgRoot);
  return state?.done === false || !!state?.stage;
};

// 测试与排查用: 返回 { done, stage } 或 undefined
exports.getInstallState = pkgRoot => installState.get(pkgRoot);

exports.addMetaToJSONFile = async (filepath, meta) => {
  await fs.chmod(filepath, '644');
  const pkg = await exports.readJSON(filepath);
  for (const key in meta) {
    pkg[key] = meta[key];
  }
  await fs.writeFile(filepath, JSON.stringify(pkg, null, 2) + '\n');
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

// 只有指向 node_modules/.store 的链接是 np 自己创建的安装结果, 其余目录或链接可能来自 workspace 或用户
exports.isStoreLink = async linkDir => {
  try {
    const target = path.resolve(path.dirname(linkDir), await fs.readlink(linkDir));
    return target.split(path.sep).includes('.store');
  } catch {
    return false;
  }
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
    name = '@' + encodeURIComponent(name.substring(1));
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
exports.runScript = async (pkgDir, script, globalOptions, runInForeground = false, timeout = 0) => {
  // merge config.env <= process.env <= options.env
  const env = {};

  for (const key in globalConfig.env) {
    env[key] = globalConfig.env[key];
  }

  for (const key in process.env) {
    // ignore `Path` env on Windows
    if (/^path$/i.test(key)) {
      continue;
    }
    env[key] = process.env[key];
  }

  for (const key in globalOptions.env) {
    // ignore `Path` env on Windows
    if (/^path$/i.test(key)) {
      continue;
    }
    env[key] = globalOptions.env[key];
  }

  // set npm_package_* env from package.json
  const pkg = await exports.readJSON(path.join(pkgDir, 'package.json'));
  for (const key in pkg) {
    setNpmPackageEnv(env, key, pkg[key]);
  }

  env.PATH = [
    path.join(__dirname, '../node-gyp-bin'),
    path.join(globalOptions.root, 'node_modules', '.bin'),
    path.join(pkgDir, 'node_modules', '.bin'),
    process.env.PATH,
  ].join(path.delimiter);

  // replace `npm install xxx` to `np xxx`
  const NPM_INSTALL_RE = /^npm (i|install) /;
  if (NPM_INSTALL_RE.test(script)) {
    const npBin = path.join(__dirname, '../bin/i.js');
    const newScript = script.replace(NPM_INSTALL_RE, `${process.execPath} ${npBin} `);
    globalOptions.console.info('[np:runScript] replace %j to %j', script, newScript);
    script = newScript;
  }

  // ignore npm ls error
  // e.g.: npm ERR! extraneous: base64-js@1.1.2
  let ignoreError = false;
  if (/^npm (ls|list)$/.test(script)) {
    ignoreError = true;
  }

  try {
    const options = { cwd: pkgDir, env, stdio: runInForeground ? 'inherit' : 'ignore', shell: true };
    return await (timeout ? commandWithTimeout(script, options, timeout) : command(script, options));
  } catch (err) {
    if (ignoreError) {
      globalOptions.console.info('[np:runScript] ignore runscript error: %s', err);
    } else {
      throw err;
    }
  }
};

// 结束整个进程树: 只结束直接子进程时, shell 或脚本再启动的孙进程会残留; POSIX 下要求子进程以 detached 启动成为进程组组长
// 超时结束整个进程树; 后台执行时收集 stderr, 调用方把末尾几行附在报错里
async function commandWithTimeout(script, options, timeout) {
  const child = command(script, {
    ...options,
    stdio: options.stdio === 'inherit' ? 'inherit' : ['ignore', 'ignore', 'pipe'],
    detached: process.platform !== 'win32',
  });
  const untrack = exports.trackChildProcess(child.pid);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    exports.killProcessTree(child.pid);
  }, timeout);
  try {
    return await child;
  } catch (err) {
    err.message = timedOut
      ? `${err.shortMessage}, timed out after ${timeout / 1000}s`
      : err.shortMessage || err.message;
    throw err;
  } finally {
    clearTimeout(timer);
    untrack();
  }
}

exports.killProcessTree = (pid, signal = 'SIGKILL') => {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      cp.spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      process.kill(-pid, signal);
    }
  } catch {
    // 进程已退出
  }
};

const SIGNAL_EXIT_CODES = { SIGINT: 130, SIGTERM: 143 };
const SIGNAL_KILL_GRACE = 1000;
const trackedPids = new Set();
let signalExitCode = null;

function killTrackedOnExit() {
  for (const pid of trackedPids) exports.killProcessTree(pid);
}

function groupAlive(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function exitOnSignal(signal) {
  if (signalExitCode !== null) return;
  signalExitCode = SIGNAL_EXIT_CODES[signal];
  // 等待期间被结束的子进程会让安装流程以其他退出码先行 process.exit, 退出时改回信号对应的退出码
  process.on('exit', () => {
    process.exitCode = signalExitCode;
  });
  const pids = [...trackedPids];
  if (process.platform === 'win32') {
    for (const pid of pids) exports.killProcessTree(pid);
  } else {
    for (const pid of pids) exports.killProcessTree(pid, 'SIGTERM');
    const deadline = Date.now() + SIGNAL_KILL_GRACE;
    while (pids.some(groupAlive) && Date.now() < deadline) await exports.sleep(50);
    for (const pid of pids.filter(groupAlive)) exports.killProcessTree(pid);
  }
  process.exit(signalExitCode);
}

// 登记以 detached 启动的子进程: 本进程退出时结束其进程树, 收到 SIGINT / SIGTERM 时先终止它们再退出; 返回注销函数
exports.trackChildProcess = pid => {
  if (!pid) return () => {};
  trackedPids.add(pid);
  if (trackedPids.size === 1) {
    process.on('exit', killTrackedOnExit);
    process.on('SIGINT', exitOnSignal);
    process.on('SIGTERM', exitOnSignal);
  }
  let tracked = true;
  return () => {
    if (!tracked) return;
    tracked = false;
    trackedPids.delete(pid);
    if (trackedPids.size === 0) {
      process.removeListener('exit', killTrackedOnExit);
      process.removeListener('SIGINT', exitOnSignal);
      process.removeListener('SIGTERM', exitOnSignal);
    }
  };
};

// 超时或本进程退出时结束整个子进程树; 错误带上 stderr 供调用方附在报错末尾; shell 为 true 时 cmd 是完整的命令行
exports.spawnWithTimeout = (cmd, args, { cwd, env, timeout, name, shell }) => {
  return new Promise((resolve, reject) => {
    const child = cp.spawn(cmd, args, {
      cwd,
      env,
      shell,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
    });
    const untrack = exports.trackChildProcess(child.pid);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    child.stdout.setEncoding('utf8').on('data', data => (stdout += data));
    child.stderr.setEncoding('utf8').on('data', data => (stderr += data));
    const timer = setTimeout(() => {
      timedOut = true;
      exports.killProcessTree(child.pid);
    }, timeout);
    const finish = err => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      untrack();
      if (err) {
        err.stderr = stderr;
        reject(err);
      } else {
        resolve({ stdout, stderr });
      }
    };
    child.on('error', finish);
    child.on('close', (code, signal) => {
      if (timedOut) {
        finish(new Error(`${name} timed out after ${timeout / 1000}s`));
      } else if (code !== 0) {
        const err = new Error(`${name} exited with ${signal ? `signal ${signal}` : `code ${code}`}`);
        err.exitCode = code;
        finish(err);
      } else {
        finish();
      }
    });
  });
};

exports.getMaxRange = spec => {
  // >=1.0.0 <2.0.0
  const r = /^>=.*?<(.*?)$/.exec(spec);
  if (r) {
    return r[1];
  }
};

const semverRangeCacheMap = new Map();
function getCacheSemverRange(range) {
  let semverRange = semverRangeCacheMap.get(range);
  if (semverRange === undefined) {
    try {
      semverRange = new semver.Range(range, { loose: true, includePrerelease: false });
    } catch {
      semverRange = null;
    }
    semverRangeCacheMap.set(range, semverRange);
  }
  return semverRange;
}

// faster semver.satisfies with Range Instance cache
// https://github.com/cnpm/npminstall/issues/453
// https://github.com/pnpm/pnpm/pull/6336
exports.fastSemverSatisfies = (version, range) => {
  const semverRange = getCacheSemverRange(range);
  if (semverRange) {
    try {
      return semverRange.test(new semver.SemVer(version, { loose: true, includePrerelease: false }));
    } catch {
      return false;
    }
  }
  return false;
};

// https://github.com/npm/node-semver/blob/09c69e23cdf6c69c51f83635482fff89ab2574e3/ranges/max-satisfying.js#L4
exports.fastSemverMaxSatisfying = (versions, range) => {
  const semverRange = getCacheSemverRange(range);
  if (!semverRange) return null;
  let max = null;
  let maxSV = null;
  for (const version of versions) {
    const semVersion = new semver.SemVer(version, { loose: true, includePrerelease: false });
    if (semverRange.test(semVersion)) {
      if (!max || maxSV.compare(semVersion) === -1) {
        max = version;
        maxSV = semVersion;
      }
    }
  }
  return max;
};

// 对齐 npm-pick-manifest: 未写版本或写的是 range 时, 优先选未 deprecated 的版本, 其次选 engines.node 兼容当前 Node.js 的版本;
// 显式 tag 与精确版本原样使用; 范围内都不满足时仍返回原本会选中的版本, 由安装阶段告警
// options.versions: manifest 的 versions 字段, 不传时不检查 deprecated 与 engines
// options.implicitTag: spec 是未写版本时补上的 latest, 而不是用户显式写的 tag
exports.findMaxSatisfyingVersion = (spec, distTags, allVersions, options = {}) => {
  const { versions, nodeVersion = process.version, implicitTag = false } = options;
  // 0 最优; deprecated 的权重高于 engines 不兼容, 与 npm-pick-manifest 的排序一致
  const rank = version => {
    const manifest = versions && versions[version];
    if (!manifest) return 0;
    const node = manifest.engines && manifest.engines.node;
    return (manifest.deprecated ? 2 : 0) + (node && !exports.fastSemverSatisfies(nodeVersion, node) ? 1 : 0);
  };
  const maxSatisfying = range => {
    const max = exports.fastSemverMaxSatisfying(allVersions, range);
    if (!max || rank(max) === 0) return max;
    for (let level = 0; level < rank(max); level++) {
      const candidate = exports.fastSemverMaxSatisfying(
        allVersions.filter(version => rank(version) === level),
        range
      );
      if (candidate) return candidate;
    }
    return max;
  };

  // try tag first
  let realPkgVersion = distTags[spec];
  if (realPkgVersion) {
    if (implicitTag && rank(realPkgVersion) > 0) {
      const better = maxSatisfying('*');
      if (better && rank(better) < rank(realPkgVersion)) {
        realPkgVersion = better;
      }
    }
  } else {
    const version = semver.valid(spec);
    const range = semver.validRange(spec, true);
    if (exports.fastSemverSatisfies(distTags.latest, spec) && (version || rank(distTags.latest) === 0)) {
      realPkgVersion = distTags.latest;
    } else if (version) {
      // use the valid version
      realPkgVersion = version;
    } else if (range) {
      realPkgVersion = maxSatisfying(range);
      if (realPkgVersion) {
        // try to use latest-{major} tag version on range
        // ^1.0.1 =range=> get 1.0.3 in (1.0.2, 1.0.3), but latest-1 tag is 1.0.2
        // finnaly we should use 1.0.2 on ^1.0.1
        const major = semver.major(realPkgVersion);
        if (major) {
          const latestMajorVersion = distTags[`latest-${major}`];
          if (
            latestMajorVersion &&
            exports.fastSemverSatisfies(latestMajorVersion, spec) &&
            rank(latestMajorVersion) <= rank(realPkgVersion)
          ) {
            realPkgVersion = latestMajorVersion;
          }
        }
      }
    }
  }

  return realPkgVersion;
};

// git / tarball url / 本地包的 store 目录名在版本号后附加来源标识, 与同名同版本的 registry 包及其他来源互不覆盖;
// 改变计算方式会让已安装的这类依赖指向新目录, 需要重装一次
exports.sourceSuffix = (type, value) => {
  const id = type === 'git' ? value : crypto.createHash('sha1').update(value).digest('hex');
  return `${type}.${id.slice(0, 8)}`;
};

// 以 semver build metadata 形式拼接, 版本号已带 build metadata 时接在其后
exports.storeVersion = (version, suffix) => {
  if (!suffix) return version;
  return `${version}${version.includes('+') ? '.' : '+'}${suffix}`;
};

const SOURCE_SUFFIX_RE = /[+.](?:git|url|file)\.[0-9a-f]{8}$/;
// store 目录名中的版本 -> { version, suffix }; registry 包的 suffix 为 null
exports.parseStoreVersion = storeVersion => {
  const match = SOURCE_SUFFIX_RE.exec(storeVersion);
  if (!match) return { version: storeVersion, suffix: null };
  return { version: storeVersion.slice(0, match.index), suffix: match[0].slice(1) };
};

exports.getPackageStorePath = (storeDir, pkg, globalOptions, suffix) => {
  // if workspace enable, install packages to `<workspaceRoot>/node_modules`
  if (globalOptions.enableWorkspace) {
    storeDir = path.join(globalOptions.workspaceRoot, 'node_modules');
  }
  const version = exports.storeVersion(pkg.version, suffix);
  // https://github.com/npm/rfcs/blob/main/accepted/0042-isolated-mode.md
  // https://github.com/npm/cli/pull/5492
  return path.join(storeDir, `.store/${pkg.name.replace('/', '+')}@${version}/node_modules/${pkg.name}`);
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

const NON_REGISTRY_SPEC_TYPES = new Set(['git', 'remote', 'file', 'directory']);
// 按安装时写入的 _from / _resolved 判断包是否来自 git, tarball url 或本地路径; 没有这两个字段的包(npm 等工具装出)按 registry 包处理
exports.isNonRegistryInstall = pkg => {
  if (typeof pkg._resolved === 'string' && /^(?:git[+:]|file:)/.test(pkg._resolved)) return true;
  if (typeof pkg._from !== 'string') return false;
  try {
    return NON_REGISTRY_SPEC_TYPES.has(npa(pkg._from).type);
  } catch {
    return false;
  }
};

// 目录内全部文件的相对路径与内容的摘要, 与时间戳和权限无关; 符号链接不计入
exports.hashDir = async dir => {
  const hash = crypto.createHash('sha1');
  const walk = async relative => {
    const entries = await fs.readdir(path.join(dir, relative), { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const file = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(file);
      } else if (entry.isFile()) {
        const content = await fs.readFile(path.join(dir, file));
        hash.update(`${file}\0${content.length}\0`).update(content);
      }
    }
  };
  await walk('');
  return hash.digest('hex');
};

exports.copyInstall = async (src, options, suffix) => {
  // 1. make sure source folder has package.json, and package.json contains name
  // 2. get the target directory: $storeDir/${pkg.name}/${pkg.version}
  // 3. check if this package has been installed, and make sure only copy once.
  // 4. if already installed, return with exists = true
  // 5. if not installed, copy and return with exists = false
  const pkgpath = path.join(src, 'package.json');
  if (!(await exports.exists(pkgpath))) {
    throw new Error(`package.json is missing (${pkgpath})`);
  }
  const realPkg = await exports.readPackageJSON(src);
  if (!realPkg.name || !realPkg.version) {
    throw new Error(`package.json must contain name and version (${pkgpath})`);
  }

  const targetdir = options.ungzipDir || exports.getPackageStorePath(options.storeDir, realPkg, options, suffix);
  const key = `copy:${targetdir}`;
  const result = {
    dir: targetdir,
    package: realPkg,
    exists: true,
    storeVersion: exports.storeVersion(realPkg.version, suffix),
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

  // 本地包的版本号与路径不变时内容也可能变了, 已安装的目录要按内容摘要判断能否复用
  const outdated = async () =>
    !!realPkg._contentHash &&
    (await exports.readJSON(path.join(targetdir, 'package.json')))._contentHash !== realPkg._contentHash;
  if (!(await exports.isInstallDone(targetdir)) || (await outdated())) {
    await exports.mkdirp(targetdir);
    await installState.reset(targetdir);
    await fse.emptyDir(targetdir);
    await fse.copy(src, targetdir);
    await exports.setInstallDone(targetdir, exports.FIRST_INSTALL_STAGE);
    result.exists = false;
  } else {
    // 只有本次运行第一个到达的调用方带回阶段, 由它继续安装; 其余调用方只做链接
    result.stage = await exports.getResumeStage(targetdir, options);
  }

  options.cache[key].done = true;
  options.events.emit(key);
  return result;
};

// 按 npm pack 的规则(files, .npmignore/.gitignore, 必含与必排文件)把要发布的文件复制到 dest, 不执行任何脚本
exports.copyPackFiles = async (src, dest) => {
  const files = await packlist({ path: src });
  for (const file of files) {
    const target = path.join(dest, file);
    await exports.mkdirp(path.dirname(target));
    await fs.copyFile(path.join(src, file), target);
  }
};

// np-lock.json 锁定的 git / tarball url 包已在 store 中完整安装时返回 copyInstall 同形的结果, 调用方据此不再联网
exports.getLockedInstall = async (locked, options, suffix) => {
  if (!locked || !locked.name || !locked.version || !locked._resolved || !suffix || options.rebuild) return null;
  const dir = options.ungzipDir || exports.getPackageStorePath(options.storeDir, locked, options, suffix);
  if (!(await exports.isInstallDone(dir)) || (await installState.get(dir))?.stage) return null;
  const pkg = await exports.readPackageJSON(dir);
  // np-lock.json 中的地址不带凭据, store 中记录的是声明里带凭据的地址
  if (exports.stripUrlAuth(pkg._resolved) !== exports.stripUrlAuth(locked._resolved)) return null;
  return { dir, package: pkg, exists: true, storeVersion: exports.storeVersion(locked.version, suffix) };
};

// 按声明查锁定条目; np-lock.json 的键不带凭据, 声明里的 git / tarball url 可能带
exports.lockedEntry = (tree, raw) => tree[raw] || tree[exports.stripUrlAuth(raw)];

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
  let lastErr;
  let pkg;
  const cachePkgFileName = `np-manifests/${name}/latest/package.json`;
  let cachePkgFile;
  if (globalOptions?.cacheDir) {
    cachePkgFile = path.join(globalOptions.cacheDir, cachePkgFileName);
  }
  // preferOffline: 有缓存就用缓存, 没有才联网
  const cacheFirst = globalOptions?.offline || globalOptions?.preferOffline;
  if (cacheFirst && cachePkgFile && (await exports.exists(cachePkgFile))) {
    pkg = await exports.readJSON(cachePkgFile);
  } else if (!globalOptions?.offline) {
    const registries = [registry].concat([
      'https://registry.npmmirror.com',
      'https://r.cnpmjs.org',
      'https://registry.npmjs.com',
    ]);
    for (const registry of registries) {
      const binaryMirrorUrl = exports.formatPackageUrl(registry, `${name}/latest`);
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
        if (cachePkgFile) {
          await exports.mkdirp(path.dirname(cachePkgFile));
          await fs.writeFile(cachePkgFile, JSON.stringify(pkg));
        }
        break;
      } catch (err) {
        lastErr = err;
      }
    }
    // try to read from cache file
    if (!pkg) {
      if (cachePkgFile && (await exports.exists(cachePkgFile))) {
        pkg = await exports.readJSON(cachePkgFile);
      }
    }
  }

  if (!pkg || process.env.NP_TEST_LOCAL_PKG) {
    console.warn('Get /%s/latest from %s error: %s', name, registry, lastErr);
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
  if (!prefix && globalConfig.npmrc.prefix) {
    prefix = globalConfig.npmrc.prefix;
  }
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

exports.formatWorkspaceNames = argv => {
  let workspaceNames = argv.workspace || [];
  if (!argv.workspaces && workspaceNames && typeof workspaceNames === 'string') {
    workspaceNames = [workspaceNames];
  }
  return workspaceNames;
};

// 被依赖的 workspace 排在依赖方之前, 无依赖关系的保持 glob 顺序; 不能改回 Array#sort 比较器, 依赖关系不满足传递性, 比较器排序会给出错误顺序
function sortWorkspacesByDependencies(workspaceInfos) {
  const names = new Set(workspaceInfos.map(info => info.package.name));
  const depsOf = info => {
    const deps = new Set();
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const name in info.package[field] || {}) {
        if (names.has(name) && name !== info.package.name) deps.add(name);
      }
    }
    return deps;
  };
  const pending = workspaceInfos.map(info => ({ info, deps: depsOf(info) }));
  const sorted = [];
  const done = new Set();
  while (pending.length > 0) {
    const index = pending.findIndex(item => [...item.deps].every(name => done.has(name)));
    if (index === -1) {
      console.warn(
        chalk.yellow('np WARN: workspaces have circular dependencies, keep their original order: %s'),
        pending.map(item => item.info.package.name).join(', ')
      );
      sorted.push(...pending.map(item => item.info));
      break;
    }
    const [item] = pending.splice(index, 1);
    sorted.push(item.info);
    done.add(item.info.package.name);
  }
  return sorted;
}
exports.sortWorkspacesByDependencies = sortWorkspacesByDependencies;

exports.readWorkspaces = async root => {
  const workspaceInfos = [];
  const rootPkgFile = path.join(root, 'package.json');
  const rootPkg = await exports.readJSON(rootPkgFile);
  if (Array.isArray(rootPkg.workspaces) && rootPkg.workspaces.length > 0) {
    // should contains package.json
    const patterns = rootPkg.workspaces.map(workspace => {
      // 'packages/*', 'packages/*/'
      return workspace + (workspace.endsWith('/') ? '' : '/') + 'package.json';
    });
    const workspacePkgFiles = await globby(patterns, {
      cwd: root,
      gitignore: true,
    });
    debug('[readWorkspaces] glob %o => %o', patterns, workspacePkgFiles);
    for (const workspacePkgName of workspacePkgFiles) {
      const workspacePkgFile = path.join(root, workspacePkgName);
      const workspacePkg = await exports.readJSON(workspacePkgFile);
      if (!workspacePkg.name) {
        console.warn(chalk.yellow('np WARN: workspace(%s) not found or missing `name` property'), workspacePkgFile);
        continue;
      }
      const workspaceRoot = path.dirname(workspacePkgFile);
      workspaceInfos.push({
        root: workspaceRoot,
        package: workspacePkg,
      });
    }
  }

  const sortedInfos = sortWorkspacesByDependencies(workspaceInfos);
  debug(
    'workspaces sort %j => %j',
    workspaceInfos.map(info => info.package.name),
    sortedInfos.map(info => info.package.name)
  );

  const workspaceRoots = [];
  const workspacesMap = new Map();
  for (const info of sortedInfos) {
    workspaceRoots.push(info.root);
    workspacesMap.set(info.package.name, info);
  }
  return {
    workspaceRoots,
    workspacesMap,
  };
};

exports.getWorkspaceInfos = async (root, workspaceNameOrPaths, workspacesMap = null) => {
  if (!workspacesMap) {
    const rootInfo = await exports.readWorkspaces(root);
    workspacesMap = rootInfo.workspacesMap;
  }
  const workspaceInfos = [];
  const existsRootsSet = new Set();
  for (const workspaceNameOrPath of new Set(workspaceNameOrPaths)) {
    let workspaceInfo = workspacesMap.get(workspaceNameOrPath);
    if (!workspaceInfo) {
      // try to use `<workspaceNameOrPath>/package.json`
      const workspacePkg = await exports.readJSON(path.join(root, workspaceNameOrPath, 'package.json'));
      workspaceInfo = workspacePkg.name && workspacesMap.get(workspacePkg.name);
    }
    if (!workspaceInfo) {
      // try to use `<workspaceNameOrPath>/*/package.json`
      const patterns = [workspaceNameOrPath + (workspaceNameOrPath.endsWith('/') ? '' : '/') + '*/package.json'];
      const workspacePkgFiles = await globby(patterns, {
        cwd: root,
        gitignore: true,
      });
      debug('[getWorkspaceInfo] glob %o => %o', patterns, workspacePkgFiles);
      for (const workspacePkgName of workspacePkgFiles) {
        const workspacePkgFile = path.join(root, workspacePkgName);
        const workspacePkg = await exports.readJSON(workspacePkgFile);
        workspaceInfo = workspacePkg.name && workspacesMap.get(workspacePkg.name);
        if (workspaceInfo && !existsRootsSet.has(workspaceInfo.root)) {
          existsRootsSet.add(workspaceInfo.root);
          workspaceInfos.push(workspaceInfo);
        }
      }
    } else {
      if (!existsRootsSet.has(workspaceInfo.root)) {
        existsRootsSet.add(workspaceInfo.root);
        workspaceInfos.push(workspaceInfo);
      }
    }
  }
  return workspaceInfos;
};

// 安装结束时汇总本次失败的包; 失败的包与它们的上层包都保留阶段标记, 再次运行从停下的地方继续
exports.installFailuresError = (failures, hint = 'run np again to continue from where they stopped') => {
  const lines = failures.map(
    ({ displayName, error }) => `  - ${exports.redactUrl(`${displayName}: ${String(error.message).split('\n')[0]}`)}`
  );
  const err = new Error(`${failures.length} package(s) failed, ${hint}:\n${lines.join('\n')}`);
  err.code = INSTALL_FAILURES_CODE;
  err.failures = failures;
  return err;
};
const INSTALL_FAILURES_CODE = 'NP_INSTALL_FAILURES';
exports.INSTALL_FAILURES_CODE = INSTALL_FAILURES_CODE;

// 本次运行写过阶段标记且没有失败的包, 在整次运行没有失败时统一清除标记
exports.clearInstallStages = async options => {
  for (const dir of options.stagedDirs) {
    await exports.setInstallStage(dir);
  }
  options.stagedDirs.clear();
};

exports.exitWithError = (cmd, err, code = 1) => {
  // 失败汇总已列出每个包的错误, 不再打印调用栈
  console.error(chalk.red(exports.redactUrl(err.code === INSTALL_FAILURES_CODE ? err.message : err.stack)));
  console.error(chalk.yellow(`${cmd} version: %s`), require('../package.json').version);
  console.error(chalk.yellow(`${cmd} argv: %s`), exports.redactUrl(process.argv.join(' ')));
  console.log('');
  process.exit(code);
};

// 依赖树与 np-lock.json 只保存安装需要的 manifest 字段; cpu / libc / os 缺失会让换平台安装时选错可选依赖
const LOCKED_PACKAGE_KEYS = [
  'name',
  'version',
  'dependencies',
  'optionalDependencies',
  'clientDependencies',
  'buildDependencies',
  'isomorphicDependencies',
  'peerDependencies',
  'peerDependenciesMeta',
  'bundleDependencies',
  'bundledDependencies',
  'bin',
  'directories',
  'publish_time',
  'deprecated',
  'license',
  'os',
  'cpu',
  'libc',
  'engines',
  'dist',
  // git 依赖锁定的 commit 记在这里; tarball url 依赖记录下载地址
  '_resolved',
  'scripts',
  'hasInstallScript',
  'gypfile',
  '_id',
  '__fixDependencies',
  '__fixScripts',
];

exports.omitPackage = pkg => {
  const res = {};
  for (const key of LOCKED_PACKAGE_KEYS) {
    if (pkg[key]) res[key] = pkg[key];
  }
  return res;
};

// 遮住 URL 中的用户名密码与 npmrc 风格的凭据值, 用于打印到终端与写入日志的文本; 传给子进程的配置不能经过它
const URL_USERINFO_RE = /([a-z][a-z0-9+.-]*:\/\/)[^\s/'"]+@/gi;
const AUTH_VALUE_RE = /(_authToken|_auth|_password)(["']?\s*[=:]\s*["']?)[^\s'",;}&]+/g;
const QUERY_SECRET_RE = /([?&](?:token|access_token|auth|_authToken|password)=)[^&#\s]+/gi;
exports.redactUrl = str =>
  String(str).replace(URL_USERINFO_RE, '$1***@').replace(AUTH_VALUE_RE, '$1$2***').replace(QUERY_SECRET_RE, '$1***');

// 写入 np-lock.json 的地址去掉凭据: http(s) 去掉整段 userinfo(token 常作为用户名), 其他协议只去掉密码, 保留 git@ 这类用户名; 两个包必须逐字相同, 否则共用的 np-lock.json 键对不上
const URL_AUTH_RE = /([a-z][a-z0-9+.-]*:\/\/)([^\s/'"]+)@/gi;
exports.stripUrlAuth = str => {
  if (typeof str !== 'string') return str;
  return str.replace(URL_AUTH_RE, (match, scheme, userinfo) => {
    if (/https?:\/\/$/i.test(scheme)) return scheme;
    const colon = userinfo.indexOf(':');
    return colon >= 0 ? `${scheme}${userinfo.slice(0, colon)}@` : match;
  });
};

const SECRET_KEYS = new Set([
  'authorization',
  'proxy-authorization',
  'registryauthorization',
  '_authtoken',
  '_auth',
  // npm-package-arg 解析出的 hosted git 凭据
  'auth',
  '_password',
  'password',
]);
const isSecretKey = key => {
  const lower = String(key).toLowerCase();
  return SECRET_KEYS.has(lower) || lower.endsWith(':_authtoken');
};

// 带内部槽的内置对象复制自有属性后无法正常打印, 原样返回
const OPAQUE_TYPES = [Date, RegExp, Error, Promise, WeakMap, WeakSet, ArrayBuffer];

// 返回脱敏后的深拷贝, 不修改原对象
exports.redact = (value, seen = new WeakMap()) => {
  if (typeof value === 'string') return exports.redactUrl(value);
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  if (value instanceof URL) return exports.redactUrl(value.href);
  if (value instanceof Map) {
    const copy = new Map();
    seen.set(value, copy);
    for (const [key, item] of value) copy.set(key, isSecretKey(key) ? '***' : exports.redact(item, seen));
    return copy;
  }
  if (value instanceof Set) {
    const copy = new Set();
    seen.set(value, copy);
    for (const item of value) copy.add(exports.redact(item, seen));
    return copy;
  }
  if (ArrayBuffer.isView(value) || OPAQUE_TYPES.some(type => value instanceof type)) return value;
  const copy = Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value));
  seen.set(value, copy);
  for (const key of Object.keys(value)) {
    copy[key] = isSecretKey(key) ? '***' : exports.redact(value[key], seen);
  }
  return copy;
};
