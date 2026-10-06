'use strict';

// 依赖包的安装进度标记: 集中记在 store 根目录的状态文件中, 不写入依赖包自己的 package.json
const path = require('path');
const fs = require('fs/promises');
const { randomUUID } = require('crypto');

const STATE_FILE = '.npd-state.json';
// 0.0.2 及更早版本把标记写在包的 package.json 里; 状态文件中没有该包时按旧标记判断, 升级后不必重装整个 node_modules
const LEGACY_DONE_KEY = '__npd_done';
const LEGACY_STAGE_KEY = '__npd_stage';

// 包实体位于 node_modules/_<name>@<version>@<name>(全局安装为 .<name>_npd/_<name>@<version>@<name>), 状态文件放在该目录下
function locate(realRoot) {
  let dir = realRoot;
  for (;;) {
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    const base = path.basename(parent);
    if (base === 'node_modules' || /^\..+_npd$/.test(base)) {
      // 项目根或其他工具装出的目录不在 _<name>@<version>@<name> 下, 退回写 package.json
      if (!path.basename(dir).startsWith('_')) return null;
      return { file: path.join(parent, STATE_FILE), key: path.relative(parent, realRoot).split(path.sep).join('/') };
    }
    dir = parent;
  }
}

async function readEntries(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')).packages || {};
  } catch {
    // 状态文件缺失或损坏时视为没有记录: 包会被当作未完成而重新处理, 不会被误判为已完成
    return {};
  }
}

async function statSignature(file) {
  const stat = await fs.stat(file).catch(() => null);
  return stat ? `${stat.ino}:${stat.size}:${stat.mtimeMs}` : null;
}

class StateFile {
  constructor(file) {
    this.file = file;
    this.entries = {};
    this.signature = undefined;
    // 本进程改过但还没写盘的键; 写盘时只用它们覆盖磁盘内容, 保留其他进程(例如依赖脚本里再次执行的 npd)写入的条目
    this.touched = new Set();
    this.queued = null;
    this.last = Promise.resolve();
  }

  // 每次读写前按文件签名判断是否被其他进程改过或已随 node_modules 删除
  async sync() {
    const signature = await statSignature(this.file);
    if (signature === this.signature) return;
    const pending = {};
    for (const key of this.touched) pending[key] = this.entries[key];
    this.entries = Object.assign(signature ? await readEntries(this.file) : {}, pending);
    this.signature = signature;
  }

  async get(key) {
    await this.sync();
    return this.entries[key];
  }

  async set(key, entry) {
    await this.sync();
    this.entries[key] = entry;
    this.touched.add(key);
    await this.flush();
  }

  // 合并并发的写入: 已排队但未开始的写入会带上之后的修改, 调用方都等到包含自己修改的那次写盘完成
  flush() {
    if (!this.queued) {
      const run = this.last.then(() => {
        this.queued = null;
        return this.write();
      });
      this.queued = run;
      this.last = run.catch(() => {});
    }
    return this.queued;
  }

  async write() {
    const keys = [...this.touched];
    const entries = await readEntries(this.file);
    for (const key of keys) {
      if (this.entries[key]) entries[key] = this.entries[key];
      else delete entries[key];
    }
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    // 先写临时文件再改名, 中断或并发读取时不会看到写了一半的 JSON
    const tmpFile = `${this.file}.${randomUUID()}.tmp`;
    await fs.writeFile(tmpFile, JSON.stringify({ version: 1, packages: entries }));
    await fs.rename(tmpFile, this.file);
    for (const key of keys) {
      if (this.entries[key] === entries[key] || (!this.entries[key] && !entries[key])) this.touched.delete(key);
    }
    for (const key in entries) {
      if (!this.touched.has(key)) this.entries[key] = entries[key];
    }
    this.signature = await statSignature(this.file);
  }
}

const stateFiles = new Map();

async function open(pkgRoot) {
  const realRoot = await fs.realpath(pkgRoot).catch(() => path.resolve(pkgRoot));
  const location = locate(realRoot);
  if (!location) return null;
  let stateFile = stateFiles.get(location.file);
  if (!stateFile) {
    stateFile = new StateFile(location.file);
    stateFiles.set(location.file, stateFile);
  }
  return { stateFile, key: location.key, realRoot };
}

async function readLegacy(pkgRoot) {
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(pkgRoot, 'package.json'), 'utf8'));
    if (!(LEGACY_DONE_KEY in pkg) && !(LEGACY_STAGE_KEY in pkg)) return undefined;
    return { done: pkg[LEGACY_DONE_KEY], stage: pkg[LEGACY_STAGE_KEY] };
  } catch {
    return undefined;
  }
}

// 返回 { done, stage } 或 undefined(没有任何标记)
exports.get = async pkgRoot => {
  const opened = await open(pkgRoot);
  const entry = opened ? await opened.stateFile.get(opened.key) : undefined;
  return entry || (await readLegacy(pkgRoot));
};

// patch 中值为 undefined 的字段被删除; 不在 store 中的目录(无法定位状态文件)仍写入 package.json
exports.update = async (pkgRoot, patch) => {
  const opened = await open(pkgRoot);
  if (!opened) {
    const legacy = {};
    if ('done' in patch) legacy[LEGACY_DONE_KEY] = patch.done;
    if ('stage' in patch) legacy[LEGACY_STAGE_KEY] = patch.stage;
    return legacy;
  }
  const previous = (await opened.stateFile.get(opened.key)) || (await readLegacy(pkgRoot)) || {};
  const entry = { ...previous, ...patch };
  for (const key of Object.keys(entry)) {
    if (entry[key] === undefined) delete entry[key];
  }
  await opened.stateFile.set(opened.key, entry);
  return null;
};
