const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { rimraf, mkdirp } = require('../lib/utils');

const fixtures = path.join(__dirname, 'fixtures');

exports.cleanup = (...dirs) => {
  return async () => {
    await Promise.all(dirs.map(dir => rimraf(path.join(dir, 'node_modules'))));
  };
};

exports.fixtures = name => {
  return path.join(fixtures, name);
};

exports.tmp = name => {
  const dir = exports.fixtures(name || `.tmp_${randomUUID()}`);
  const cleanup = async () => {
    try {
      // avoid Error: ENOTEMPTY: directory not empty, rmdir
      await rimraf(dir);
    } catch {
      // ignore error
    }
    await mkdirp(dir);
  };
  return [dir, cleanup];
};

exports.npminstall = path.join(__dirname, '..', 'bin', 'i.js');
// 子命令用法: coffee.fork(helper.x, ['uninstall', ...args])
exports.x = path.join(__dirname, '..', 'bin', 'x.js');

exports.readJSON = require('../lib/utils').readJSON;
