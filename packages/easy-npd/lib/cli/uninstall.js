'use strict';

const debug = require('debug')('npd:cli:uninstall');
const npa = require('npm-package-arg');
const path = require('path');
const fs = require('fs/promises');
const parseArgs = require('minimist');
const execSync = require('child_process').execSync;

const utils = require('../utils');
const prune = require('../prune');
const uninstall = require('../uninstall');
const help = require('./help');

module.exports = async function uninstallCommand(args) {
  try {
    await main(args);
  } catch (err) {
    utils.exitWithError('npd-x uninstall', err);
  }
};

async function main(args) {
  utils.rejectRemovedArgs(args, {
    root: 'run npd-x uninstall in that folder instead',
    'ignore-scripts': 'uninstall runs no lifecycle scripts',
    save: 'packages are removed from dependencies, devDependencies, optionalDependencies and peerDependencies by default',
    'save-dev': 'use --write=dev',
    'save-optional': 'use --write=optional',
    S: 'packages are removed from dependencies by default',
    D: 'use --write=dev',
    O: 'use --write=optional',
  });
  const argv = parseArgs(args, {
    string: ['prefix', 'write'],
    boolean: ['version', 'help', 'global'],
    alias: {
      v: 'version',
      h: 'help',
      g: 'global',
    },
  });
  // npd-x uninstall --write bar 会把包名 bar 当作类型吞掉, 只接受 --write=<type>
  if (args.includes('--write')) throw new Error('--write only accepts the --write=<type> form, e.g. --write=dev');
  const writeType = argv.write === undefined ? null : String(argv.write);
  if (writeType !== null && !/^[a-z][a-zA-Z0-9]*$/.test(writeType)) {
    throw new Error(`--write takes one dependency type like prod or dev, got "${writeType}"`);
  }

  if (argv.version) {
    console.log(`npd v${require('../../package.json').version}`);
    process.exit(0);
  }

  if (argv.help) printHelp();

  const pkgs = [];

  for (const name of argv._) {
    const p = npa(String(name));
    pkgs.push({ name: p.name, version: p.rawSpec });
  }

  if (!pkgs.length) printHelp();

  const root = process.cwd();
  const config = {
    root,
    pkgs,
    global: argv.global,
    targetDir: root,
    binDir: path.join(root, 'node_modules/.bin'),
  };

  if (argv.global) {
    // support custom prefix for global install
    const npmPrefix = argv.prefix || getPrefix();
    if (process.platform === 'win32') {
      config.targetDir = npmPrefix;
      config.binDir = npmPrefix;
    } else {
      config.targetDir = path.join(npmPrefix, 'lib');
      config.binDir = path.join(npmPrefix, 'bin');
    }
  }
  debug('uninstall in %s with pkg: %j, config: %j', root, pkgs, config);
  const uninstalled = await uninstall(config);
  if (uninstalled.length > 0) {
    // --write=<type> 同时从 package.json 的对应字段删除, prod 对应 dependencies
    if (writeType) {
      const fields = {
        prod: 'dependencies',
        dev: 'devDependencies',
        optional: 'optionalDependencies',
        peer: 'peerDependencies',
      };
      await updateDependencies(root, pkgs, fields[writeType] || `${writeType}Dependencies`);
    }
  }
  // 与 npm 一致, 卸载后回收不再被任何链接引用的版本目录
  if (!argv.global) await pruneUnreferenced(root);
}

async function pruneUnreferenced(root) {
  const { removed } = await prune({ root });
  for (const entry of removed) console.log('- %s', entry);
}

async function updateDependencies(root, pkgs, propName) {
  const pkgFile = path.join(root, 'package.json');
  const pkg = await utils.readJSON(pkgFile);
  const deps = pkg[propName];
  if (!deps) return;

  for (const pkg of pkgs) {
    delete deps[pkg.name];
  }

  await fs.writeFile(pkgFile, JSON.stringify(pkg, null, 2));
}

function printHelp() {
  console.log(help.uninstall());
  process.exit(0);
}

function getPrefix() {
  try {
    return execSync('npm config get prefix').toString().trim();
  } catch (err) {
    throw new Error(`exec npm config get prefix ERROR: ${err.message}`);
  }
}
