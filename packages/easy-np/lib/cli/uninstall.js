const debug = require('node:util').debuglog('np:cli:uninstall');
const path = require('node:path');
const fs = require('node:fs/promises');
const npa = require('npm-package-arg');
const parseArgs = require('minimist');
const utils = require('../utils');
const uninstall = require('../uninstall');
const prune = require('../prune');
const help = require('./help');

const WRITE_FIELDS = {
  prod: 'dependencies',
  dev: 'devDependencies',
  optional: 'optionalDependencies',
  peer: 'peerDependencies',
};

module.exports = async function uninstallCommand(args) {
  try {
    await main(args);
  } catch (err) {
    utils.exitWithError('np-x uninstall', err);
  }
};

async function main(args) {
  utils.rejectRemovedArgs(args, {
    root: 'run np-x uninstall in that folder instead',
    'ignore-scripts': 'uninstall runs no lifecycle scripts',
    save: 'packages are removed from dependencies, devDependencies, optionalDependencies and peerDependencies by default',
    'save-dev': 'use --write=dev',
    'save-optional': 'use --write=optional',
    S: 'packages are removed from dependencies by default',
    D: 'use --write=dev',
    O: 'use --write=optional',
    workspace: 'run np-x uninstall inside the workspace folder instead',
    w: 'run np-x uninstall inside the workspace folder instead',
  });
  const argv = parseArgs(args, {
    string: ['prefix', 'write'],
    boolean: [
      'version',
      'help',
      'global',
      // --ignore-scripts 已移除: uninstall 不执行任何生命周期脚本
      'workspaces',
    ],
    alias: {
      v: 'version',
      h: 'help',
      g: 'global',
      ws: 'workspaces',
    },
  });

  // np-x uninstall --write bar 会把包名 bar 当作类型吞掉, 只接受 --write=<type>
  if (args.includes('--write')) throw new Error('--write only accepts the --write=<type> form, e.g. --write=client');
  const writeType = argv.write === undefined ? null : String(argv.write);
  if (writeType !== null && !/^[a-z][a-zA-Z0-9]*$/.test(writeType)) {
    throw new Error(`--write takes one dependency type like client or dev, got "${writeType}"`);
  }
  const writeField = writeType && (WRITE_FIELDS[writeType] || `${writeType}Dependencies`);

  if (argv.version) {
    console.log(`np v${require('../../package.json').version}`);
    process.exit(0);
  }

  if (argv.help) printHelp();

  const pkgs = [];

  for (const name of argv._) {
    const p = npa(String(name));
    pkgs.push({ name: p.name, version: p.rawSpec });
  }

  if (!pkgs.length) printHelp();

  const { root, workspaceName } = argv.global
    ? { root: process.cwd(), workspaceName: null }
    : await utils.resolveProjectRoot();
  const config = {
    root,
    pkgs,
    global: argv.global,
    targetDir: root,
    binDir: path.join(root, 'node_modules/.bin'),
  };

  if (argv.global) {
    // support custom prefix for global install
    const meta = utils.getGlobalInstallMeta(argv.prefix);
    config.targetDir = meta.targetDir;
    config.binDir = meta.binDir;
    debug('uninstall global package in %s with pkg: %j, config: %j', root, pkgs, config);
    await uninstall(config);
    return;
  }

  const installWorkspaceNames = workspaceName && !argv.workspaces ? [workspaceName] : [];
  const { workspaceRoots, workspacesMap } = await utils.readWorkspaces(root);
  let uninstallRoots = [];
  const enableWorkspace = workspacesMap.size > 0;
  if (enableWorkspace) {
    if (installWorkspaceNames.length > 0) {
      // uninstall <pkg> -w <name>
      const installWorkspaceInfos = await utils.getWorkspaceInfos(root, installWorkspaceNames, workspacesMap);
      if (installWorkspaceInfos.length === 0) {
        throw new Error(`No workspaces found: ${installWorkspaceNames.join(',')}`);
      }
      uninstallRoots = installWorkspaceInfos.map(info => info.root);
    } else {
      if (argv.workspaces) {
        // uninstall <pkg> --workspaces
        uninstallRoots = workspaceRoots;
      } else {
        // uninstall <pkg>
        uninstallRoots = [root];
      }
    }
  } else {
    // uninstall <pkg>
    uninstallRoots = [root];
  }

  for (const uninstallRoot of uninstallRoots) {
    const unsinstallRootConfig = {
      ...config,
      root: uninstallRoot,
      targetDir: uninstallRoot,
      binDir: path.join(uninstallRoot, 'node_modules/.bin'),
      enableWorkspace,
      workspaceRoot: root,
    };
    debug('uninstall in %s with pkg: %j, config: %j', uninstallRoot, pkgs, unsinstallRootConfig);
    await uninstall(unsinstallRootConfig);
    // dependencies, devDependencies, optionalDependencies 与 peerDependencies 总是删除, --write=<type> 另外从对应字段删除
    if (writeField) await removeFromField(uninstallRoot, pkgs, writeField);
  }
  // 全部目标卸载完再统一判断, 避免 --workspaces 批量卸载时前一个 workspace 的判断受尚未卸载的后者影响
  await uninstall.cleanupHoistedLinks(
    root,
    pkgs.map(pkg => pkg.name)
  );
  // 与 npm 一致, 卸载后回收 .store 中不再被任何链接引用的版本目录
  const { removed } = await prune({ root });
  for (const entry of removed) console.log('- %s', entry);
  console.log('');
}

async function removeFromField(root, pkgs, field) {
  const pkgFile = path.join(root, 'package.json');
  const pkg = await utils.readJSON(pkgFile);
  if (!pkg[field]) return;
  for (const { name } of pkgs) delete pkg[field][name];
  await fs.writeFile(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
}

function printHelp() {
  console.log(help.uninstall());
  process.exit(0);
}
