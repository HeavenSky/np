'use strict';

const path = require('path');
const fs = require('fs/promises');
const chalk = require('chalk');
const normalize = require('npm-normalize-package-bin');
const utils = require('./utils');
const installState = require('./install_state');
const prune = require('./prune');

module.exports = async options => {
  const pkgs = options.pkgs;
  options.console = options.console || console;

  const uninstalled = [];
  const depNames = [];
  for (const pkg of pkgs) {
    const pkgInfo = await uninstall(pkg, options);
    if (pkgInfo) {
      uninstalled.push(pkg);
      depNames.push(...getDepNames(pkgInfo));
    }
  }
  // 先回收失去引用的版本目录, 否则被卸载的包仍会被当作其依赖的提升链接的引用者
  if (!options.global && uninstalled.length) await prune({ root: options.targetDir });
  // 全部目标卸载完再统一判断, 否则同一次卸载的后一个包仍会被当作引用者
  if (!options.global && depNames.length) {
    await cleanupHoistedLinks(options.targetDir, depNames, options);
  }

  return uninstalled;
};

function getDepNames(pkg) {
  return Object.keys(Object.assign({}, pkg.dependencies, pkg.optionalDependencies));
}

// 移除根 node_modules 下指向 _name@ver@name 且未被根 package.json 声明, 也未被其他 _name@ver@name/node_modules 引用的提升链接
async function cleanupHoistedLinks(root, names, options) {
  const nodeModules = path.join(root, 'node_modules');
  const rootPkg = await utils.readJSON(path.join(root, 'package.json'));
  const declared = new Set();
  // 含 --include 安装的 <type>Dependencies: 卸载时不知道当初传了哪些类型, 按全部声明保留链接
  for (const field of Object.keys(rootPkg).filter(key => key === 'dependencies' || key.endsWith('Dependencies'))) {
    if (rootPkg[field] && typeof rootPkg[field] === 'object' && !Array.isArray(rootPkg[field])) {
      for (const name in rootPkg[field]) declared.add(name);
    }
  }
  const stores = await listStorePackages(nodeModules);
  const removed = new Set();
  const queue = [...names];
  while (queue.length) {
    const name = queue.shift();
    if (removed.has(name) || declared.has(name)) continue;
    const linkDir = path.join(nodeModules, name);
    const target = await readStoreLink(linkDir, nodeModules);
    if (!target) continue;
    let required = false;
    for (const store of stores) {
      if (store.name === name || removed.has(store.name)) continue;
      if (await utils.exists(path.join(store.dir, 'node_modules', name))) {
        required = true;
        break;
      }
    }
    if (required) continue;
    await utils.rimraf(linkDir);
    removed.add(name);
    options.console.log('- %s %s', chalk.yellow(name), chalk.gray(linkDir.replace(options.root, '.')));
    // 被移除包的依赖可能因此失去最后一个引用者, 之前判为仍被引用的名字也要重新判断
    queue.push(...getDepNames(await utils.readJSON(path.join(target, 'package.json'))));
  }
}

// name => _name@1.0.0@name, @scope/name => _@scope_name@1.0.0@@scope/name
async function listStorePackages(nodeModules) {
  const stores = [];
  let entries = [];
  try {
    entries = await fs.readdir(nodeModules);
  } catch {
    return stores;
  }
  for (const entry of entries) {
    if (!entry.startsWith('_')) continue;
    const dir = path.join(nodeModules, entry);
    const dirs = entry.includes('@@') ? (await fs.readdir(dir)).map(sub => path.join(dir, sub)) : [dir];
    for (const pkgDir of dirs) {
      const pkg = await utils.readJSON(path.join(pkgDir, 'package.json'));
      if (pkg.name) stores.push({ name: pkg.name, dir: pkgDir });
    }
  }
  return stores;
}

// 只有指向本 node_modules 下 _name@ver@name 的链接是 npd 创建的安装结果, 其余链接或目录可能来自 npd-link 或用户
async function readStoreLink(linkDir, nodeModules) {
  try {
    const target = path.resolve(path.dirname(linkDir), await fs.readlink(linkDir));
    const relative = path.relative(nodeModules, target);
    return relative.startsWith('_') && !path.isAbsolute(relative) ? target : null;
  } catch {
    return null;
  }
}

// git / url / 本地包的目录名带来源后缀, 只能从链接目标取; 链接不指向 storeDir 下的包目录时退回按名称与版本拼出
async function installedStorePath(pkgRoot, storeDir, pkgInfo) {
  const target = await fs.realpath(pkgRoot).catch(() => null);
  const realStore = await fs.realpath(storeDir).catch(() => storeDir);
  const relative = target && path.relative(realStore, target);
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative) && utils.parsePackageStorePath(target)) {
    return path.join(storeDir, relative);
  }
  return utils.getPackageStorePath(storeDir, pkgInfo);
}

async function uninstall(pkg, options) {
  const storeDir = options.global
    ? path.join(options.targetDir, 'node_modules', `.${pkg.name}_npd/node_modules`)
    : path.join(options.targetDir, 'node_modules');

  const pkgRoot = path.join(options.targetDir, 'node_modules', pkg.name);
  const pkgInfo = await utils.readJSON(path.join(pkgRoot, 'package.json'));

  if (pkgInfo.name !== pkg.name) return null;
  if (pkg.version && pkg.version !== pkgInfo.version) return null;

  const realRoot = await installedStorePath(pkgRoot, storeDir, pkgInfo);

  if (options.global) {
    await utils.rimraf(pkgRoot);
    await utils.rimraf(storeDir);
  } else {
    // 版本目录可能还被其他包引用, 由命令行在卸载后统一按引用关系回收
    await installState.remove(realRoot);
    await utils.rimraf(pkgRoot);
  }
  const pkgFile = path.resolve(options.targetDir, 'package.json');
  if (await utils.exists(pkgFile)) {
    await utils.pruneJSON(pkgFile, pkg.name);
  }
  options.console.log(
    '- %s %s -> %s',
    chalk.yellow(`${pkgInfo.name}@${pkgInfo.version}`),
    chalk.gray(pkgRoot.replace(options.root, '.')),
    chalk.gray(realRoot.replace(options.root, '.'))
  );

  // 与 lib/bin.js 一致先规范化, 字符串形式的 bin 也能按包名删除; 用副本避免改动返回给调用方的 pkgInfo
  const { bin: bins = {} } = normalize({ ...pkgInfo });
  for (const file of Object.keys(bins)) {
    const binPath = path.join(options.binDir, file);
    for (const target of await utils.listBinShims(binPath)) {
      await utils.rimraf(target);
      options.console.log(
        '- %s %s',
        chalk.yellow(`${pkgInfo.name}@${pkgInfo.version}`),
        chalk.gray(target.replace(options.root, '.'))
      );
    }
  }
  return pkgInfo;
}
