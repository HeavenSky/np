#!/usr/bin/env node

const debug = require('node:util').debuglog('np:bin:uninstall');
const path = require('node:path');
const npa = require('npm-package-arg');
const parseArgs = require('minimist');
const utils = require('../lib/utils');
const uninstall = require('../lib/uninstall');

const argv = parseArgs(process.argv.slice(2), {
  string: ['root', 'prefix', 'workspace'],
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
    w: 'workspace',
  },
});

if (argv.version) {
  console.log('v%s', require('../package.json').version);
  process.exit(0);
}

if (argv.help) help();

const pkgs = [];

for (const name of argv._) {
  const p = npa(String(name));
  pkgs.push({ name: p.name, version: p.rawSpec });
}

if (!pkgs.length) help();

(async () => {
  const root = argv.root || process.cwd();
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

  const installWorkspaceNames = utils.formatWorkspaceNames(argv);
  const { workspaceRoots, workspacesMap } = await utils.readWorkspaces(root);
  let uninstallRoots = [];
  const enableWorkspace = workspacesMap.size > 0;
  if (enableWorkspace) {
    if (installWorkspaceNames.length > 0) {
      // uninstall <pkg> -w <name>
      const installWorkspaceInfos = await utils.getWorkspaceInfos(root, installWorkspaceNames, workspacesMap);
      if (installWorkspaceInfos.length === 0) {
        throw new Error(`No workspaces found: --workspace=${installWorkspaceNames.join(',')}`);
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
  }
  // 全部目标卸载完再统一判断, 避免 --workspaces 批量卸载时前一个 workspace 的判断受尚未卸载的后者影响
  await uninstall.cleanupHoistedLinks(
    root,
    pkgs.map(pkg => pkg.name)
  );
  console.log('');
})().catch(err => {
  utils.exitWithError('np-uninstall', err);
});

function help() {
  console.log(`
Usage:

  np-uninstall <pkg>
  np-uninstall <pkg>@<version>
  np-uninstall <pkg>@<version> [<pkg>@<version>]

Options:

  --root: project root directory, default is current working directory
  -g, --global: uninstall from the global directory
  --prefix: global install prefix used with -g, default is '$npm config get prefix'
  -w, --workspace: uninstall on one workspace only, e.g.: np-uninstall koa -w a
  --workspaces: uninstall on all workspaces
  -v, --version: show version
  -h, --help: show help
`);
  process.exit(0);
}
