// np-x approve-scripts / deny-scripts: 列出已安装但未在 allowScripts 中审核的依赖安装脚本, 把放行或拒绝条目写入根 package.json
const path = require('node:path');
const fs = require('node:fs/promises');
const chalk = require('chalk');
const npa = require('npm-package-arg');
const parseArgs = require('minimist');
const utils = require('../utils');
const allowScripts = require('../allow_scripts');
const foreignConfig = require('../foreign_config');
const help = require('./help');

module.exports = args => runCommand('approve-scripts', args);
module.exports.deny = args => runCommand('deny-scripts', args);

async function runCommand(command, args) {
  try {
    await main(command, args);
  } catch (err) {
    utils.exitWithError(`np-x ${command}`, err);
  }
}

async function main(command, args) {
  const deny = command === 'deny-scripts';
  utils.rejectRemovedArgs(args, { root: `run np-x ${command} in that folder instead` });
  const argv = parseArgs(args, {
    boolean: ['help', 'version', 'all', 'pending', 'pin', 'global'],
    default: { pin: true },
    alias: { h: 'help', v: 'version', g: 'global' },
  });
  if (argv.version) {
    console.log(`np v${require('../../package.json').version}`);
    return;
  }
  const usage = deny ? help.denyScripts() : help.approveScripts();
  if (argv.help) {
    console.log(usage);
    return;
  }
  if (argv.global) {
    throw new Error('global installs have no project package.json, use np-x install -g --allow-scripts=<pkg> instead');
  }
  const names = argv._.map(String);
  if (!(argv.pending && !deny) && !argv.all && names.length === 0) {
    console.log(usage);
    process.exitCode = 1;
    return;
  }

  // allowScripts 写在根项目的 package.json, 在 workspace 目录中运行时同样写到根项目
  const { root } = await utils.resolveProjectRoot();
  const pkgFile = path.join(root, 'package.json');
  const text = await fs.readFile(pkgFile, 'utf8');
  const rootPkg = JSON.parse(text);
  let policy = rootPkg.allowScripts && typeof rootPkg.allowScripts === 'object' ? rootPkg.allowScripts : {};
  const installed = await listInstalledWithScripts(root);
  // 写入 allowScripts 后 pnpm 构建策略不再生效, 先把它的条目并入, 已放行或拒绝的依赖不会变回未审核;
  // 只有 neverBuiltDependencies 时未列出的依赖原本都放行, 把已安装的这些依赖按包名写成放行
  if (Object.keys(policy).length === 0) {
    const fromPnpm = foreignConfig.pnpmScriptPolicy(foreignConfig.pnpm(root));
    policy = { ...fromPnpm.policy };
    if (fromPnpm.allowUnreviewed) {
      for (const item of installed) {
        if (allowScripts.check(policy, item.identity) === null) policy[allowScripts.keyOf(item.identity, false)] = true;
      }
    }
  }
  const pending = installed.filter(item => allowScripts.check(policy, item.identity) === null);

  if (argv.pending && !deny) {
    if (pending.length === 0) {
      console.log('all installed packages with install scripts are reviewed in allowScripts');
    }
    for (const item of pending) console.log('%s (%s)', item.displayName, item.scripts.join(', '));
    return;
  }

  const changed = deny
    ? denyTargets(policy, installed, pending, names, argv.all)
    : approveTargets(policy, installed, pending, names, argv);
  if (changed.keys.length === 0) {
    console.log(deny ? 'nothing to deny' : 'nothing to approve');
    return;
  }
  rootPkg.allowScripts = policy;
  const indent = /^[ \t]+/m.exec(text)?.[0] || '  ';
  await fs.writeFile(pkgFile, JSON.stringify(rootPkg, null, indent) + (text.endsWith('\n') ? '\n' : ''));
  for (const key of changed.keys) console.log(deny ? chalk.yellow('denied %s') : chalk.green('approved %s'), key);
  if (!deny) {
    // git 依赖的构建发生在获取时, rebuild 只重跑安装脚本; 删除 store 目录后重新安装才会克隆并构建
    const builds = changed.targets.filter(item => item.identity.git && item.build);
    for (const item of builds) {
      console.log(
        'git dependency %s is built when fetched, remove %s and run np again to build it',
        item.name,
        path.relative(process.cwd(), item.storeDir) || '.'
      );
    }
    const rebuildNames = [
      ...new Set(changed.targets.filter(item => !builds.includes(item) || item.install).map(item => item.name)),
    ].join(' ');
    if (rebuildNames) console.log('run np-x rebuild %s to run their install scripts now', rebuildNames);
  }
}

function approveTargets(policy, installed, pending, names, argv) {
  const targets = argv.all ? [...pending] : [];
  for (const name of names) {
    const matched = installed.filter(item => item.name === npa(name).name);
    if (matched.length === 0) {
      throw new Error(`${name} has no installed version with install scripts`);
    }
    for (const item of matched) {
      // 与 npm 一致: 已明确拒绝的包不会被重新放行, 要放行先手动删除 false 条目
      if (allowScripts.check(policy, item.identity) === false) {
        console.warn(
          chalk.yellow('skip %s: denied by allowScripts, remove the false entry to approve it'),
          item.displayName
        );
        continue;
      }
      targets.push(item);
    }
  }
  const keys = [];
  for (const item of targets) {
    const key = allowScripts.keyOf(item.identity, argv.pin);
    if (policy[key] === true) continue;
    policy[key] = true;
    keys.push(key);
  }
  return { keys, targets };
}

// 与 npm 一致: 拒绝总是写不带版本的键(git 与 url 依赖写不带 commit 的地址), 并删除同一个包已有的放行条目
function denyTargets(policy, installed, pending, names, all) {
  const identities = all ? pending.map(item => item.identity) : [];
  for (const name of names) {
    const matched = installed.filter(item => item.name === npa(name).name);
    // 未安装的包同样可以按名称预先拒绝
    identities.push(...(matched.length ? matched.map(item => item.identity) : [{ name: npa(name).name }]));
  }
  const keys = [];
  for (const identity of identities) {
    for (const key of Object.keys(policy)) {
      if (policy[key] === true && (sameName(key, identity) || allowScripts.check({ [key]: true }, identity))) {
        delete policy[key];
      }
    }
    const key = allowScripts.keyOf(identity, false);
    if (policy[key] === false) continue;
    policy[key] = false;
    keys.push(key);
  }
  return { keys, targets: [] };
}

function sameName(key, identity) {
  try {
    return !!identity.name && npa(key).name === identity.name;
  } catch {
    return false;
  }
}

// 扫描 .store 中带安装脚本(含 binding.gyp 隐式构建)的包与需要构建的 git 依赖; workspace 项目的 .store 位于根目录
async function listInstalledWithScripts(root) {
  const storeRoot = path.join(root, 'node_modules/.store');
  let entries;
  try {
    entries = await fs.readdir(storeRoot);
  } catch {
    return [];
  }
  const result = [];
  for (const entry of entries.sort()) {
    const at = entry.lastIndexOf('@');
    if (at <= 0) continue;
    const name = entry.slice(0, at).replace('+', '/');
    const dir = path.join(storeRoot, entry, 'node_modules', name);
    const pkg = await utils.readJSON(path.join(dir, 'package.json'));
    if (!pkg.name) continue;
    const install = await allowScripts.pendingScripts(pkg, dir);
    const identity = allowScripts.identityOfInstalled(pkg, dir);
    if (!identity) continue;
    const build = identity.git ? allowScripts.gitBuildScripts(pkg) : [];
    const scripts = [...new Set([...install, ...build])];
    if (scripts.length === 0) continue;
    const owner = allowScripts.ownerOfInstalled(pkg);
    result.push({
      name,
      displayName: `${name}@${entry.slice(at + 1)}${owner ? ` (declared by ${owner})` : ''}`,
      scripts,
      identity,
      install: install.length > 0,
      build: build.length > 0,
      storeDir: path.join(storeRoot, entry),
    });
  }
  return result;
}
