'use strict';

const debug = require('debug')('npd:utils');
const fs = require('fs/promises');
const { accessSync } = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const { promisify } = require('util');
const { parse: urlparse } = require('url');
const querystring = require('querystring');
// 不能删: 加载时为 tar 补齐 Node < 16.6 缺少的内置方法
require('./runtime');
const tar = require('tar');
const zlib = require('zlib');
const runscript = require('runscript');
const homedir = require('node-homedir');
const fse = require('fs-extra');
const destroy = require('destroy');
const normalizeData = require('normalize-package-data');
const normalizeBin = require('npm-normalize-package-bin');
const semver = require('semver');
const npa = require('npm-package-arg');
const packlist = require('npm-packlist');
const installState = require('./install_state');
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

// 包安装中断或失败时停在的阶段, 按 INSTALL_STAGES 的顺序推进; 本次运行的脚本全部成功后清除
// finish: 包自身的步骤已完成, 但子依赖延后执行的脚本可能还没跑完, 下次运行仍要遍历它的子依赖
exports.INSTALL_STAGES = ['preinstall', 'deps', 'install', 'postinstall', 'finish'];
exports.FIRST_INSTALL_STAGE = exports.INSTALL_STAGES[0];

// 状态写入 store 的 .npd-state.json; 不在 store 中的目录退回写 package.json
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

// 从 stage 继续时是否还要执行 step; 没有阶段(根包)或无法识别的阶段执行全部步骤
exports.shouldRunStage = (stage, step) => {
  return exports.INSTALL_STAGES.indexOf(stage) <= exports.INSTALL_STAGES.indexOf(step);
};

exports.unsetInstallDone = async pkgRoot => {
  await updateInstallState(pkgRoot, { done: false });
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
  await fs.writeFile(filepath, JSON.stringify(pkg, null, 2));
};

// 安装结束时汇总本次失败的包; 失败的包与本次运行装过的包都保留阶段标记, 再次运行从停下的地方继续
const INSTALL_FAILURES_CODE = 'NPD_INSTALL_FAILURES';
exports.INSTALL_FAILURES_CODE = INSTALL_FAILURES_CODE;
exports.installFailuresError = (failures, hint = 'run npd again to continue from where they stopped') => {
  const lines = failures.map(({ displayName, error }) => `  - ${displayName}: ${String(error.message).split('\n')[0]}`);
  const err = new Error(exports.redactUrl(`${failures.length} package(s) failed, ${hint}:\n${lines.join('\n')}`));
  err.code = INSTALL_FAILURES_CODE;
  err.failures = failures;
  return err;
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
    const npd = path.join(__dirname, '../bin/i.js');
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

// 结束整个进程树: 只结束直接子进程时, shell 或脚本再启动的孙进程会残留; POSIX 下要求子进程以 detached 启动成为进程组组长
exports.killProcessTree = pid => {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      cp.spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      process.kill(-pid, 'SIGKILL');
    }
  } catch {
    // 进程已退出
  }
};

// 登记中的子进程树: 本进程退出时直接结束, 收到 SIGINT / SIGTERM 时先 SIGTERM, 最多等 1 秒仍存活再强制结束
const trackedPids = new Set();
const SIGNAL_GRACE_MS = 1000;

function signalTree(pid, signal) {
  try {
    process.kill(process.platform === 'win32' ? pid : -pid, signal);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

function killTrackedOnExit() {
  for (const pid of trackedPids) exports.killProcessTree(pid);
}

let terminating = false;
function terminateTracked(signal) {
  if (terminating) return;
  terminating = true;
  const pids = [...trackedPids];
  if (process.platform === 'win32') {
    for (const pid of pids) exports.killProcessTree(pid);
  } else {
    for (const pid of pids) signalTree(pid, 'SIGTERM');
  }
  const deadline = Date.now() + SIGNAL_GRACE_MS;
  const timer = setInterval(() => {
    const alive = pids.filter(pid => signalTree(pid, 0));
    if (alive.length && Date.now() < deadline) return;
    clearInterval(timer);
    for (const pid of alive) exports.killProcessTree(pid);
    process.exit(signal === 'SIGINT' ? 130 : 143);
  }, 50);
}

// 登记 / 注销都只在集合为空时增删一次监听, 并发子进程再多也不会触发 MaxListenersExceededWarning
exports.trackChildProcess = pid => {
  if (!pid) return () => {};
  if (trackedPids.size === 0) {
    process.on('exit', killTrackedOnExit);
    process.on('SIGINT', terminateTracked);
    process.on('SIGTERM', terminateTracked);
  }
  trackedPids.add(pid);
  return () => {
    if (!trackedPids.delete(pid) || trackedPids.size > 0) return;
    process.removeListener('exit', killTrackedOnExit);
    process.removeListener('SIGINT', terminateTracked);
    process.removeListener('SIGTERM', terminateTracked);
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
    const killTree = () => exports.killProcessTree(child.pid);
    const untrack = exports.trackChildProcess(child.pid);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    child.stdout.setEncoding('utf8').on('data', data => (stdout += data));
    child.stderr.setEncoding('utf8').on('data', data => (stderr += data));
    const timer = setTimeout(() => {
      timedOut = true;
      killTree();
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

// 遮住 URL 中的 userinfo 与 .npmrc 风格的凭据, 用于报错, 日志与 debug 输出; 传给子进程的环境变量不经过这里
exports.redactUrl = str => {
  if (typeof str !== 'string') return str;
  return str
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@'"]+@/gi, '$1***@')
    .replace(/(_authToken|_auth|_password)("?\s*[=:]\s*"?)[^\s'",}]+/g, '$1$2***')
    .replace(/([?&](?:token|access_token|auth|_authToken|password)=)[^&#\s]+/gi, '$1***');
};

const SECRET_KEYS = new Set([
  'authorization',
  'proxy-authorization',
  'registryauthorization',
  '_authtoken',
  '_auth',
  '_password',
  'password',
]);
const isSecretKey = key => {
  const lower = String(key).toLowerCase();
  return SECRET_KEYS.has(lower) || lower.endsWith(':_authtoken');
};

// 返回深拷贝, 原对象不变; 类实例保留原型以便 util.inspect 显示类名
exports.redact = value => redactValue(value, new WeakMap());

function redactValue(value, seen) {
  if (typeof value === 'string') return exports.redactUrl(value);
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  if (ArrayBuffer.isView(value) || value instanceof Date || value instanceof RegExp) return value;
  if (Array.isArray(value)) {
    const copy = [];
    seen.set(value, copy);
    for (const item of value) copy.push(redactValue(item, seen));
    return copy;
  }
  if (value instanceof Map) {
    const copy = new Map();
    seen.set(value, copy);
    for (const [key, item] of value) copy.set(key, isSecretKey(key) ? '***' : redactValue(item, seen));
    return copy;
  }
  if (value instanceof Set) {
    const copy = new Set();
    seen.set(value, copy);
    for (const item of value) copy.add(redactValue(item, seen));
    return copy;
  }
  const copy = Object.create(Object.getPrototypeOf(value));
  seen.set(value, copy);
  if (value instanceof Error) {
    Object.defineProperty(copy, 'message', { value: exports.redactUrl(value.message), configurable: true });
    Object.defineProperty(copy, 'stack', { value: exports.redactUrl(value.stack), configurable: true });
  }
  for (const key of Object.keys(value)) {
    let item;
    try {
      item = value[key];
    } catch {
      continue;
    }
    copy[key] = isSecretKey(key) ? '***' : redactValue(item, seen);
  }
  return copy;
}

exports.getMaxRange = spec => {
  // >=1.0.0 <2.0.0
  const r = /^>=.*?<(.*?)$/.exec(spec);
  if (r) {
    return r[1];
  }
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
    return (manifest.deprecated ? 2 : 0) + (node && !semver.satisfies(nodeVersion, node) ? 1 : 0);
  };
  const maxSatisfying = range => {
    const max = semver.maxSatisfying(allVersions, range);
    if (!max || rank(max) === 0) return max;
    for (let level = 0; level < rank(max); level++) {
      const candidate = semver.maxSatisfying(
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
    if (semver.satisfies(distTags.latest, spec) && (version || rank(distTags.latest) === 0)) {
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
            semver.satisfies(latestMajorVersion, spec) &&
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

// git / tarball url / 本地包的 store 目录名带来源后缀, 不占用同名同版本 registry 包的目录, 内容换了来源也不复用旧目录
const SOURCE_SUFFIX_RE = /[+.]((?:git|url|file)\.[0-9a-f]{8})$/;

exports.gitSource = sha => `git.${sha.slice(0, 8)}`;
exports.urlSource = integrity => `url.${utility.sha1(integrity).slice(0, 8)}`;
exports.fileSource = filepath => `file.${utility.sha1(filepath).slice(0, 8)}`;

exports.getPackageStorePath = (storeDir, pkg, source) => {
  // name => _name@1.0.0@name
  // @scope/name => _@scope_name@1.0.0@scope/name
  // 带来源时: _name@1.0.0+git.1a2b3c4d@name, 版本号已有 build metadata 时用 . 连接
  // some packages need name: https://github.com/BenoitZugmeyer/eslint-plugin-html/blob/master/src/index.js#L24
  const version = source ? `${pkg.version}${String(pkg.version).includes('+') ? '.' : '+'}${source}` : pkg.version;
  return path.join(storeDir, `_${pkg.name.replace(/\//g, '_')}@${version}@${pkg.name}`);
};

// getPackageStorePath 的逆运算, 不是 store 目录时返回 null; 只有不带 source 的结果才是 registry 包的身份
exports.parsePackageStorePath = dir => {
  const base = path.basename(dir);
  let parsed = null;
  const unscoped = /^_([^@]+)@([^@]+)@([^@]+)$/.exec(base);
  if (unscoped && unscoped[1] === unscoped[3]) parsed = { name: unscoped[3], version: unscoped[2] };
  const scoped = !parsed && /^_(@.+)@([^@]+)@(@[^@]+)$/.exec(path.basename(path.dirname(dir)));
  if (scoped && scoped[1] === `${scoped[3]}/${base}`.replace(/\//g, '_')) {
    parsed = { name: `${scoped[3]}/${base}`, version: scoped[2] };
  }
  if (!parsed) return null;
  const source = SOURCE_SUFFIX_RE.exec(parsed.version);
  if (source) {
    parsed.version = parsed.version.slice(0, source.index);
    parsed.source = source[1];
  }
  return parsed;
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

// 按 npm pack 的规则(files, .npmignore/.gitignore, 必含与必排文件)把要发布的文件复制到 dest, 不执行包内任何脚本
exports.copyPackFiles = async (dir, dest) => {
  const files = await packlist({ path: dir });
  for (const file of files) {
    const target = path.join(dest, file);
    await exports.mkdirp(path.dirname(target));
    await fs.copyFile(path.join(dir, file), target);
  }
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

exports.copyInstall = async (src, options, source) => {
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

  const targetdir = options.ungzipDir || exports.getPackageStorePath(options.storeDir, realPkg, source);
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

// np-lock.json 锁定的 git / tarball url 包已在 store 中装好时返回与 copyInstall 同形的结果, 否则返回 null; source 由调用方按锁定的 commit / integrity 算出
exports.getLockedInstall = async (locked, options, source) => {
  if (!locked || !locked._resolved || !locked.name || !locked.version || !source || options.rebuild) return null;
  const dir = options.ungzipDir || exports.getPackageStorePath(options.storeDir, locked, source);
  if (!(await exports.isInstallDone(dir)) || (await installState.get(dir))?.stage) return null;
  const pkg = await exports.readPackageJSON(dir);
  // 同版本号的包可能来自另一个 commit 或 url; 锁文件里的地址去掉了凭据
  if (exports.stripUrlAuth(pkg._resolved) !== exports.stripUrlAuth(locked._resolved)) return null;
  return { dir, package: pkg, exists: true };
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
  // 离线与优先离线时直接用随包安装的同名依赖
  if (globalOptions && (globalOptions.offline || globalOptions.preferOffline)) {
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
