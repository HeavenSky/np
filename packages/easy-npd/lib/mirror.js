// 公共源自动切换: npmmirror 与 npmjs 两个源, 当次运行测速决定先后, 失败时交替换源
'use strict';

const debug = require('debug')('npd:mirror');
const destroy = require('destroy');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const get = require('./get');

const ATTEMPTS = get.MIRROR_ATTEMPTS;
const PROBE_TIMEOUT = 10000;

const DEFAULT_SOURCES = {
  mirror: {
    registry: 'https://registry.npmmirror.com',
    prefixes: ['https://registry.npmmirror.com/'],
    binaryProbe: 'https://cdn.npmmirror.com/binaries/node/index.json',
  },
  official: {
    registry: 'https://registry.npmjs.org',
    prefixes: ['https://registry.npmjs.org/', 'https://registry.npmjs.com/'],
    binaryProbe: 'https://nodejs.org/dist/index.json',
  },
};

exports.ATTEMPTS = ATTEMPTS;
exports.DEFAULT_SOURCES = DEFAULT_SOURCES;

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
 *  - {Array<String>} order - registry 与 tgz 的尝试先后, 如 ['mirror', 'official']
 *  - {Array<String>} binaryOrder - 二进制与 node 源的尝试先后
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
    // 包目录 => 该包安装脚本当前使用的二进制源
    binarySources: new Map(),
    sources,
    registry: sources[state.order[0]].registry,
    officialRegistry: sources.official.registry,
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

// 同时请求各地址, 返回最先成功的下标, 其余请求不再等待; 全部失败返回 -1
function race(urls, requestOptions, globalOptions) {
  return new Promise(resolve => {
    let pending = urls.length;
    let settled = false;
    urls.forEach((url, index) => {
      get(url, { ...requestOptions, headers: {}, retry: 1, timeout: PROBE_TIMEOUT }, globalOptions).then(
        result => {
          if (requestOptions.streaming) {
            // 测速只看首个响应, 主动断开连接会触发 abort 错误, 不监听会成为未捕获异常
            result.res.on('error', () => {});
            destroy(result.res);
          }
          if (!settled) {
            settled = true;
            debug('probe winner %s', url);
            resolve({ index, result });
          }
        },
        err => {
          debug('probe %s error: %s', url, err.message);
          if (--pending === 0 && !settled) resolve({ index: -1 });
        }
      );
    });
  });
}

// 不测速时的先后: 指定的源在前, 否则按 sources 的定义顺序
exports.defaultOrder = ({ prefer, sources = DEFAULT_SOURCES } = {}) => {
  const names = Object.keys(sources);
  const order = prefer ? [prefer, ...names.filter(name => name !== prefer)] : names;
  return { order, binaryOrder: order };
};

/**
 * 测速决定两个源的先后; prefer 为 --registry 指定的公共源, 此时跳过 registry 测速
 * cacheDir 与 cacheMinutes 都有效时, 优先使用 cacheMinutes 分钟内同一 prefer 的成功测速结果
 * @return {Object} { order, binaryOrder, binaryMirrorConfig, cached } binaryMirrorConfig 为测速顺带取到的 binary-mirror-config
 */
exports.probe = async ({ prefer, sources = DEFAULT_SOURCES, globalOptions, cacheDir, cacheMinutes = 0 }) => {
  const cacheFile = cacheDir && cacheMinutes > 0 ? path.join(cacheDir, PROBE_CACHE_FILE) : null;
  if (cacheFile) {
    const cached = await readProbeCache(cacheFile, { prefer, sources, maxAge: cacheMinutes * 60000 });
    if (cached) return { ...cached, cached: true };
  }
  const names = Object.keys(sources);
  const reorder = index => (index < 0 ? names : [names[index], ...names.filter((_, i) => i !== index)]);
  const registryProbe = race(
    names.map(name => `${sources[name].registry}/binary-mirror-config/latest`),
    { dataType: 'json', followRedirect: true },
    globalOptions
  );
  const binaryProbe = prefer
    ? Promise.resolve({ index: names.indexOf(prefer) })
    : race(
        names.map(name => sources[name].binaryProbe),
        { streaming: true, followRedirect: true },
        globalOptions
      );
  const [registryResult, binaryResult] = await Promise.all([registryProbe, binaryProbe]);
  const result = {
    order: prefer ? reorder(names.indexOf(prefer)) : reorder(registryResult.index),
    binaryOrder: reorder(binaryResult.index),
    binaryMirrorConfig: registryResult.result?.data,
  };
  // 测速失败时的顺序只是兜底, 不缓存, 下次运行重新测速
  if (cacheFile && registryResult.index >= 0 && binaryResult.index >= 0) {
    await writeProbeCache(cacheFile, { prefer, sources }, result);
  }
  return result;
};

// 依赖的安装脚本会自行下载二进制, 失败时切换二进制镜像与官方地址交替重试; 根包脚本与未启用换源时直接执行
exports.runScript = async (root, cmd, options) => {
  const utils = require('./utils');
  const state = options.mirror;
  if (!state || root === options.root) {
    return await utils.runScript(root, cmd, options);
  }
  const { useBinarySource } = require('./download/npm');
  for (let attempt = 1; ; attempt++) {
    const source = state.binarySources.get(root) || state.binaryOrder[0];
    const env = { ...options.env };
    for (const key in state.binaryEnvs) delete env[key];
    if (source === 'mirror') Object.assign(env, state.binaryEnvs);
    try {
      return await utils.runScript(root, cmd, { ...options, env });
    } catch (err) {
      if (attempt >= ATTEMPTS) throw err;
      const next = state.binaryOrder.find(name => name !== source);
      state.binarySources.set(root, next);
      options.console.warn(
        '[npd:runscript] %s failed, retry with %s binary source (%s/%s): %s',
        cmd,
        next,
        attempt + 1,
        ATTEMPTS,
        err.message
      );
      await useBinarySource(root, next, options);
    }
  }
};
