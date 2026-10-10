const path = require('node:path');
const fs = require('node:fs/promises');
const chalk = require('chalk');
const normalize = require('npm-normalize-package-bin');
const utils = require('./utils');

module.exports = async options => {
  const pkgs = options.pkgs;
  options.console = options.console || console;

  const uninstalled = [];
  for (const pkg of pkgs) {
    const succeed = await uninstall(pkg, options);
    if (succeed) {
      uninstalled.push(pkg);
    }
  }

  return uninstalled;
};

// 卸载后移除 root/node_modules 与 .store/node_modules 下已无人使用的提升链接;
// 仍被任一 package.json 声明, 本身是 workspace, 或被 .store 中其他包依赖时保留
module.exports.cleanupHoistedLinks = async (root, names, logger = console) => {
  const nodeModules = path.join(root, 'node_modules');
  const storeDir = path.join(nodeModules, '.store');
  const { workspacesMap } = await utils.readWorkspaces(root);
  const pkgs = [
    await utils.readJSON(path.join(root, 'package.json')),
    ...[...workspacesMap.values()].map(info => info.package),
  ];
  const declared = new Set();
  for (const pkg of pkgs) {
    // 含 --include 安装的 <type>Dependencies: 卸载时不知道当初传了哪些类型, 按全部声明保留链接
    for (const field of Object.keys(pkg).filter(key => key === 'dependencies' || key.endsWith('Dependencies'))) {
      if (pkg[field] && typeof pkg[field] === 'object' && !Array.isArray(pkg[field])) {
        for (const name in pkg[field]) declared.add(name);
      }
    }
  }
  let storeEntries = [];
  try {
    storeEntries = await fs.readdir(storeDir);
  } catch {
    return;
  }
  for (const name of names) {
    if (declared.has(name) || workspacesMap.has(name)) continue;
    const selfPrefix = `${name.replace('/', '+')}@`;
    let required = false;
    for (const entry of storeEntries) {
      if (entry === 'node_modules' || entry.startsWith(selfPrefix)) continue;
      if (await utils.exists(path.join(storeDir, entry, 'node_modules', name))) {
        required = true;
        break;
      }
    }
    if (required) continue;
    for (const linkDir of [path.join(nodeModules, name), path.join(storeDir, 'node_modules', name)]) {
      if (await utils.isStoreLink(linkDir)) {
        await utils.rimraf(linkDir);
        logger.log('%s %s %s', chalk.red('-'), chalk.yellow(name), chalk.gray(linkDir.replace(root, '.')));
      }
    }
  }
};

async function uninstall(pkg, options) {
  const pkgRoot = path.join(options.targetDir, 'node_modules', pkg.name);
  const pkgInfo = await utils.readJSON(path.join(pkgRoot, 'package.json'));
  await utils.rimraf(pkgRoot);
  const pkgFile = path.resolve(options.targetDir, 'package.json');
  if (await utils.exists(pkgFile)) {
    await utils.pruneJSON(pkgFile, pkg.name);
  }
  const rootPrefix = options.workspaceRoot || options.root;
  options.console.log('%s %s %s', chalk.red('-'), chalk.yellow(pkg.name), chalk.gray(pkgRoot.replace(rootPrefix, '.')));

  // 与 lib/bin.js 一致先规范化, 字符串形式的 bin 也能按包名删除
  normalize(pkgInfo);
  for (const file of Object.keys(pkgInfo.bin || {})) {
    const binPath = path.join(options.binDir, file);
    for (const target of await utils.listBinShims(binPath)) {
      await utils.rimraf(target);
      options.console.log(
        '%s %s %s',
        chalk.red('-'),
        chalk.yellow(pkg.name),
        chalk.gray(target.replace(rootPrefix, '.'))
      );
    }
  }
  return true;
}
