// 运行时能力表: 按当前 Node.js 版本决定各能力用哪种实现, 其余代码只查这张表, 不各自判断版本
const semver = require('semver');

// range 必须等于对应版本线的 engines.node(modern: node-gyp 12, fallback: node-gyp 10), 未写 version 时 CLI 按 engines.node 选版本, 不一致时降级告警与实际装上的版本不符
const CAPABILITIES = {
  nodeGyp: {
    modern: { range: '^20.17.0 || >=22.9.0', module: 'node-gyp' },
    fallback: {
      range: '^16.14.0 || >=18.0.0',
      module: 'node-gyp',
      degraded: 'node-gyp < 12 (Visual Studio 2026 is unsupported)',
    },
    legacy: {
      module: '@electron/node-gyp',
      version: '^10.2.0-electron.2',
      degraded: 'node-gyp < 12 (Visual Studio 2026 is unsupported)',
    },
  },
};

exports.CAPABILITIES = CAPABILITIES;

// tar 7 解压时调用 String#replaceAll(Node >= 15)与 Array#at(Node >= 16.6), 更低版本上缺失时补上, 否则所有 tgz 解压失败
function definePolyfill(proto, name, value) {
  if (!proto[name]) Object.defineProperty(proto, name, { value, writable: true, configurable: true });
}

definePolyfill(String.prototype, 'replaceAll', function (pattern, replacement) {
  if (pattern instanceof RegExp) {
    if (!pattern.global) throw new TypeError('replaceAll must be called with a global RegExp');
    return this.replace(pattern, replacement);
  }
  return this.replace(new RegExp(String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), replacement);
});

definePolyfill(Array.prototype, 'at', function (index) {
  const n = Math.trunc(index) || 0;
  return this[n < 0 ? this.length + n : n];
});

function choose(name, nodeVersion = process.version) {
  const { modern, fallback, legacy } = CAPABILITIES[name];
  return [modern, fallback, legacy].find(
    impl => impl && (!impl.range || semver.satisfies(nodeVersion, impl.range, { includePrerelease: true }))
  );
}

// 高于 nodeVersion 且同时满足全部 ranges 的最低版本, 不存在时返回 null; 预发布版升级到同号正式版即可
exports.restoreVersion = (ranges, nodeVersion = process.version) => {
  const current = semver.parse(nodeVersion);
  const lowerBound = current.prerelease.length
    ? `>=${current.major}.${current.minor}.${current.patch}`
    : `>${current.version}`;
  let combos = [[lowerBound]];
  for (const range of ranges) {
    const sets = new semver.Range(range).set.map(set => set.map(comparator => comparator.value));
    combos = combos.flatMap(combo => sets.map(set => combo.concat(set)));
  }
  let best = null;
  for (const combo of combos) {
    const version = semver.minVersion(combo.filter(Boolean).join(' '));
    if (version && (!best || semver.lt(version, best))) best = version;
  }
  return best && best.version;
};

exports.nodeGypPackage = (nodeVersion = process.version) => {
  const { module, version } = choose('nodeGyp', nodeVersion);
  return { name: module, spec: version ? `${module}@${version}` : module };
};

// 返回降级项, 全部能力共同要求的 Node.js 范围, 以及满足该范围的最低更高版本(没有时为 null); 没有降级时返回 null
exports.degraded = (nodeVersion = process.version) => {
  const items = [];
  const ranges = [];
  for (const name in CAPABILITIES) {
    const impl = choose(name, nodeVersion);
    if (impl.degraded) items.push(impl.degraded);
    ranges.push(CAPABILITIES[name].modern.range);
  }
  if (!items.length) return null;
  return { items, ranges, restore: exports.restoreVersion(ranges, nodeVersion) };
};

exports.warningMessage = (nodeVersion = process.version) => {
  const result = exports.degraded(nodeVersion);
  if (!result) return null;
  const hint = result.restore
    ? `upgrade to Node >= ${result.restore} to restore`
    : `requires Node ${result.ranges.join(' and ')} to restore`;
  return `np WARN Node ${nodeVersion}: ${result.items.join('; ')}, ${hint}`;
};

// 每个进程只打印一次; np_node_warning=false 关闭
let warned = false;
exports.warnIfDegraded = (logger = console) => {
  if (warned || ['0', 'false'].includes(process.env.np_node_warning)) return;
  warned = true;
  const message = exports.warningMessage();
  if (message) logger.warn(message);
};
