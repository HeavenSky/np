// node-gyp 入口: 找到或按需把兼容当前 Node.js 的 node-gyp 安装进磁盘缓存, 返回其 bin/node-gyp.js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const runtime = require('./runtime');

const SHIM_DIR = path.join(__dirname, '../node-gyp-bin');
const CLI = path.join(__dirname, '../bin/i.js');
const INSTALL_TIMEOUT = 10 * 60 * 1000;

// 取值顺序必须与 cli/install.js 的磁盘缓存目录一致
function cacheDir() {
  const root = process.env.np_cache || process.env.npm_config_cache || path.join(os.homedir(), '.np_tarball');
  return path.join(root, 'npd-node-gyp');
}

function binOf(dir, name) {
  return path.join(dir, 'node_modules', name, 'bin', 'node-gyp.js');
}

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

// npm_config_node_gyp 指向本包的 shim 时不能采用, 否则 require 命中模块缓存, 不执行 node-gyp 就以 0 退出
function isShim(file) {
  try {
    return path.dirname(fs.realpathSync(file)) === fs.realpathSync(SHIM_DIR);
  } catch {
    return false;
  }
}

function readPointer(pointer, name) {
  try {
    const { dir } = JSON.parse(fs.readFileSync(pointer, 'utf8'));
    const bin = binOf(dir, name);
    return isFile(bin) ? bin : null;
  } catch {
    return null;
  }
}

// 并发安装时各自装进独立目录, 指针经 rename 原子替换, 读到的总是装完的目录
function writePointer(pointer, dir) {
  const tmp = `${pointer}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ dir }));
  fs.renameSync(tmp, pointer);
}

function fail({ name, spec }, reason) {
  process.stderr.write(
    [
      `npd ERROR install ${spec} for node-gyp failed: ${reason}`,
      `npd ERROR install it manually and point npm_config_node_gyp at it, e.g.:`,
      `  npm i -g ${spec}`,
      `  export npm_config_node_gyp="$(npm root -g)/${name}/bin/node-gyp.js"`,
      '',
    ].join('\n')
  );
  process.exit(1);
}

function install(dir, pointer, { name, spec }) {
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'npd-node-gyp', private: true }));
  process.stderr.write(`npd node-gyp not found, installing ${spec} into ${dir}\n`);
  // node-gyp 及其依赖都没有安装脚本, --ignore-scripts 避免 allowScripts 告警与读取 npm 配置
  const args = [CLI, `--root=${dir}`, '--no-lockfile', '--no-save', '--ignore-scripts'];
  // 安装脚本环境中的源只在 npm_config_registry 上, CLI 不读它
  if (process.env.npm_config_registry) args.push(`--registry=${process.env.npm_config_registry}`);
  args.push(spec);
  const result = spawnSync(process.execPath, args, {
    // stdout 只能留给 node-gyp 自己的输出, 调用方会解析它
    stdio: ['ignore', 2, 2],
    timeout: INSTALL_TIMEOUT,
    env: { ...process.env, np_node_warning: 'false' },
  });
  const bin = binOf(dir, name);
  if (result.error) {
    throw new Error(result.error.code === 'ETIMEDOUT' ? 'timed out after 10 minutes' : result.error.message);
  }
  if (result.signal) throw new Error(`killed by ${result.signal}`);
  if (result.status !== 0) throw new Error(`exit code ${result.status}`);
  if (!isFile(bin)) throw new Error(`${bin} not found`);
  writePointer(pointer, dir);
  return bin;
}

exports.resolveBin = () => {
  const override = process.env.npm_config_node_gyp;
  if (override && isFile(override) && !isShim(override)) return override;
  const target = runtime.nodeGypPackage();
  const root = cacheDir();
  const pointer = path.join(root, `${process.version}.json`);
  const cached = readPointer(pointer, target.name);
  if (cached) return cached;
  const dir = path.join(root, `${process.version}-${crypto.randomUUID()}`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    return install(dir, pointer, target);
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true });
    return fail(target, err.message);
  }
};
