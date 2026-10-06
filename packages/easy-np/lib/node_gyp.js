// node-gyp-bin 的入口: 定位要执行的 node-gyp, 首次使用时用本包 CLI 把兼容当前 Node.js 的 node-gyp 安装进缓存目录
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const runtime = require('./runtime');

const INSTALL_TIMEOUT = 10 * 60 * 1000;
// 必须大于 INSTALL_TIMEOUT, 否则会删掉其他进程正在安装的目录
const ORPHAN_AGE = 60 * 60 * 1000;
const INSTALL_DIR_RE = /^v\d+\.\d+\.\d+\S*-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHIM_DIR = path.join(__dirname, '../node-gyp-bin');
const CLI = path.join(__dirname, '../bin/i.js');

function cacheDir() {
  return process.env.np_cache || process.env.npm_config_cache || path.join(os.homedir(), '.np_tarball');
}

function realpath(file) {
  try {
    return fs.realpathSync(file);
  } catch {
    return file;
  }
}

// 用户或 npm 指定的 node-gyp; 指向本包 node-gyp-bin 时忽略, 否则自己调用自己无限递归
function configuredBin() {
  const file = process.env.npm_config_node_gyp;
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
  if (path.dirname(realpath(file)) === realpath(SHIM_DIR)) return null;
  return file;
}

function binOf(dir, name) {
  return path.join(dir, 'node_modules', name, 'bin/node-gyp.js');
}

function readPointer(pointer, pkg) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(pointer, 'utf8'));
  } catch {
    return null;
  }
  if (data.spec !== pkg.spec || typeof data.dir !== 'string') return null;
  const bin = binOf(path.resolve(path.dirname(pointer), data.dir), pkg.name);
  return fs.existsSync(bin) ? bin : null;
}

function fail(reason) {
  console.error('np ERROR %s', reason);
  console.error(
    'np ERROR install node-gyp manually with `npm i -g node-gyp`, then set npm_config_node_gyp to <npm root -g>/node-gyp/bin/node-gyp.js'
  );
  process.exit(1);
}

// 并发构建可能同时安装: 各自装进独立目录, 装完后原子替换指针, 读到的指针总是指向已装完的目录
function install(baseDir, pointer, pkg) {
  const name = `${process.version}-${randomUUID()}`;
  const dir = path.join(baseDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), '{"private": true}\n');
  console.error('np installing %s into %s for Node %s', pkg.spec, dir, process.version);
  const args = [CLI, `--root=${dir}`, '--no-lockfile', '--no-save', '--ignore-scripts'];
  if (process.env.npm_config_registry) args.push(`--registry=${process.env.npm_config_registry}`);
  args.push(pkg.spec);
  // stdout 只能有 node-gyp 自己的输出, 调用方可能解析它; 安装日志全部写到 stderr
  const result = spawnSync(process.execPath, args, {
    stdio: ['ignore', 2, 2],
    timeout: INSTALL_TIMEOUT,
    env: { ...process.env, np_node_warning: 'false' },
  });
  const bin = binOf(dir, pkg.name);
  let reason = null;
  if (result.error) {
    reason =
      result.error.code === 'ETIMEDOUT'
        ? `installing ${pkg.spec} timed out after ${INSTALL_TIMEOUT / 60000} minutes`
        : `installing ${pkg.spec} failed: ${result.error.message}`;
  } else if (result.status !== 0) {
    reason = `installing ${pkg.spec} failed with ${result.signal ? `signal ${result.signal}` : `exit code ${result.status}`}`;
  } else if (!fs.existsSync(bin)) {
    reason = `installing ${pkg.spec} did not produce ${path.relative(dir, bin)}`;
  }
  if (reason) {
    fs.rmSync(dir, { recursive: true, force: true });
    fail(reason);
  }
  const tmp = `${pointer}.${randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ spec: pkg.spec, dir: name }));
  fs.renameSync(tmp, pointer);
  removeOrphans(baseDir);
  return bin;
}

// 删除不被任何指针引用且超过 ORPHAN_AGE 的安装目录; 更新的目录可能属于尚未写指针的并发安装
function removeOrphans(baseDir) {
  try {
    const entries = fs.readdirSync(baseDir);
    const referenced = new Set();
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      try {
        const { dir } = JSON.parse(fs.readFileSync(path.join(baseDir, entry), 'utf8'));
        if (typeof dir === 'string') referenced.add(dir);
      } catch {
        // 读不了的指针不影响清理其他目录
      }
    }
    const now = Date.now();
    for (const entry of entries) {
      if (!INSTALL_DIR_RE.test(entry) || referenced.has(entry)) continue;
      const dir = path.join(baseDir, entry);
      try {
        if (now - fs.statSync(dir).mtimeMs > ORPHAN_AGE) fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // 其他进程同时清理时目录可能已不存在
      }
    }
  } catch {
    // 清理失败不影响本次构建
  }
}

exports.resolveBin = () => {
  const configured = configuredBin();
  if (configured) return configured;
  const pkg = runtime.nodeGypPackage();
  const baseDir = path.join(cacheDir(), 'np-node-gyp');
  const pointer = path.join(baseDir, `${process.version}.json`);
  return readPointer(pointer, pkg) || install(baseDir, pointer, pkg);
};
