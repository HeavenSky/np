// npd-x prune: 删除 node_modules 中不再被任何链接引用的包版本目录
'use strict';

const path = require('path');
const chalk = require('chalk');
const parseArgs = require('minimist');
const prune = require('../prune');
const utils = require('../utils');
const help = require('./help');

module.exports = async function pruneCommand(args) {
  try {
    await main(args);
  } catch (err) {
    utils.exitWithError('npd-x prune', err);
  }
};

async function main(args) {
  utils.rejectRemovedArgs(args, { root: 'run npd-x prune in that folder instead' });
  const argv = parseArgs(args, {
    boolean: ['help', 'version', 'dry-run', 'global'],
    alias: { h: 'help', v: 'version', g: 'global' },
  });
  if (argv.version) {
    console.log(`npd v${require('../../package.json').version}`);
    return;
  }
  if (argv.help) {
    console.log(help.prune());
    return;
  }
  if (argv.global) {
    throw new Error('-g is not supported, global packages are not supported');
  }
  const root = process.cwd();
  const dryRun = argv['dry-run'];
  const { removed, kept } = await prune({ root, dryRun });
  for (const entry of removed) {
    console.log('%s %s', dryRun ? 'would remove' : chalk.gray('removed'), entry);
  }
  console.log(
    '%s %s unreferenced package version(s) in %s, kept %s',
    dryRun ? 'Found' : 'Removed',
    removed.length,
    path.join(root, 'node_modules'),
    kept
  );
}
