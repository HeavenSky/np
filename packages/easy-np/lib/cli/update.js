const path = require('node:path');
const parseArgs = require('minimist');
const utils = require('../utils');
const { rimraf, readWorkspaces, getWorkspaceInfos, exitWithError } = utils;
const help = require('./help');
const install = require('./install');

function printHelp() {
  console.log(help.update());
  process.exit(0);
}

module.exports = async function update(args) {
  try {
    await main(args);
  } catch (err) {
    exitWithError('np-x update', err);
  }
};

async function main(args) {
  utils.rejectRemovedArgs(args, {
    root: 'run np-x update in that folder instead',
    workspace: 'run np-x update inside the workspace folder instead',
    w: 'run np-x update inside the workspace folder instead',
  });
  const argv = parseArgs(args, {
    boolean: ['help', 'version', 'clean-only'],
    alias: {
      h: 'help',
      v: 'version',
    },
  });

  if (argv.version) {
    console.log(`np v${require('../../package.json').version}`);
    return;
  }
  if (argv.help) return printHelp();
  // 在 workspace 目录中运行时只清理并重装这个 workspace
  const { root, workspaceName } = await utils.resolveProjectRoot();
  const installWorkspaceNames = workspaceName ? [workspaceName] : [];
  const { workspaceRoots, workspacesMap } = await readWorkspaces(root);
  let cleanRoots = [];
  if (installWorkspaceNames.length > 0) {
    const installWorkspaceInfos = await getWorkspaceInfos(root, installWorkspaceNames, workspacesMap);
    if (installWorkspaceInfos.length === 0) {
      throw new Error(`No workspaces found: ${installWorkspaceNames.join(',')}`);
    }
    // 不清理 root/node_modules: 其中的 .store 被所有 workspace 共享, 只重装指定 workspace 无法恢复其他 workspace 的依赖
    cleanRoots = installWorkspaceInfos.map(info => info.root);
  } else {
    cleanRoots = [root, ...workspaceRoots];
  }
  for (const rootDir of cleanRoots) {
    const nodeModules = path.join(rootDir, 'node_modules');
    console.log('[np-x update] removing %s', nodeModules);
    await rimraf(nodeModules);
  }
  if (argv['clean-only']) {
    console.log('');
    return;
  }

  console.log('[np-x update] reinstall on %s', root);
  await install(args, { ignorePkgNames: true, ignoreLockfile: true });
}
