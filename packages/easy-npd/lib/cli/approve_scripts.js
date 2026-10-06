// npd-x approve-scripts / deny-scripts: 列出已安装但未在 allowScripts 中审核的依赖安装脚本, 把放行或拒绝条目写入根 package.json
'use strict';

const path = require('path');
const fs = require('fs/promises');
const chalk = require('chalk');
const npa = require('npm-package-arg');
const parseArgs = require('minimist');
const utils = require('../utils');
const allowScripts = require('../allow_scripts');
const help = require('./help');

module.exports = args => runCommand('approve-scripts', args);
module.exports.deny = args => runCommand('deny-scripts', args);

async function runCommand(command, args) {
  try {
    await main(command, args);
  } catch (err) {
    console.error(chalk.red(`npd-x ${command}: ${err.message}`));
    process.exit(1);
  }
}

async function main(command, args) {
  const deny = command === 'deny-scripts';
  const argv = parseArgs(args, {
    string: ['root'],
    boolean: ['help', 'all', 'pending', 'pin', 'global'],
    default: { pin: true },
    alias: { h: 'help', g: 'global' },
  });
  const usage = deny ? help.denyScripts() : help.approveScripts();
  if (argv.help) {
    console.log(usage);
    return;
  }
  if (argv.global) {
    throw new Error('global installs have no project package.json, use npd -g --allow-scripts=<pkg> instead');
  }
  const names = argv._.map(String);
  if (!(argv.pending && !deny) && !argv.all && names.length === 0) {
    console.log(usage);
    process.exitCode = 1;
    return;
  }

  const root = path.resolve(argv.root || process.cwd());
  const pkgFile = path.join(root, 'package.json');
  const text = await fs.readFile(pkgFile, 'utf8');
  const rootPkg = JSON.parse(text);
  const policy = rootPkg.allowScripts && typeof rootPkg.allowScripts === 'object' ? rootPkg.allowScripts : {};
  const installed = await listInstalledWithScripts(root);
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
    const rebuildNames = [...new Set(changed.targets.map(item => item.name))].join(' ');
    console.log('run npd-x rebuild %s to run their install scripts now', rebuildNames);
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
        console.warn(chalk.yellow('skip %s: denied by allowScripts, remove the false entry to approve it'), item.displayName);
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

// 扫描 node_modules 下 _<name>@<version>@<name> 目录中带安装脚本(含 binding.gyp 隐式构建)的包; scope 包多一层目录
async function listInstalledWithScripts(root) {
  const storeDir = path.join(root, 'node_modules');
  let entries;
  try {
    entries = await fs.readdir(storeDir);
  } catch {
    return [];
  }
  const dirs = [];
  for (const entry of entries.sort()) {
    if (!entry.startsWith('_') || !entry.includes('@')) continue;
    const dir = path.join(storeDir, entry);
    if (await utils.exists(path.join(dir, 'package.json'))) {
      dirs.push(dir);
    } else if (entry.startsWith('_@')) {
      for (const sub of await fs.readdir(dir).catch(() => [])) dirs.push(path.join(dir, sub));
    }
  }
  const result = [];
  for (const dir of dirs) {
    const pkg = await utils.readJSON(path.join(dir, 'package.json'));
    if (!pkg.name) continue;
    const scripts = await allowScripts.pendingScripts(pkg, dir);
    if (scripts.length === 0) continue;
    const identity = allowScripts.identityOfInstalled(pkg, dir);
    if (!identity) continue;
    const { name, version } = utils.parsePackageStorePath(dir) || pkg;
    const owner = pkg._scriptsOwner ? ` (declared by ${pkg._scriptsOwner})` : '';
    result.push({ name, displayName: `${name}@${version}${owner}`, scripts, identity });
  }
  return result;
}
