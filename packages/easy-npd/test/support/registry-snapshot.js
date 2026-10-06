'use strict';

// 测试用 registry 快照: 按 fixtures/registry-snapshot.json 过滤公共源返回的 manifest, 让 range 与 dist-tag 的解析结果不随新发布漂移
// NP_TEST_REGISTRY: 默认 replay 按快照过滤; record 追加快照里没有的包; refresh 重新记录全部包; live 不过滤
// tgz 内容按版本不可变, 只需固定 manifest 中可见的版本列表与 dist-tags
const fs = require('fs');
const path = require('path');

const SNAPSHOT_FILE = path.join(__dirname, '../fixtures/registry-snapshot.json');
const RECORD_DIR = path.join(__dirname, '../fixtures/.registry-snapshot-record');
const PUBLIC_HOSTS = new Set(['registry.npmmirror.com', 'registry.npmjs.org', 'registry.npmjs.com']);
const BIN_DIR = path.join(__dirname, '../../bin');

const mode = () => process.env.NP_TEST_REGISTRY || 'replay';

function loadSnapshot() {
  if (mode() === 'refresh') return {};
  try {
    return JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function isPublic(url) {
  try {
    return PUBLIC_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

function filterManifest(url, result, snapshot) {
  const data = result && result.status === 200 && result.data;
  if (!data || typeof data !== 'object' || !data.versions || !data['dist-tags'] || !data.name) return;
  if (!isPublic(url) && !isPublic(result.res?.requestUrls?.at(-1) || '')) return;
  const entry = snapshot[data.name];
  if (entry) {
    const allowed = new Set(entry.versions);
    for (const version of Object.keys(data.versions)) {
      if (!allowed.has(version)) delete data.versions[version];
    }
    data['dist-tags'] = { ...entry['dist-tags'] };
    return;
  }
  if (mode() !== 'record' && mode() !== 'refresh') return;
  const recorded = { 'dist-tags': data['dist-tags'], versions: Object.keys(data.versions) };
  snapshot[data.name] = recorded;
  fs.mkdirSync(RECORD_DIR, { recursive: true });
  fs.writeFileSync(path.join(RECORD_DIR, `${encodeURIComponent(data.name)}.json`), JSON.stringify(recorded));
}

// 替换 lib/get 的导出; 必须在其他模块 require('./get') 之前调用, 已拿到原函数的模块不受影响
exports.install = () => {
  if (mode() === 'live') return;
  // lib/get 与 lib/utils 互相引用, 先加载 utils 保持与正常启动相同的加载顺序, 否则 utils 拿到未初始化的 get
  require('../../lib/utils');
  const getPath = require.resolve('../../lib/get');
  const get = require(getPath);
  if (get.registrySnapshot) return;
  const snapshot = loadSnapshot();
  const wrapped = async (url, ...args) => {
    const result = await get(url, ...args);
    filterManifest(url, result, snapshot);
    return result;
  };
  Object.assign(wrapped, get, { registrySnapshot: true });
  require.cache[getPath].exports = wrapped;
};

// 子进程预加载入口: 只在本包的 CLI 中生效, 依赖的安装脚本等其他 node 进程不受影响
exports.preload = () => {
  const entry = process.argv[1] && path.resolve(process.argv[1]);
  if (entry && path.dirname(entry) === BIN_DIR) exports.install();
};

// 主进程: 快照变化后清掉测试 HOME 中未经过滤的 manifest 缓存; record 结束后把暂存的条目合并进快照
exports.prepareCache = manifestCacheDir => {
  const marker = path.join(manifestCacheDir, '..', '.registry-snapshot-mtime');
  const current = `${mode()}:${fs.existsSync(SNAPSHOT_FILE) ? fs.statSync(SNAPSHOT_FILE).mtimeMs : 0}`;
  const previous = fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8') : '';
  if (previous !== current) {
    fs.rmSync(manifestCacheDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(marker, current);
  }
};

exports.mergeRecords = () => {
  if (!fs.existsSync(RECORD_DIR)) return 0;
  const snapshot = loadSnapshot();
  const names = fs.readdirSync(RECORD_DIR);
  for (const name of names) {
    snapshot[decodeURIComponent(name.replace(/\.json$/, ''))] = JSON.parse(
      fs.readFileSync(path.join(RECORD_DIR, name), 'utf8')
    );
  }
  const sorted = {};
  for (const key of Object.keys(snapshot).sort()) sorted[key] = snapshot[key];
  fs.writeFileSync(SNAPSHOT_FILE, `${JSON.stringify(sorted, null, 1)}\n`);
  fs.rmSync(RECORD_DIR, { recursive: true, force: true });
  return names.length;
};
