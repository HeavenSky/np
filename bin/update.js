#!/usr/bin/env node

const path = require('node:path');
const parseArgs = require('minimist');
const { rimraf, readWorkspaces, getWorkspaceInfos, formatWorkspaceNames, exitWithError } = require('../lib/utils');

function help(root) {
  console.log(`
Usage:

  np-update [--root=${root}]

Remove node_modules of root and workspaces, then reinstall.

Options:

  --root: project root directory, default is current working directory
  -w, --workspace: only clean the given workspace's node_modules then reinstall it, root node_modules and the shared store are kept
  --clean-only: only remove node_modules, don't reinstall
  -h, --help: show help
`);
  process.exit(0);
}

(async () => {
  const argv = parseArgs(process.argv.slice(2), {
    string: ['root', 'workspace'],
    boolean: ['help', 'clean-only'],
    alias: {
      h: 'help',
      w: 'workspace',
    },
  });

  const root = argv.root || process.cwd();
  if (argv.help) return help(root);
  const installWorkspaceNames = formatWorkspaceNames(argv);
  const { workspaceRoots, workspacesMap } = await readWorkspaces(root);
  let cleanRoots = [];
  if (installWorkspaceNames.length > 0) {
    const installWorkspaceInfos = await getWorkspaceInfos(root, installWorkspaceNames, workspacesMap);
    if (installWorkspaceInfos.length === 0) {
      throw new Error(`No workspaces found: --workspace=${installWorkspaceNames.join(',')}`);
    }
    // 不清理 root/node_modules: 其中的 .store 被所有 workspace 共享, 只重装指定 workspace 无法恢复其他 workspace 的依赖
    cleanRoots = installWorkspaceInfos.map(info => info.root);
  } else {
    cleanRoots = [root, ...workspaceRoots];
  }
  for (const rootDir of cleanRoots) {
    const nodeModules = path.join(rootDir, 'node_modules');
    console.log('[np-update] removing %s', nodeModules);
    await rimraf(nodeModules);
  }
  if (argv['clean-only']) {
    console.log('');
    return;
  }

  console.log('[np-update] reinstall on %s', root);
  // make sure install ignore all package names
  process.env.NP_BY_UPDATE = 'true';
  require('./install');
})().catch(err => {
  exitWithError('np-update', err);
});
