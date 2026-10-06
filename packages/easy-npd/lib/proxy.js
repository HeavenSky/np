// 代理与 TLS 配置: 解析一次并写回 process.env 供子进程(安装脚本, node-gyp, git)继承, 同时按请求 URL 给 urllib 选择 dispatcher
const fs = require('node:fs');
const path = require('node:path');
const urllib = require('urllib');
const npConfig = require('./np_config');

let settings = null;
const proxyAgents = new Map();

// 优先级: 命令行 > npm 传给脚本的 npm_config_* > ~/.nprc > 通用环境变量; 与 npm 一致, https 请求没有 https-proxy 时退回 proxy
function pick(argv, key, envKeys) {
  const candidates = [argv[key], process.env[`npm_config_${key.replace(/-/g, '_')}`], npConfig.get(key)];
  for (const name of envKeys) candidates.push(process.env[name]);
  for (const value of candidates) {
    if (value === true) return true;
    if (value === false || value === 'false') return false;
    if (typeof value === 'string' && value) return value;
  }
  return undefined;
}

function setEnv(names, value) {
  if (value === undefined) return;
  for (const name of names) process.env[name] = String(value);
}

// argv 为空时只读取环境变量与 ~/.nprc, 供未经 CLI 入口的调用方(测试, API)懒初始化
exports.configure = (argv = {}) => {
  const httpProxy = pick(argv, 'proxy', ['HTTP_PROXY', 'http_proxy']) || undefined;
  const httpsProxy = pick(argv, 'https-proxy', ['HTTPS_PROXY', 'https_proxy']) || httpProxy;
  const noProxy = pick(argv, 'noproxy', ['NO_PROXY', 'no_proxy']) || undefined;
  const strictSsl = pick(argv, 'strict-ssl', []) !== false;
  const cafileOption = pick(argv, 'cafile', []);
  // 安装脚本与 git 在包目录里运行, 导出相对路径会让它们读到别处的文件
  const cafile = typeof cafileOption === 'string' ? path.resolve(cafileOption) : undefined;
  const ca = cafile ? fs.readFileSync(cafile, 'utf8') : undefined;

  // 子进程各自读取不同的变量名: curl / git 读小写, node-gyp 与 npm 读 npm_config_*
  setEnv(['HTTP_PROXY', 'http_proxy', 'npm_config_proxy'], httpProxy);
  setEnv(['HTTPS_PROXY', 'https_proxy', 'npm_config_https_proxy'], httpsProxy);
  setEnv(['NO_PROXY', 'no_proxy', 'npm_config_noproxy'], noProxy);
  if (!strictSsl) {
    process.env.npm_config_strict_ssl = 'false';
    process.env.GIT_SSL_NO_VERIFY = 'true';
  } else if (argv['strict-ssl'] === true) {
    process.env.npm_config_strict_ssl = 'true';
  }
  setEnv(['npm_config_cafile', 'GIT_SSL_CAINFO'], cafile);

  for (const agent of proxyAgents.values()) agent.close();
  proxyAgents.clear();
  settings = {
    httpProxy,
    httpsProxy,
    noProxy: parseNoProxy(noProxy),
    tls: strictSsl && !ca ? undefined : { rejectUnauthorized: strictSsl, ...(ca && { ca }) },
  };
  return settings;
};

exports.settings = () => settings || exports.configure();

// 未配置 strict-ssl / cafile 时返回 undefined, 使用 Node.js 默认的证书校验
exports.tlsOptions = () => exports.settings().tls;

// 返回 undefined 表示直连
exports.dispatcherFor = url => {
  const { httpProxy, httpsProxy, noProxy, tls } = exports.settings();
  let target;
  try {
    target = new URL(url);
  } catch {
    return undefined;
  }
  const uri = target.protocol === 'https:' ? httpsProxy : httpProxy;
  if (!uri || exports.matchNoProxy(target, noProxy)) return undefined;
  if (!proxyAgents.has(uri)) {
    proxyAgents.set(uri, new urllib.ProxyAgent({ uri, ...(tls && { requestTls: tls, proxyTls: tls }) }));
  }
  return proxyAgents.get(uri);
};

function parseNoProxy(value) {
  if (!value) return [];
  return value
    .split(/[,\s]+/)
    .map(entry => entry.trim().toLowerCase())
    .filter(Boolean);
}

// 与 curl 一致: `*` 匹配全部; `example.com`, `.example.com`, `*.example.com` 匹配该域名及其子域名; 可带 `:port`; 不支持 IPv6 与 CIDR
exports.matchNoProxy = (target, entries) => {
  const host = target.hostname.toLowerCase();
  const port = target.port || (target.protocol === 'https:' ? '443' : '80');
  return entries.some(entry => {
    if (entry === '*') return true;
    const [, name, entryPort] = /^\*?\.?([^:]+)(?::(\d+))?$/.exec(entry) || [];
    if (!name || (entryPort && entryPort !== port)) return false;
    return host === name || host.endsWith(`.${name}`);
  });
};
