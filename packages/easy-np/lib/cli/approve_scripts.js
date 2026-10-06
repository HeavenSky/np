// np-x approve-scripts: 列出已安装但未在 allowScripts 中审核的依赖安装脚本, 并把放行条目写入根 package.json
const path = require('node:path');
const fs = require('node:fs/promises');
const chalk = require('chalk');
const npa = require('npm-package-arg');
const parseArgs = require('minimist');
const utils = require('../utils');
const allowScripts = require('../allow_scripts');
const help = require('./help');

const INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall'];

module.exports = async function approveScriptsCommand(args) {
  try {
    await main(args);
  } catch (err) {
    utils.exitWithError('np-x approve-scripts', err);
  }
};

async function main(args) {
  const argv = parseArgs(args, {
    string: ['root'],
    boolean: ['help', 'all', 'pending', 'pin', 'global'],
    default: { pin: true },
    alias: { h: 'help', g: 'global' },
  });
  if (argv.help) {
    console.log(help.approveScripts());
    return;
  }
  if (argv.global) {
    throw new Error('global installs have no project package.json, use np -g --allow-scripts=<pkg> instead');
  }
  const names = argv._.map(String);
  if (!argv.pending && !argv.all && names.length === 0) {
    console.log(help.approveScripts());
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

  if (argv.pending) {
    if (pending.length === 0) {
      console.log('all installed packages with install scripts are reviewed in allowScripts');
    }
    for (const item of pending) console.log('%s (%s)', item.displayName, item.scripts.join(', '));
    return;
  }

  const targets = argv.all ? pending : [];
  for (const name of names) {
    const spec = npa(name);
    const matched = installed.filter(item => item.name === spec.name);
    if (matched.length === 0) {
      throw new Error(`${name} has no installed version with install scripts in ${path.join(root, 'node_modules')}`);
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

  const added = [];
  for (const item of targets) {
    const key = allowScripts.keyOf(item.identity, argv.pin);
    if (policy[key] === true) continue;
    policy[key] = true;
    added.push(key);
  }
  if (added.length === 0) {
    console.log('nothing to approve');
    return;
  }
  rootPkg.allowScripts = policy;
  const indent = /^[ \t]+/m.exec(text)?.[0] || '  ';
  await fs.writeFile(pkgFile, JSON.stringify(rootPkg, null, indent) + (text.endsWith('\n') ? '\n' : ''));
  for (const key of added) console.log(chalk.green('approved %s'), key);
  const rebuildNames = [...new Set(targets.map(item => item.name))].join(' ');
  console.log('run np-x rebuild %s to run their install scripts now', rebuildNames);
}

// 扫描 .store 中带安装脚本(含 binding.gyp 隐式构建)的包; workspace 项目的 .store 位于根目录
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
    const scripts = INSTALL_SCRIPTS.filter(script => pkg.scripts && pkg.scripts[script]);
    if (!scripts.includes('install') && (await utils.exists(path.join(dir, 'binding.gyp')))) {
      scripts.push('install');
    }
    if (scripts.length === 0) continue;
    result.push({
      name: pkg.name,
      displayName: `${pkg.name}@${pkg.version}`,
      scripts,
      identity: identityOfInstalled(pkg),
    });
  }
  return result;
}

function identityOfInstalled(pkg) {
  try {
    if (pkg._resolved && npa(pkg._resolved).type === 'git') return { git: pkg._resolved };
  } catch {
    // 不是合法的 spec, 按 registry 包处理
  }
  return { name: pkg.name, version: pkg.version };
}
