'use strict';

const path = require('path');
const parseArgs = require('minimist');
const utils = require('../utils');
const { rimraf } = utils;
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
    utils.exitWithError('npd-x update', err);
  }
};

async function main(args) {
  utils.rejectRemovedArgs(args, { root: 'run npd-x update in that folder instead' });
  const argv = parseArgs(args, {
    boolean: ['help', 'version', 'clean-only'],
    alias: {
      h: 'help',
      v: 'version',
    },
  });

  if (argv.version) {
    console.log(`npd v${require('../../package.json').version}`);
    return;
  }
  const root = process.cwd();
  if (argv.help) return printHelp();
  const nodeModules = path.join(root, 'node_modules');
  console.log('[npd-x update] removing %s', nodeModules);
  await rimraf(nodeModules);
  if (argv['clean-only']) {
    console.log('');
    return;
  }
  console.log('[npd-x update] reinstall on %s', root);
  await install(args, { ignorePkgNames: true, ignoreLockfile: true });
}
