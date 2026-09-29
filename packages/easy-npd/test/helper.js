'use strict';

const { rimraf, mkdirp } = require('../lib/utils');
const path = require('path');
const { randomUUID } = require('crypto');
const { readFileSync } = require('fs');
const { writeFile } = require('fs/promises');

const fixtures = path.join(__dirname, 'fixtures');

exports.cleanup = (...dirs) => {
  return async () => {
    await Promise.all(dirs.map(dir => rimraf(path.join(dir, 'node_modules'))));
  };
};

// 安装默认 --save 会改写被跟踪的 fixture package.json, 清理时写回加载时的内容
exports.restoreFile = file => {
  const content = readFileSync(file);
  return async () => writeFile(file, content);
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

exports.npminstall = path.join(__dirname, '..', 'bin', 'install.js');

exports.readJSON = require('../lib/utils').readJSON;
