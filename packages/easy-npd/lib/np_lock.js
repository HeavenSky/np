'use strict';

// np-lock.json 的读写: 记录每个依赖声明(name@spec)解析出的 manifest, 下次安装原样复用
const path = require('path');
const fs = require('fs/promises');
const npa = require('npm-package-arg');
const utils = require('./utils');

// 文件名与 JSON 结构与 easy-np 共用, 改动时 MUST 同步修改另一个包, 否则切换工具时会读到不兼容的锁文件
const LOCKFILE_NAME = 'np-lock.json';
const LOCKFILE_VERSION = 1;
// 已由其他包管理器锁定版本的项目不生成 np-lock.json, 避免两份锁文件互相矛盾
const FOREIGN_LOCKFILES = [
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
];

exports.LOCKFILE_NAME = LOCKFILE_NAME;

// 两个包的 keyOf 必须逐字相同, 否则共用的 np-lock.json 键对不上
function keyOf(name, spec) {
  if (spec.startsWith('workspace:')) return null;
  const arg = npa(`${name}@${spec}`);
  if (arg.type === 'alias') return npa(`${arg.subSpec.name}@${arg.subSpec.fetchSpec}`).raw;
  if (arg.type === 'file' || arg.type === 'directory') return null;
  return arg.raw;
}

exports.keyOf = keyOf;

exports.exists = root => utils.exists(path.join(root, LOCKFILE_NAME));

exports.hasForeignLockfile = async root => {
  for (const name of FOREIGN_LOCKFILES) {
    if (await utils.exists(path.join(root, name))) return true;
  }
  return false;
};

// 返回 { 'name@spec': manifest }; 文件损坏或版本不支持时报错, 不静默回退为联网解析
exports.read = async root => {
  const file = path.join(root, LOCKFILE_NAME);
  let data;
  try {
    data = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    throw new Error(`load ${file} error: ${err.message}`, { cause: err });
  }
  if (data.lockfileVersion !== LOCKFILE_VERSION || !data.packages || typeof data.packages !== 'object') {
    throw new Error(`${file} lockfileVersion ${data.lockfileVersion} is not supported, expected ${LOCKFILE_VERSION}`);
  }
  return data.packages;
};

// 写入时锁键去掉了 URL 凭据, 带凭据的声明直接按 raw 查找会静默错过锁定条目
exports.lookup = (tree, raw) => tree[raw] || tree[utils.stripUrlAuth(raw)];

// URL 中的凭据不写进锁文件; 按锁安装时 git / url 依赖仍从 package.json 的声明取地址, 凭据随声明带上
function withoutCredentials(pkg) {
  const res = { ...pkg };
  if (res._resolved) res._resolved = utils.stripUrlAuth(res._resolved);
  if (res.dist && res.dist.tarball) res.dist = { ...res.dist, tarball: utils.stripUrlAuth(res.dist.tarball) };
  return res;
}

// 内容不变时不写盘; 返回是否写入
exports.write = async (root, packages) => {
  const entries = {};
  for (const key of Object.keys(packages)) {
    entries[utils.stripUrlAuth(key)] = withoutCredentials(utils.omitPackage(packages[key]));
  }
  const sorted = {};
  for (const key of Object.keys(entries).sort()) sorted[key] = entries[key];
  const content = `${JSON.stringify({ lockfileVersion: LOCKFILE_VERSION, packages: sorted }, null, 2)}\n`;
  const file = path.join(root, LOCKFILE_NAME);
  const previous = await fs.readFile(file, 'utf8').catch(() => null);
  if (previous === content) return false;
  await fs.writeFile(file, content);
  return true;
};
