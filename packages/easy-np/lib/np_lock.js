// np-lock.json 的读写: 记录每个依赖声明(name@spec)解析出的 manifest, 下次安装原样复用
const path = require('node:path');
const fs = require('node:fs/promises');
const utils = require('./utils');

// 文件名与 JSON 结构与 easy-npd 共用, 改动时 MUST 同步修改另一个包, 否则切换工具时会读到不兼容的锁文件
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

// 内容不变时不写盘; 返回是否写入
exports.write = async (root, packages) => {
  const sorted = {};
  for (const key of Object.keys(packages).sort()) {
    sorted[key] = utils.omitPackage(packages[key]);
  }
  const content = `${JSON.stringify({ lockfileVersion: LOCKFILE_VERSION, packages: sorted }, null, 2)}\n`;
  const file = path.join(root, LOCKFILE_NAME);
  const previous = await fs.readFile(file, 'utf8').catch(() => null);
  if (previous === content) return false;
  await fs.writeFile(file, content);
  return true;
};
