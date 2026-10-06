// 运行时能力表: 按当前 Node.js 版本决定各能力用哪种实现, 其余代码只查这张表, 不各自判断版本
const semver = require('semver');

// modern.range 必须等于对应依赖 package.json 的 engines.node, 否则会在不支持的 Node.js 上加载新版本
const CAPABILITIES = {
  nodeGyp: {
    modern: { range: '^20.17.0 || >=22.9.0', module: 'node-gyp' },
    fallback: { module: 'node-gyp10', degraded: 'node-gyp 10 (newer Python / Visual Studio may be unsupported)' },
    restore: '20.17.0',
  },
};

exports.CAPABILITIES = CAPABILITIES;

function choose(name, nodeVersion = process.version) {
  const capability = CAPABILITIES[name];
  return semver.satisfies(nodeVersion, capability.modern.range) ? capability.modern : capability.fallback;
}

exports.nodeGypBin = (nodeVersion = process.version) =>
  require.resolve(`${choose('nodeGyp', nodeVersion).module}/bin/node-gyp.js`);

// 返回降级项与恢复全部能力所需的最低 Node.js 版本, 没有降级时返回 null
exports.degraded = (nodeVersion = process.version) => {
  const items = [];
  let restore;
  for (const name in CAPABILITIES) {
    const impl = choose(name, nodeVersion);
    if (impl.degraded) {
      items.push(impl.degraded);
      const version = CAPABILITIES[name].restore;
      if (!restore || semver.gt(version, restore)) restore = version;
    }
  }
  return items.length ? { items, restore } : null;
};

exports.warningMessage = (nodeVersion = process.version) => {
  const result = exports.degraded(nodeVersion);
  if (!result) return null;
  return `npd WARN Node ${nodeVersion}: ${result.items.join('; ')}, upgrade to Node >= ${result.restore} to restore`;
};

// 每个进程只打印一次; np_node_warning=false 关闭
let warned = false;
exports.warnIfDegraded = (logger = console) => {
  if (warned || ['0', 'false'].includes(process.env.np_node_warning)) return;
  warned = true;
  const message = exports.warningMessage();
  if (message) logger.warn(message);
};
