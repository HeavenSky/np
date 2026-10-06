'use strict';

const path = require('path');
const fs = require('fs/promises');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const chalk = require('chalk');
const npa = require('npm-package-arg');
const semver = require('semver');
const packlist = require('npm-packlist');
const utils = require('../utils');
const allowScripts = require('../allow_scripts');

// 只对这些主机浅克隆: 其他主机(例如 GHE)不一定支持, 浅拉取失败比完整拉取更慢
const SHALLOW_HOSTS = new Set(['github.com', 'gist.github.com', 'gitlab.com', 'bitbucket.com', 'bitbucket.org']);
// 与 pacote 一致: 声明了这些脚本或 workspaces 的仓库才先安装依赖再打包
const PREPARE_SCRIPTS = ['postinstall', 'build', 'preinstall', 'install', 'prepack', 'prepare'];
const CNPM_DEP_FIELDS = ['clientDependencies', 'buildDependencies', 'isomorphicDependencies'];
const GIT_SHORT_TIMEOUT = 2 * 60 * 1000;
const GIT_FETCH_TIMEOUT = 10 * 60 * 1000;
const PREPARE_TIMEOUT = 30 * 60 * 1000;
const GIT_RETRY_DELAYS = [1000, 10000];
// 记录当前安装链上正在准备的仓库; 互相依赖的 git 仓库不靠它会无限递归启动子进程
const NO_PREPARE_ENV = '_NPD_NO_PREPARE_';
// 标记构建子进程: 子进程不执行任何依赖脚本, 也不读克隆仓库自带的 allowScripts
const PREPARE_CHILD_ENV = '_NPD_GIT_PREPARE_CHILD_';
const NPD_BIN = path.join(__dirname, '../../bin/i.js');
const FULL_SHA_RE = /^[a-f0-9]{40}$/;
const CONNECTION_ERROR_RE = new RegExp(
  [
    'remote error: Internal Server Error',
    'The remote end hung up unexpectedly',
    'Connection timed out',
    'Operation timed out',
    'Failed to connect to .* Timed out',
    'Connection reset by peer',
    'SSL_ERROR_SYSCALL',
    'The requested URL returned error: 503',
  ].join('|')
);
const PATHSPEC_ERROR_RE = /pathspec .* did not match any file\(s\) known to git/;

module.exports = async (pkg, options) => {
  const { name, raw, displayName } = pkg;
  const installed = await utils.getLockedInstall(options.cache.dependenciesTree[raw], options);
  if (installed) {
    options.remoteNames[raw] = installed.package.name;
    if (options.lockPackages) options.lockPackages[raw] = installed.package;
    return installed;
  }
  if (options.offline) {
    throw new Error(
      utils.redactUrl(`Can't install ${pkg.raw} in offline mode: git packages are always fetched from the network`)
    );
  }

  options.gitPackages++;
  options.console.warn(
    chalk.yellow(`[${displayName}] install ${name || ''} from git ${raw}, may be very slow, please be patient`)
  );
  const tmpDir = path.join(options.storeDir, '.tmp', randomUUID());
  const repoDir = path.join(tmpDir, 'repo');
  const packageDir = path.join(tmpDir, 'package');
  try {
    const spec = npa(raw);
    // np-lock.json 锁定了解析出的 commit 时直接检出它, 不再按分支, tag 或 semver 重新解析
    const locked = options.cache.dependenciesTree[raw];
    const lockedSha = locked && /#([a-f0-9]{40})$/.exec(locked._resolved || '')?.[1];
    if (lockedSha) {
      spec.gitCommittish = lockedSha;
      spec.gitRange = undefined;
    } else if (options.frozenLockfile) {
      throw new Error(`${raw} is not in np-lock.json, run npd without --frozen-lockfile to update it`);
    }
    const sha = await cloneSpec(spec, repoDir);
    const resolved = resolvedUrl(spec, sha);
    await prepareRepo(repoDir, resolved, options);
    await packRepo(repoDir, packageDir);
    await utils.addMetaToJSONFile(path.join(packageDir, 'package.json'), {
      _from: raw,
      _resolved: resolved,
    });
    const res = await utils.copyInstall(packageDir, options);
    if (name && name !== res.package.name) {
      options.console.warn(
        chalk.yellow(`[${displayName}] Package name unmatched: expected ${name} but found ${res.package.name}`)
      );
      res.package.name = name;
    }
    // record package name
    options.remoteNames[raw] = res.package.name;
    if (options.lockPackages) options.lockPackages[raw] = res.package;
    return res;
  } catch (err) {
    // git 与子进程的错误只在 stderr 里带真实原因, 附上末尾便于定位
    const stderr = err.stderr ? `\n${String(err.stderr).trim().split('\n').slice(-5).join('\n')}` : '';
    throw new Error(utils.redactUrl(`[${displayName}] ${err.message}${stderr}`), { cause: err });
  } finally {
    // clean up
    try {
      await utils.rimraf(tmpDir);
    } catch (err) {
      options.console.warn(chalk.yellow(`rmdir git clone dir: ${tmpDir} error: ${err}, ignore it`));
    }
  }
};

module.exports.PREPARE_CHILD_ENV = PREPARE_CHILD_ENV;

// 托管仓库先走 https(公开仓库免密, 带 auth 时只能走 https), 失败再回退 ssh 以支持私有仓库
async function cloneSpec(spec, dir) {
  const hosted = spec.hosted;
  if (!hosted) {
    return await cloneRepo(spec.fetchSpec, spec, dir);
  }
  try {
    return await cloneRepo(hosted.https({ noCommittish: true }), spec, dir);
  } catch (err) {
    const ssh = hosted.sshurl && hosted.sshurl({ noCommittish: true });
    if (err.code === 'EGITPATHSPEC' || err.code === 'ETARGET' || !ssh || hosted.auth) {
      throw err;
    }
    return await cloneRepo(ssh, spec, dir);
  }
}

// 检出到 spec 指定的提交, 返回完整 commit sha
async function cloneRepo(repo, spec, dir) {
  await utils.rimraf(dir);
  await utils.mkdirp(dir);
  const ref = spec.gitCommittish || 'HEAD';
  // 完整 sha(含 np-lock.json 锁定的 commit)不需要 ls-remote, 直接按 sha 拉取
  const revs = FULL_SHA_RE.test(ref) ? null : await lsRemote(repo);
  const revDoc = revs && pickRev(revs, spec);
  const shallow = SHALLOW_HOSTS.has(hostOf(repo));
  if (!revDoc) {
    // HEAD~3, 缩写 sha 等未公布的 ref 只能完整克隆; 完整 sha 在支持按 sha 拉取的主机上先尝试浅拉取
    if (shallow && FULL_SHA_RE.test(ref)) {
      try {
        await fetchCommit(repo, ref, dir, true);
        return await headSha(dir);
      } catch {
        await utils.rimraf(dir);
        await utils.mkdirp(dir);
      }
    }
    await git(['clone', '--mirror', '-q', repo, path.join(dir, '.git')], dir, GIT_FETCH_TIMEOUT);
    await git(['init'], dir, GIT_SHORT_TIMEOUT);
    await git(['checkout', ref], dir, GIT_SHORT_TIMEOUT);
    await updateSubmodules(dir);
  } else if (revs.refs.HEAD && revDoc.sha === revs.refs.HEAD.sha) {
    await git(['clone', repo, dir, '--recurse-submodules', ...(shallow ? ['--depth=1'] : [])], dir, GIT_FETCH_TIMEOUT);
  } else if (revDoc.type === 'tag' || revDoc.type === 'branch') {
    await git(
      ['clone', '-b', revDoc.ref, repo, dir, '--recurse-submodules', ...(shallow ? ['--depth=1'] : [])],
      dir,
      GIT_FETCH_TIMEOUT
    );
  } else {
    await fetchCommit(repo, revDoc.rawRef, dir, shallow, revDoc.sha);
  }
  return await headSha(dir);
}

async function fetchCommit(repo, ref, dir, shallow, sha = ref) {
  await git(['init'], dir, GIT_SHORT_TIMEOUT);
  await git(['remote', 'add', 'origin', repo], dir, GIT_SHORT_TIMEOUT);
  await git(['fetch', 'origin', ref, ...(shallow ? ['--depth=1'] : [])], dir, GIT_FETCH_TIMEOUT);
  await git(['checkout', sha], dir, GIT_SHORT_TIMEOUT);
  await updateSubmodules(dir);
}

async function updateSubmodules(dir) {
  if (await utils.exists(path.join(dir, '.gitmodules'))) {
    await git(['submodule', 'update', '-q', '--init', '--recursive'], dir, GIT_FETCH_TIMEOUT);
  }
}

async function headSha(dir) {
  const { stdout } = await git(['rev-parse', '--revs-only', 'HEAD'], dir, GIT_SHORT_TIMEOUT);
  return stdout.trim();
}

function hostOf(repo) {
  try {
    return new URL(repo).host;
  } catch {
    return '';
  }
}

// 按 #semver:<range>, #<committish> 或远端 HEAD 选出要检出的 ref, 找不到时返回 null
function pickRev(revs, spec) {
  if (spec.gitRange) {
    const range = spec.gitRange;
    if (revs.latest && semver.satisfies(revs.latest, range, { loose: true })) {
      return revs.versions[revs.latest];
    }
    const version = semver.maxSatisfying(Object.keys(revs.versions), range, { loose: true });
    if (!version) {
      const err = new Error(`No matching version found for semver:${range}`);
      err.code = 'ETARGET';
      throw err;
    }
    return revs.versions[version];
  }
  const ref = spec.gitCommittish;
  if (!ref) {
    return revs.refs.HEAD;
  }
  if (revs.refs[ref]) {
    return revs.refs[ref];
  }
  if (revs.shas[ref]) {
    return revs.refs[revs.shas[ref][0]];
  }
  return null;
}

// 把 git ls-remote 的输出整理成 refs, 按 sha 反查的 refs, 以及从 tag 名解析出的版本
// 同一仓库在一次安装中可能被多个依赖引用, 结果按仓库地址缓存到进程结束; 失败不缓存, 下次引用时重试
const lsRemoteCache = new Map();
function lsRemote(repo) {
  if (!lsRemoteCache.has(repo)) {
    const pending = _lsRemote(repo);
    lsRemoteCache.set(repo, pending);
    pending.catch(() => lsRemoteCache.delete(repo));
  }
  return lsRemoteCache.get(repo);
}

async function _lsRemote(repo) {
  const { stdout } = await git(['ls-remote', repo], undefined, GIT_SHORT_TIMEOUT);
  const revs = { versions: {}, latest: null, refs: {}, shas: {} };
  for (const line of stdout.trim().split('\n')) {
    const doc = lineToRevDoc(line);
    if (!doc) continue;
    revs.refs[doc.ref] = doc;
    revs.refs[doc.rawRef] = doc;
    if (doc.type === 'tag') {
      // tag 名常见 release-v1.2.3 这种形式, 只取末尾的版本号
      const match = !doc.ref.endsWith('^{}') && doc.ref.match(/v?(\d+\.\d+\.\d+(?:[-+].+)?)$/);
      if (match && semver.valid(match[1], true)) {
        revs.versions[semver.clean(match[1], true)] = doc;
      }
    }
  }
  // 附注 tag 的 sha 指向 tag 对象, 要换成 ^{} 行给出的提交 sha, 否则按 sha 检出会失败
  for (const ref of Object.keys(revs.refs)) {
    if (!ref.endsWith('^{}')) continue;
    const unpeeled = revs.refs[ref.slice(0, -3)];
    if (unpeeled) {
      unpeeled.sha = revs.refs[ref].sha;
      delete revs.refs[ref];
    }
  }
  for (const ref of Object.keys(revs.refs)) {
    const { sha } = revs.refs[ref];
    (revs.shas[sha] = revs.shas[sha] || []).push(ref);
  }
  // 有 latest 分支时以它指向的版本为 latest, 否则取 HEAD 指向的版本
  const latestSha = (revs.refs.latest || revs.refs.HEAD || {}).sha;
  for (const version of Object.keys(revs.versions)) {
    if (revs.versions[version].sha === latestSha) {
      revs.latest = version;
    }
  }
  return revs;
}

function lineToRevDoc(line) {
  const split = line.trim().split(/\s+/, 2);
  if (split.length < 2) {
    return null;
  }
  const [sha, rawRef] = split;
  if (rawRef.startsWith('refs/tags/')) {
    return { sha, ref: rawRef.slice('refs/tags/'.length), rawRef, type: 'tag' };
  }
  if (rawRef.startsWith('refs/heads/')) {
    return { sha, ref: rawRef.slice('refs/heads/'.length), rawRef, type: 'branch' };
  }
  if (rawRef.startsWith('refs/pull/')) {
    // #pull/123 安装 PR 的 head, #pull/123/merge 安装合并结果
    return { sha, ref: rawRef.slice('refs/'.length).replace(/\/head$/, ''), rawRef, type: 'pull' };
  }
  if (rawRef === 'HEAD') {
    return { sha, ref: 'HEAD', rawRef, type: 'head' };
  }
  return { sha, ref: rawRef, rawRef, type: 'other' };
}

// 与 pacote 一致: 托管仓库无 https auth 时记为 git+ssh 地址, 其他仓库沿用原始地址
function resolvedUrl(spec, sha) {
  const hosted = spec.hosted;
  if (!hosted) {
    return `${spec.rawSpec.replace(/#.*$/, '')}#${sha}`;
  }
  const opts = { noCommittish: true };
  const url = hosted.sshurl && !(hosted.https && hosted.auth) ? hosted.sshurl(opts) : hosted.https(opts);
  return `git+${url}#${sha}`.replace(/^(git\+)+/, 'git+');
}

// 用 npd 子进程安装依赖(含 devDependencies)并执行根包的 prepublish 与 prepare, 之后才能打包出构建产物;
// 子进程的 --ignore-scripts 不影响根包的 prepublish 与 prepare
async function prepareRepo(dir, resolved, options) {
  const pkgFile = path.join(dir, 'package.json');
  const content = await fs.readFile(pkgFile, 'utf8');
  const pkg = JSON.parse(content);
  const scripts = pkg.scripts || {};
  const triggers = PREPARE_SCRIPTS.filter(script => scripts[script]);
  if (!pkg.workspaces && triggers.length === 0) {
    return;
  }
  if (options.ignoreScripts) {
    return;
  }
  // 构建会安装 devDependencies 并执行仓库内的脚本, 不论触发它的是哪个脚本都要先在 allowScripts 中放行, 未放行时直接按仓库内容打包
  const info = {
    displayName: pkg.name || resolved,
    name: pkg.name,
    scripts: triggers.length ? triggers : ['workspaces'],
  };
  if (!allowScripts.allow(options, { git: resolved }, info)) {
    return;
  }
  const noPrepare = process.env[NO_PREPARE_ENV] ? process.env[NO_PREPARE_ENV].split('\n') : [];
  if (noPrepare.includes(resolved)) {
    options.console.info('[npd:git] skip prepare %s, already preparing in the install chain', resolved);
    return;
  }
  noPrepare.push(resolved);

  // NODE_ENV=production 会让子进程按 --production 跳过 devDependencies, 构建脚本通常依赖它们;
  // 依赖的安装脚本不执行(与 npm 12 默认不执行未授权的依赖脚本一致), 否则只用于测试的 devDependencies(例如 phantomjs-prebuilt)下载失败也会让整个 git 依赖装不上
  const env = { ...process.env, [NO_PREPARE_ENV]: noPrepare.join('\n'), [PREPARE_CHILD_ENV]: '1' };
  delete env.NODE_ENV;
  const args = [NPD_BIN, `--root=${dir}`, '--ignore-scripts'];
  if (options.registry) {
    args.push(`--registry=${options.registry}`);
  }
  // npd 让 buildDependencies 等 cnpm 专有字段覆盖 devDependencies, 仓库里过期的这类字段会装出错误的构建依赖
  // (例如 nunjucks 的 buildDependencies 把 webpack 5 换成 3); npm 忽略这些字段, 安装期间去掉, 打包前写回原文件
  const npmPkg = { ...pkg };
  for (const field of CNPM_DEP_FIELDS) delete npmPkg[field];
  await fs.writeFile(pkgFile, JSON.stringify(npmPkg, null, 2));
  try {
    await run(process.execPath, args, { cwd: dir, env, timeout: PREPARE_TIMEOUT, name: 'git dep preparation' });
  } finally {
    await fs.writeFile(pkgFile, content);
  }
}

// 按 npm pack 的规则(files, .npmignore/.gitignore, 必含与必排文件)把要发布的文件复制到 dest
async function packRepo(dir, dest) {
  const files = await packlist({ path: dir });
  for (const file of files) {
    const target = path.join(dest, file);
    await utils.mkdirp(path.dirname(target));
    await fs.copyFile(path.join(dir, file), target);
  }
}

async function git(args, cwd, timeout) {
  // 未配置凭据时 git 会等待终端输入, 没有 tty 的子进程会一直挂起到超时
  const env = { GIT_ASKPASS: 'echo', GIT_SSH_COMMAND: 'ssh -oStrictHostKeyChecking=accept-new', ...process.env };
  const prefix = ['--no-replace-objects'];
  if (process.platform === 'win32') {
    prefix.push('-c', 'core.longpaths=true');
  }
  for (let attempt = 0; ; attempt++) {
    try {
      return await run('git', [...prefix, ...args], { cwd, env, timeout, name: `git ${args[0]}` });
    } catch (err) {
      const stderr = err.stderr || '';
      if (PATHSPEC_ERROR_RE.test(stderr)) {
        err.message = 'The git reference could not be found';
        err.code = 'EGITPATHSPEC';
      } else if (CONNECTION_ERROR_RE.test(stderr)) {
        err.message = 'A git connection error occurred';
        if (attempt < GIT_RETRY_DELAYS.length) {
          await utils.sleep(GIT_RETRY_DELAYS[attempt]);
          continue;
        }
      }
      throw err;
    }
  }
}

// 超时或本进程退出时结束整个子进程树; 错误带上 stderr 供调用方附在报错末尾
function run(cmd, args, { cwd, env, timeout, name }) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
    });
    const killTree = () => utils.killProcessTree(child.pid);
    const untrack = utils.trackChildProcess(child.pid);
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
}
