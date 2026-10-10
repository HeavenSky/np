// 公共源自动切换: 5 个公共 registry 测速取最快的 TOP 个, 失败时按先后逐个换源; 二进制在 npmmirror 与官方地址之间切换
const debug = require('node:util').debuglog('np:mirror');
const destroy = require('destroy');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const get = require('./get');

const ATTEMPTS = get.MIRROR_ATTEMPTS;
const BINARY_ATTEMPTS = get.BINARY_ATTEMPTS;
// 测速后参与重试的源个数, ATTEMPTS 次请求按这几个源循环
const TOP = 3;
const PROBE_TIMEOUT = 10000;

// binary 为选中该源时二进制默认走的源; 第一个 prefix 用于拼接地址, 其余只用于识别
const DEFAULT_SOURCES = {
  npm: {
    registry: 'https://registry.npmjs.org',
    prefixes: ['https://registry.npmjs.org/', 'https://registry.npmjs.com/'],
    binary: 'official',
  },
  yarn: {
    registry: 'https://registry.yarnpkg.com',
    prefixes: ['https://registry.yarnpkg.com/'],
    binary: 'official',
  },
  alibaba: {
    registry: 'https://registry.npmmirror.com',
    prefixes: ['https://registry.npmmirror.com/'],
    binary: 'mirror',
  },
  tencent: {
    registry: 'https://mirrors.tencent.com/npm',
    prefixes: ['https://mirrors.tencent.com/npm/', 'https://mirrors.cloud.tencent.com/npm/'],
    binary: 'mirror',
  },
  huawei: {
    registry: 'https://mirrors.huaweicloud.com/repository/npm',
    prefixes: ['https://mirrors.huaweicloud.com/repository/npm/', 'https://repo.huaweicloud.com/repository/npm/'],
    binary: 'mirror',
  },
};
// 镜像缺少要安装的版本时改从这个源获取
const OFFICIAL = 'npm';

// 二进制源的测速地址; mirror 选中时向安装脚本注入 binary-mirror-config 的环境变量
const DEFAULT_BINARY_SOURCES = {
  mirror: 'https://cdn.npmmirror.com/binaries/node/index.json',
  official: 'https://nodejs.org/dist/index.json',
};

exports.ATTEMPTS = ATTEMPTS;
exports.BINARY_ATTEMPTS = BINARY_ATTEMPTS;
exports.TOP = TOP;
exports.DEFAULT_SOURCES = DEFAULT_SOURCES;
exports.DEFAULT_BINARY_SOURCES = DEFAULT_BINARY_SOURCES;

// 测速结果缓存文件与 easy-np / easy-npd 共用, 改文件名或 JSON 结构时 MUST 同步修改另一个包
const PROBE_CACHE_FILE = 'np-probe.json';
exports.DEFAULT_PROBE_CACHE_MINUTES = 5;

// --probe-cache / np_probe_cache 的分钟数, 0 表示每次都测速
exports.parseProbeCacheMinutes = value => {
  if (value === undefined || value === null || value === '') return exports.DEFAULT_PROBE_CACHE_MINUTES;
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes < 0) {
    throw new Error(`--probe-cache must be a non-negative number of minutes, got ${value}`);
  }
  return minutes;
};

const sourcesKey = sources =>
  Object.keys(sources)
    .map(name => `${name}=${sources[name].registry}`)
    .join(',');

async function readProbeCache(file, { prefer, sources, maxAge }) {
  try {
    const cached = JSON.parse(await fs.readFile(file, 'utf8'));
    const age = Date.now() - cached.time;
    if (age >= 0 && age < maxAge && cached.prefer === (prefer || null) && cached.sources === sourcesKey(sources)) {
      return cached.result;
    }
  } catch (err) {
    debug('read probe cache %s error: %s', file, err.message);
  }
  return null;
}

async function writeProbeCache(file, { prefer, sources }, result) {
  // 先写临时文件再改名, 并发运行时其他进程不会读到写了一半的 JSON
  const tmpFile = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(
      tmpFile,
      JSON.stringify({ time: Date.now(), prefer: prefer || null, sources: sourcesKey(sources), result })
    );
    await fs.rename(tmpFile, file);
  } catch (err) {
    debug('write probe cache %s error: %s', file, err.message);
    await fs.rm(tmpFile, { force: true });
  }
}

// 返回 url 所属的公共源名, 私有源或其他地址返回 null
exports.sourceOf = (url, sources = DEFAULT_SOURCES) => {
  if (!url) return null;
  const normalized = url.endsWith('/') ? url : `${url}/`;
  for (const name in sources) {
    if (sources[name].prefixes.some(prefix => normalized.startsWith(prefix))) return name;
  }
  return null;
};

/**
 * @param {Object} state
 *  - {Array<String>} order - registry 与 tgz 的尝试先后, 如 ['alibaba', 'huawei', 'npm']
 *  - {Array<String>} binaryOrder - 二进制与 node 源的尝试先后, 如 ['mirror', 'official']
 *  - {Object} [binaryEnvs] - 镜像的二进制环境变量, 选中镜像时注入安装脚本
 *  - {Object} [sources] - 源定义, 默认 DEFAULT_SOURCES
 */
exports.create = state => {
  const sources = state.sources || DEFAULT_SOURCES;
  return {
    order: state.order,
    binaryOrder: state.binaryOrder,
    binaryEnvs: state.binaryEnvs || {},
    // 解压目录 => 二进制镜像改写前的快照, 由 download/npm.js 写入
    binaryPackages: new Map(),
    sources,
    registry: sources[state.order[0]].registry,
    officialRegistry: sources[OFFICIAL].registry,
    // 把属于公共源的 url 展开成按先后排列的各源地址; 不属于公共源时返回 null, 调用方保持原逻辑
    expand(url, order = state.order) {
      const from = exports.sourceOf(url, sources);
      if (!from) return null;
      const prefix = sources[from].prefixes.find(prefix => url.startsWith(prefix));
      const rest = url.slice(prefix.length);
      return order.map(name => sources[name].prefixes[0] + rest);
    },
  };
};

// 同时请求各地址, 按成功先后返回前 count 个下标, 其余请求不再等待; result 为最先成功的响应
function race(urls, requestOptions, globalOptions, count = 1) {
  return new Promise(resolve => {
    let pending = urls.length;
    const indexes = [];
    let first;
    const done = () => resolve({ indexes, index: indexes.length ? indexes[0] : -1, result: first });
    urls.forEach((url, index) => {
      get(url, { ...requestOptions, headers: {}, retry: 1, timeout: PROBE_TIMEOUT }, globalOptions, true).then(
        result => {
          if (requestOptions.streaming) {
            // 测速只看首个响应, 主动断开连接会触发 abort 错误, 不监听会成为未捕获异常
            result.res.on('error', () => {});
            destroy(result.res);
          }
          pending--;
          if (indexes.length >= count) return;
          debug('probe #%s %s', indexes.length + 1, url);
          if (!indexes.length) first = result;
          indexes.push(index);
          if (indexes.length === count || pending === 0) done();
        },
        err => {
          debug('probe %s error: %s', url, err.message);
          if (--pending === 0 && indexes.length < count) done();
        }
      );
    });
  });
}

// 指定的源在前, 其次是测速名次, 最后按定义顺序补足 TOP 个
function rankOrder(names, { prefer, ranked = [] }) {
  const order = [];
  for (const name of [prefer, ...ranked, ...names]) {
    if (name && !order.includes(name)) order.push(name);
  }
  return order.slice(0, TOP);
}

function binaryOrderOf(binaryNames, first) {
  return binaryNames.includes(first) ? [first, ...binaryNames.filter(name => name !== first)] : binaryNames;
}

// 不测速时的先后: 指定的源在前, 否则按 sources 的定义顺序; 二进制跟随第一个源
exports.defaultOrder = ({ prefer, sources = DEFAULT_SOURCES, binarySources = DEFAULT_BINARY_SOURCES } = {}) => {
  const order = rankOrder(Object.keys(sources), { prefer });
  return { order, binaryOrder: binaryOrderOf(Object.keys(binarySources), sources[order[0]].binary) };
};

/**
 * 测速决定各源的先后, 只保留最快的 TOP 个; prefer 为 --registry 指定的公共源, 此时它排第一, 二进制跟随它不再测速
 * cacheDir 与 cacheMinutes 都有效时, 优先使用 cacheMinutes 分钟内同一 prefer 的成功测速结果
 * @return {Object} { order, binaryOrder, binaryMirrorConfig, cached } binaryMirrorConfig 为测速顺带取到的 binary-mirror-config
 */
exports.probe = async ({
  prefer,
  sources = DEFAULT_SOURCES,
  binarySources = DEFAULT_BINARY_SOURCES,
  globalOptions,
  cacheDir,
  cacheMinutes = 0,
}) => {
  const cacheFile = cacheDir && cacheMinutes > 0 ? path.join(cacheDir, PROBE_CACHE_FILE) : null;
  if (cacheFile) {
    const cached = await readProbeCache(cacheFile, { prefer, sources, maxAge: cacheMinutes * 60000 });
    if (cached) return { ...cached, cached: true };
  }
  const names = Object.keys(sources);
  const binaryNames = Object.keys(binarySources);
  const registryProbe = race(
    names.map(name => `${sources[name].registry}/binary-mirror-config/latest`),
    { dataType: 'json', followRedirect: true },
    globalOptions,
    TOP
  );
  const binaryProbe = prefer
    ? Promise.resolve({ index: binaryNames.indexOf(sources[prefer].binary) })
    : race(
        binaryNames.map(name => binarySources[name]),
        { streaming: true, followRedirect: true },
        globalOptions
      );
  const [registryResult, binaryResult] = await Promise.all([registryProbe, binaryProbe]);
  const result = {
    order: rankOrder(names, { prefer, ranked: registryResult.indexes.map(index => names[index]) }),
    binaryOrder: binaryOrderOf(binaryNames, binaryNames[binaryResult.index]),
    binaryMirrorConfig: registryResult.result?.data,
  };
  // 测速失败时的顺序只是兜底, 不缓存, 下次运行重新测速
  if (cacheFile && registryResult.index >= 0 && binaryResult.index >= 0) {
    await writeProbeCache(cacheFile, { prefer, sources }, result);
  }
  return result;
};
