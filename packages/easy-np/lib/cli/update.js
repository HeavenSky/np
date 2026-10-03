const path = require('node:path');
const parseArgs = require('minimist');
const { rimraf, readWorkspaces, getWorkspaceInfos, formatWorkspaceNames, exitWithError } = require('../utils');
const help = require('./help');
const install = require('./install');

function printHelp(root) {
  console.log(help.update(root));
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
  const argv = parseArgs(args, {
    string: ['root', 'workspace'],
    boolean: ['help', 'clean-only'],
    alias: {
      h: 'help',
      w: 'workspace',
    },
  });

  const root = argv.root || process.cwd();
  if (argv.help) return printHelp(root);
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
    console.log('[np-x update] removing %s', nodeModules);
    await rimraf(nodeModules);
  }
  if (argv['clean-only']) {
    console.log('');
    return;
  }

  console.log('[np-x update] reinstall on %s', root);
  await install(args, { ignorePkgNames: true });
}
