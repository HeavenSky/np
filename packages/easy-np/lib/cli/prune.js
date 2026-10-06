// np-x prune: 删除 .store 中不再被任何链接引用的包版本目录
const path = require('node:path');
const chalk = require('chalk');
const parseArgs = require('minimist');
const utils = require('../utils');
const prune = require('../prune');
const help = require('./help');

module.exports = async function pruneCommand(args) {
  try {
    await main(args);
  } catch (err) {
    utils.exitWithError('np-x prune', err);
  }
};

async function main(args) {
  const argv = parseArgs(args, {
    string: ['root'],
    boolean: ['help', 'dry-run', 'global'],
    alias: { h: 'help', g: 'global' },
  });
  if (argv.help) {
    console.log(help.prune());
    return;
  }
  if (argv.global) {
    throw new Error('-g is not supported, global packages have no shared .store');
  }
  const root = path.resolve(argv.root || process.cwd());
  const dryRun = argv['dry-run'];
  const { removed, kept } = await prune({ root, dryRun });
  for (const entry of removed) {
    console.log('%s %s', dryRun ? 'would remove' : chalk.gray('removed'), entry);
  }
  console.log(
    '%s %s unreferenced package version(s) in %s, kept %s',
    dryRun ? 'Found' : 'Removed',
    removed.length,
    path.join(root, 'node_modules/.store'),
    kept
  );
}
