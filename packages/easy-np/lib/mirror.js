// 公共源自动切换: npmmirror 与 npmjs 两个源, 当次运行测速决定先后, 失败时交替换源
const debug = require('node:util').debuglog('np:mirror');
const destroy = require('destroy');
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
      get(url, { ...requestOptions, headers: {}, retry: 1, timeout: PROBE_TIMEOUT }, globalOptions, true).then(
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
 * @return {Object} { order, binaryOrder, binaryMirrorConfig } binaryMirrorConfig 为测速顺带取到的 binary-mirror-config
 */
exports.probe = async ({ prefer, sources = DEFAULT_SOURCES, globalOptions }) => {
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
  return {
    order: prefer ? reorder(names.indexOf(prefer)) : reorder(registryResult.index),
    binaryOrder: reorder(binaryResult.index),
    binaryMirrorConfig: registryResult.result?.data,
  };
};
