'use strict';

const path = require('path');
const parseArgs = require('minimist');
const { rimraf, redact } = require('../utils');
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
    console.error(redact(err));
    process.exit(-1);
  }
};

async function main(args) {
  const argv = parseArgs(args, {
    string: ['root'],
    boolean: ['help'],
    alias: {
      h: 'help',
    },
  });

  const root = argv.root || process.cwd();
  if (argv.help) return printHelp(root);
  const nodeModules = path.join(root, 'node_modules');
  console.log('[npd-x update] removing %s', nodeModules);
  await rimraf(nodeModules);
  console.log('[npd-x update] reinstall on %s', root);
  await install(args, { ignorePkgNames: true, ignoreLockfile: true });
}
